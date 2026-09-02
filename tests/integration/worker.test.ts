import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { prisma } from '@/lib/db';
import { processJob } from '@/worker/pipeline';
import { runWatchdogOnce } from '@/worker/watchdog';
import { audioSourcePath } from '@/lib/upload/storage';
import { JobStage, JobStatus, NoteStatus } from '@/lib/domain';
import { configureResend, createNoteWithJob, createUser, resetDatabase } from '@/tests/helpers/db';
import { integrationAvailable } from '@/tests/helpers/integration';

/**
 * Worker pipeline: processing, checkpoint/resume, fallback, permanent failure,
 * retry limit, watchdog recovery, usage idempotency and email isolation.
 *
 * Provider HTTP calls are stubbed at the fetch boundary so no network is needed.
 */

interface FetchCall {
  url: string;
  init?: RequestInit;
}

const calls: FetchCall[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const TRANSCRIPT = 'Alice: we ship Friday. Bob: I will send the deck by Thursday.';
const SUMMARY = '## Overview\nThe team agreed to ship on Friday.\n## Decisions\n- Ship Friday';
const ACTIONS = JSON.stringify({ actionItems: [{ content: 'Send the deck', assignee: 'Bob', dueDate: '2026-09-03' }] });
const MINDMAP = '# Team sync\n- Decisions\n  - Ship Friday';

/** Route /audio/transcriptions and /chat/completions by URL. */
function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call: FetchCall = { url, init };
    calls.push(call);
    return handler(call);
  });
}

function defaultProviderResponses(): void {
  stubFetch(async ({ url }) => {
    if (url.includes('/audio/transcriptions')) return jsonResponse({ text: TRANSCRIPT, language: 'en' });
    if (url.includes('/chat/completions')) {
      const body = JSON.parse(String((calls[calls.length - 1]?.init?.body as string) ?? '{}')) as {
        messages?: Array<{ content?: string }>;
        response_format?: { type?: string };
      };
      const wantsJson = body.response_format?.type === 'json_object';
      const content = wantsJson ? ACTIONS : url.includes('mindmap') ? MINDMAP : SUMMARY;
      return jsonResponse({
        choices: [{ message: { content: pickContent(body, wantsJson) ?? content } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });
    }
    if (url.includes('/models')) return jsonResponse({ data: [{ id: 'gpt-4o-mini' }] });
    return jsonResponse({ error: 'unexpected' }, 404);
  });
}

let mindMapRequested = false;
function pickContent(body: { messages?: Array<{ content?: string }> }, wantsJson: boolean): string | null {
  if (wantsJson) return ACTIONS;
  const prompt = body.messages?.[1]?.content ?? '';
  if (prompt.includes('mind map')) {
    mindMapRequested = true;
    return MINDMAP;
  }
  return SUMMARY;
}

async function seedNoteWithAudio(email: string): Promise<{ userId: string; noteId: string; jobId: string }> {
  const user = await createUser(email);
  const { noteId, jobId } = await createNoteWithJob(user.id);
  const path = audioSourcePath(noteId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, new Uint8Array([0xff, 0xfb, 0x90, 0x00]));
  return { userId: user.id, noteId, jobId };
}

async function configureBothProviders(): Promise<void> {
  const { configureProviders } = await import('@/tests/helpers/db');
  await configureProviders();
}

describe.skipIf(!integrationAvailable)('worker pipeline', { skip: !integrationAvailable }, () => {
  beforeAll(resetDatabase);

  beforeEach(async () => {
    await resetDatabase();
    calls.length = 0;
    mindMapRequested = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs all four stages in order and completes the job', async () => {
    await configureBothProviders();
    const { noteId, jobId, userId } = await seedNoteWithAudio('worker@example.com');
    defaultProviderResponses();

    const outcome = await processJob({ jobId, noteId, userId });
    expect(outcome.status).toBe('COMPLETED');

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    expect(job!.status).toBe(JobStatus.COMPLETED);
    expect(job!.stage).toBe(JobStage.COMPLETED);
    expect(job!.progress).toBe(100);
    expect(job!.providerUsed).toBeTruthy();

    expect(await prisma.transcript.count({ where: { noteId } })).toBe(1);
    expect(await prisma.summary.count({ where: { noteId } })).toBe(1);
    expect(await prisma.actionItem.count({ where: { noteId } })).toBe(1);
    expect(await prisma.mindMap.count({ where: { noteId } })).toBe(1);
    expect(mindMapRequested).toBe(true);

    const note = await prisma.note.findUnique({ where: { id: noteId } });
    expect(note!.status).toBe(NoteStatus.COMPLETED);
  });

  it('creates exactly one UsageLog for a successful job', async () => {
    await configureBothProviders();
    const { noteId, jobId, userId } = await seedNoteWithAudio('usage@example.com');
    defaultProviderResponses();

    await processJob({ jobId, noteId, userId });
    expect(await prisma.usageLog.count({ where: { jobId } })).toBe(1);

    // Re-running cannot double-count: jobId is unique and the job is terminal.
    await processJob({ jobId, noteId, userId });
    expect(await prisma.usageLog.count({ where: { jobId } })).toBe(1);
  });

  it('creates NO UsageLog for a failed job', async () => {
    await configureBothProviders();
    const { noteId, jobId, userId } = await seedNoteWithAudio('failed@example.com');

    stubFetch(async ({ url }) => {
      if (url.includes('/models')) return jsonResponse({ data: [{ id: 'm' }] });
      return jsonResponse({ error: 'bad request' }, 400);
    });

    const outcome = await processJob({ jobId, noteId, userId });
    expect(outcome.status).toBe('FAILED');
    expect(await prisma.usageLog.count({ where: { jobId } })).toBe(0);

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    expect(job!.status).toBe(JobStatus.FAILED);
    expect(job!.errorCode).toBeTruthy();
  });

  it('does not fall back on a permanent 400 from the primary', async () => {
    await configureBothProviders();
    // Add a second TEXT provider that would be used if fallback wrongly occurred.
    const { encryptSecret } = await import('@/lib/crypto');
    await prisma.aIProviderConfig.create({
      data: {
        role: 'TEXT',
        name: 'fallback-text',
        provider: 'OPENAI',
        apiKeyEncrypted: encryptSecret('sk-test-fallback'),
        model: 'gpt-4o-mini',
        isPrimary: false,
        priority: 200,
      },
    });

    const { noteId, jobId, userId } = await seedNoteWithAudio('permanent@example.com');
    stubFetch(async ({ url }) => {
      if (url.includes('/audio/transcriptions')) return jsonResponse({ text: TRANSCRIPT, language: 'en' });
      if (url.includes('/models')) return jsonResponse({ data: [{ id: 'm' }] });
      return jsonResponse({ error: 'invalid request' }, 400);
    });

    await processJob({ jobId, noteId, userId });

    const summaryCalls = calls.filter((c) => c.url.includes('/chat/completions'));
    expect(summaryCalls.length).toBe(1); // no fallback attempt
  });

  it('resumes from the next missing stage instead of re-running completed ones', async () => {
    await configureBothProviders();
    const { noteId, jobId, userId } = await seedNoteWithAudio('resume@example.com');

    // Pre-seed transcript and summary as if earlier stages had checkpointed.
    await prisma.transcript.create({
      data: { noteId, jobId, provider: 'openai', model: 'whisper-large-v3', content: TRANSCRIPT },
    });
    await prisma.summary.create({ data: { noteId, jobId, provider: 'openai', model: 'gpt-4o-mini', content: SUMMARY } });

    defaultProviderResponses();
    const outcome = await processJob({ jobId, noteId, userId });
    expect(outcome.status).toBe('COMPLETED');

    // Transcription must not have been called again.
    expect(calls.filter((c) => c.url.includes('/audio/transcriptions'))).toHaveLength(0);
    // Only the two remaining stages produced chat completions.
    expect(calls.filter((c) => c.url.includes('/chat/completions')).length).toBeLessThanOrEqual(2);
  });

  it('requeues a stale PROCESSING job and caps watchdog recovery at 3', async () => {
    const user = await createUser('stale@example.com');
    const { noteId, jobId } = await createNoteWithJob(user.id);
    const staleTime = new Date(Date.now() - 45 * 60 * 1000);

    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.PROCESSING, startedAt: staleTime, lastHeartbeatAt: staleTime },
    });

    const run1 = await runWatchdogOnce();
    expect(run1.requeued).toContain(jobId);
    let job = await prisma.job.findUnique({ where: { id: jobId } });
    expect(job!.status).toBe(JobStatus.QUEUED);
    expect(job!.watchdogRequeues).toBe(1);
    expect(noteId).toBeTruthy();

    // Simulate repeated stalls until the cap is reached.
    for (let i = 0; i < 3; i += 1) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.PROCESSING, startedAt: staleTime, lastHeartbeatAt: staleTime },
      });
      await runWatchdogOnce();
    }

    job = await prisma.job.findUnique({ where: { id: jobId } });
    expect(job!.watchdogRequeues).toBeLessThanOrEqual(3);
    expect(job!.status).toBe(JobStatus.FAILED);
    expect(job!.errorCode).toBe('WATCHDOG_MAX_REQUEUES');
  });

  it('does not change a completed job to FAILED when result email delivery fails', async () => {
    await configureBothProviders();
    await configureResend();
    const { noteId, jobId, userId } = await seedNoteWithAudio('emailfail@example.com');

    stubFetch(async ({ url }) => {
      if (url.includes('api.resend.com')) return jsonResponse({ message: 'unauthorized' }, 401);
      if (url.includes('/audio/transcriptions')) return jsonResponse({ text: TRANSCRIPT, language: 'en' });
      if (url.includes('/models')) return jsonResponse({ data: [{ id: 'm' }] });
      return jsonResponse({
        choices: [{ message: { content: pickContent({ messages: [{ content: '' }, { content: url }] }, url.includes('mind map')) ?? SUMMARY } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    });

    const outcome = await processJob({ jobId, noteId, userId });
    expect(outcome.status).toBe('COMPLETED');

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    expect(job!.status).toBe(JobStatus.COMPLETED);

    const emailLog = await prisma.emailLog.findFirst({ where: { jobId, type: 'RESULT' } });
    expect(emailLog).not.toBeNull();
    expect(emailLog!.status).toBe('FAILED');
  });
});
