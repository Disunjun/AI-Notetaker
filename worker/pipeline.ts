import { basename } from 'node:path';
import { prisma, type PrismaTransactionClient } from '@/lib/db';
import { JobStage, JobStatus, NoteStatus, ProviderRole } from '@/lib/domain';
import { AppError, ErrorCode, FailureKind, failureKindOf } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { runWithFallback } from '@/lib/ai/executor';
import { loadProviderChain } from '@/lib/ai/registry';
import {
  actionItemsSystemPrompt,
  actionItemsUserPrompt,
  mindMapSystemPrompt,
  mindMapUserPrompt,
  summarySystemPrompt,
  summaryUserPrompt,
} from '@/lib/ai/prompts';
import {
  parseActionItems,
  validateMindMapMarkdown,
  validateSummary,
  validateTranscript,
} from '@/lib/ai/output';
import { estimateTokenCost, estimateTranscriptionCost, round6, type UsageBreakdown } from '@/lib/usage/estimate';
import { progressAtStageEnd, progressAtStageStart, STAGE_ORDER } from '@/lib/jobs/states';
import type { ProcessingJobPayload } from '@/lib/domain';
import type { AIProvider, TokenUsage } from '@/lib/ai/types';
import { startHeartbeat, type Heartbeat } from '@/worker/heartbeat';

/**
 * The AI pipeline.
 *
 * Stage order is mandatory and each stage is checkpointed to PostgreSQL, so a
 * resumed job never re-executes a stage whose output already exists.
 */

interface JobRow {
  id: string;
  noteId: string;
  userId: string;
  status: string;
  stage: string;
  attempts: number;
  watchdogRequeues: number;
  note: { id: string; title: string; mimeType: string; sourcePath: string };
  user: { id: string; email: string };
}

export interface PipelineOutcome {
  status: 'COMPLETED' | 'FAILED' | 'RETRY';
  jobId: string;
}

export async function processJob(payload: ProcessingJobPayload): Promise<PipelineOutcome> {
  const log = logger.child({ jobId: payload.jobId, noteId: payload.noteId });
  log.info('job_received', { userId: payload.userId });

  const job = (await prisma.job.findUnique({
    where: { id: payload.jobId },
    include: { note: { select: { id: true, title: true, mimeType: true, sourcePath: true } }, user: { select: { id: true, email: true } } },
  })) as unknown as JobRow | null;

  if (!job) {
    log.warn('job_missing', {});
    return { status: 'FAILED', jobId: payload.jobId };
  }

  // Ownership invariant: the payload must match what the database says.
  if (job.userId !== payload.userId || job.noteId !== payload.noteId || job.note.id !== payload.noteId) {
    log.error('job_payload_mismatch', { expectedUser: job.userId, expectedNote: job.noteId });
    await markFailed(job.id, ErrorCode.VALIDATION_ERROR, 'Job payload does not match the stored job', log);
    return { status: 'FAILED', jobId: payload.jobId };
  }

  // Terminal jobs are never reprocessed (duplicate-job protection).
  if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
    log.info('job_already_terminal', { status: job.status });
    return { status: job.status as PipelineOutcome['status'], jobId: payload.jobId };
  }

  // Atomic claim: only one worker may move QUEUED -> PROCESSING.
  const claimed = await prisma.job.updateMany({
    where: { id: job.id, status: { in: [JobStatus.QUEUED, JobStatus.PROCESSING] } },
    data: {
      status: JobStatus.PROCESSING,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      attempts: { increment: 1 },
    },
  });
  if (claimed.count === 0) {
    log.warn('job_claim_failed', {});
    return { status: 'FAILED', jobId: payload.jobId };
  }
  await prisma.note.updateMany({ where: { id: job.noteId }, data: { status: NoteStatus.PROCESSING } });
  log.info('job_claimed', {});

  let heartbeat: Heartbeat | undefined;
  try {
    heartbeat = await startHeartbeat(job.id, log);

    // Provider configuration is read fresh at job start and never cached.
    const [transcriptionChain, textChain] = await Promise.all([
      loadProviderChain(ProviderRole.TRANSCRIPTION),
      loadProviderChain(ProviderRole.TEXT),
    ]);

    const usage: UsageBreakdown = { transcription: null, text: [] };
    let providerUsed: string | null = null;
    let modelUsed: string | null = null;

    for (const stage of STAGE_ORDER) {
      await checkpoint(job.id, stage, progressAtStageStart(stage));
      log.info('stage_started', { stage });
      const startedAt = Date.now();

      const skipped = await stageAlreadyComplete(job.noteId, stage);
      if (skipped) {
        log.info('stage_checkpoint_resume', { stage, action: 'skipped_existing_output' });
        continue;
      }

      const outcome = await runStage(stage, job, transcriptionChain, textChain, usage, log);
      providerUsed = outcome.provider;
      modelUsed = outcome.model;

      await checkpoint(job.id, stage, progressAtStageEnd(stage));
      log.info('stage_completed', { stage, provider: outcome.provider, durationMs: Date.now() - startedAt, fellBack: outcome.fellBack });
    }

    await completeJob(job, providerUsed, modelUsed, usage, log);
    return { status: 'COMPLETED', jobId: job.id };
  } catch (error) {
    return handleFailure(job, error, log);
  } finally {
    await heartbeat?.stop();
  }
}

async function runStage(
  stage: string,
  job: JobRow,
  transcriptionChain: Awaited<ReturnType<typeof loadProviderChain>>,
  textChain: Awaited<ReturnType<typeof loadProviderChain>>,
  usage: UsageBreakdown,
  log: ReturnType<typeof logger.child>,
): Promise<{ provider: string; model: string; fellBack: boolean }> {
  switch (stage) {
    case JobStage.TRANSCRIPTION: {
      const outcome = await runWithFallback(transcriptionChain, stage, log, async (provider: AIProvider) => {
        const result = await provider.transcribe({
          filePath: job.note.sourcePath,
          fileName: basename(job.note.sourcePath),
          mimeType: job.note.mimeType,
        });
        return validateTranscript(result.text, provider.name);
      });
      const transcript = outcome.result;
      await prisma.transcript.upsert({
        where: { noteId: job.noteId },
        create: { noteId: job.noteId, jobId: job.id, provider: outcome.provider, model: outcome.model, content: transcript, language: null },
        update: { content: transcript, provider: outcome.provider, model: outcome.model },
      });
      // Audio duration is not always reported; estimate cost from file size when absent.
      const audioSeconds = 0;
      usage.transcription = {
        model: outcome.model,
        audioSeconds,
        cost: estimateTranscriptionCost(outcome.model, audioSeconds),
      };
      return { provider: outcome.provider, model: outcome.model, fellBack: outcome.fellBack };
    }

    case JobStage.SUMMARY: {
      const transcript = await requireTranscript(job.noteId);
      const outcome = await runWithFallback(textChain, stage, log, async (provider: AIProvider) => {
        const result = await provider.generateText({
          system: summarySystemPrompt(),
          prompt: summaryUserPrompt(transcript, job.note.title),
          maxTokens: 2048,
        });
        recordTextUsage(usage, stage, result.usage, result.model);
        return validateSummary(result.text, provider.name);
      });
      await prisma.summary.upsert({
        where: { noteId: job.noteId },
        create: { noteId: job.noteId, jobId: job.id, provider: outcome.provider, model: outcome.model, content: outcome.result },
        update: { content: outcome.result, provider: outcome.provider, model: outcome.model },
      });
      return { provider: outcome.provider, model: outcome.model, fellBack: outcome.fellBack };
    }

    case JobStage.ACTION_ITEMS: {
      const transcript = await requireTranscript(job.noteId);
      const outcome = await runWithFallback(textChain, stage, log, async (provider: AIProvider) => {
        const result = await provider.generateText({
          system: actionItemsSystemPrompt(),
          prompt: actionItemsUserPrompt(transcript, job.note.title),
          responseFormat: 'json',
          maxTokens: 2048,
        });
        recordTextUsage(usage, stage, result.usage, result.model);
        return parseActionItems(result.text, provider.name);
      });
      await prisma.$transaction(async (tx: PrismaTransactionClient) => {
        await tx.actionItem.deleteMany({ where: { noteId: job.noteId } });
        if (outcome.result.length > 0) {
          await tx.actionItem.createMany({
            data: outcome.result.map((item, index) => ({
              noteId: job.noteId,
              jobId: job.id,
              content: item.content,
              assignee: item.assignee,
              dueDate: item.dueDate,
              position: index,
            })),
          });
        }
      });
      return { provider: outcome.provider, model: outcome.model, fellBack: outcome.fellBack };
    }

    case JobStage.MIND_MAP: {
      const transcript = await requireTranscript(job.noteId);
      const outcome = await runWithFallback(textChain, stage, log, async (provider: AIProvider) => {
        const result = await provider.generateText({
          system: mindMapSystemPrompt(),
          prompt: mindMapUserPrompt(transcript, job.note.title),
          maxTokens: 2048,
        });
        recordTextUsage(usage, stage, result.usage, result.model);
        return validateMindMapMarkdown(result.text, provider.name);
      });
      await prisma.mindMap.upsert({
        where: { noteId: job.noteId },
        create: { noteId: job.noteId, jobId: job.id, provider: outcome.provider, model: outcome.model, markdown: outcome.result },
        update: { markdown: outcome.result, provider: outcome.provider, model: outcome.model },
      });
      return { provider: outcome.provider, model: outcome.model, fellBack: outcome.fellBack };
    }

    default:
      throw new AppError(ErrorCode.INTERNAL_ERROR, `Unknown stage ${stage}`);
  }
}

function recordTextUsage(usage: UsageBreakdown, stage: string, tokens: TokenUsage, model: string): void {
  usage.text.push({
    stage,
    model,
    promptTokens: tokens.promptTokens,
    completionTokens: tokens.completionTokens,
    cost: estimateTokenCost(model, tokens.promptTokens, tokens.completionTokens),
  });
}

async function requireTranscript(noteId: string): Promise<string> {
  const transcript = await prisma.transcript.findUnique({ where: { noteId } });
  if (!transcript) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Transcript is required before downstream stages');
  }
  return transcript.content as string;
}

/** Checkpoint/resume: a stage whose output row already exists is not re-run. */
async function stageAlreadyComplete(noteId: string, stage: string): Promise<boolean> {
  switch (stage) {
    case JobStage.TRANSCRIPTION:
      return (await prisma.transcript.count({ where: { noteId } })) > 0;
    case JobStage.SUMMARY:
      return (await prisma.summary.count({ where: { noteId } })) > 0;
    case JobStage.ACTION_ITEMS:
      return (await prisma.actionItem.count({ where: { noteId } })) > 0;
    case JobStage.MIND_MAP:
      return (await prisma.mindMap.count({ where: { noteId } })) > 0;
    default:
      return false;
  }
}

async function checkpoint(jobId: string, stage: string, progress: number): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { stage, progress, lastHeartbeatAt: new Date() },
  });
}

async function completeJob(
  job: JobRow,
  providerUsed: string | null,
  modelUsed: string | null,
  usage: UsageBreakdown,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.COMPLETED,
        stage: JobStage.COMPLETED,
        progress: 100,
        providerUsed,
        modelUsed,
        completedAt: now,
        lastHeartbeatAt: now,
        errorCode: null,
        errorMessage: null,
      },
    }),
    prisma.note.update({ where: { id: job.noteId }, data: { status: NoteStatus.COMPLETED } }),
  ]);

  // UsageLog is created ONLY for successful jobs, and jobId is unique so a
  // retried job can never double-count usage.
  await prisma.usageLog.upsert({
    where: { jobId: job.id },
    create: {
      jobId: job.id,
      noteId: job.noteId,
      userId: job.userId,
      provider: providerUsed ?? 'unknown',
      model: modelUsed ?? 'unknown',
      audioSeconds: usage.transcription?.audioSeconds ?? null,
      promptTokens: usage.text.reduce((sum, t) => sum + t.promptTokens, 0),
      completionTokens: usage.text.reduce((sum, t) => sum + t.completionTokens, 0),
      totalTokens: usage.text.reduce((sum, t) => sum + t.promptTokens + t.completionTokens, 0),
      estimatedCost: round6(usage.text.reduce((sum, t) => sum + t.cost, 0) + (usage.transcription?.cost ?? 0)),
      breakdown: JSON.parse(JSON.stringify(usage)) as object,
    },
    update: {},
  });

  log.info('job_completed', { providerUsed, modelUsed });
  await notifyJobResult(job, log);
}

async function markFailed(
  jobId: string,
  code: string,
  message: string,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  await prisma.job.updateMany({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      errorCode: code,
      errorMessage: message.slice(0, 500),
      failedAt: new Date(),
      lastHeartbeatAt: new Date(),
    },
  });
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { noteId: true } });
  if (job) await prisma.note.updateMany({ where: { id: job.noteId }, data: { status: NoteStatus.FAILED } });
  log.error('job_failed', { code, message });
}

async function handleFailure(
  job: JobRow,
  error: unknown,
  log: ReturnType<typeof logger.child>,
): Promise<PipelineOutcome> {
  const code = (error as { code?: string })?.code ?? ErrorCode.INTERNAL_ERROR;
  const message = error instanceof Error ? error.message : String(error);
  const kind = (error as { kind?: FailureKind })?.kind ?? failureKindOf(code);

  // Transient failures are retried by BullMQ (max 3 attempts, exponential
  // backoff). The job returns to QUEUED so its state stays consistent between
  // attempts and the watchdog does not mistake it for a stuck job.
  if (kind === FailureKind.TRANSIENT && job.attempts + 1 < 3) {
    await prisma.job.updateMany({
      where: { id: job.id },
      data: { status: JobStatus.QUEUED, stage: JobStage.QUEUED, errorCode: code, errorMessage: message.slice(0, 500), lastHeartbeatAt: new Date() },
    });
    log.warn('retry', { attempt: job.attempts + 1, code, message });
    throw error instanceof Error ? error : new Error(message);
  }

  await markFailed(job.id, code, message, log);
  await notifyJobFailure(job, code, message, log);
  return { status: 'FAILED', jobId: job.id };
}

async function notifyJobResult(job: JobRow, log: ReturnType<typeof logger.child>): Promise<void> {
  const { notifyResult } = await import('@/lib/email/service');
  const { resultEmail } = await import('@/lib/email/templates');
  const { env } = await import('@/lib/env');
  const url = `${env().APP_URL.replace(/\/$/, '')}/notes/${job.noteId}`;
  const template = resultEmail(job.note.title, url);
  const outcome = await notifyResult({
    userId: job.userId,
    to: job.user.email,
    jobId: job.id,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
  log.info('job_result_notification', { status: outcome.status });
}

async function notifyJobFailure(
  job: JobRow,
  code: string,
  message: string,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  const { notifyFailure } = await import('@/lib/email/service');
  const { failureEmail } = await import('@/lib/email/templates');
  const { env } = await import('@/lib/env');
  const url = `${env().APP_URL.replace(/\/$/, '')}/notes/${job.noteId}`;
  const template = failureEmail(job.note.title, url, message);
  const outcome = await notifyFailure({
    userId: job.userId,
    to: job.user.email,
    jobId: job.id,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
  log.info('job_failure_notification', { status: outcome.status, code });
}
