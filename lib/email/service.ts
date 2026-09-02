import { prisma } from '@/lib/db';
import { EmailStatus, EmailType } from '@/lib/domain';
import { logger } from '@/lib/logger';
import { loadResendSettings, sendViaResend } from '@/lib/email/resend';
import type { EmailSendOptions } from '@/types';

/**
 * Email side effects.
 *
 * Two invariants matter here:
 *  1. Idempotency — every send carries a stable idempotencyKey, so a retried or
 *     re-run job can never email a user twice.
 *  2. Isolation — email delivery is completely independent from AI processing.
 *     A failed RESULT/FAILURE notification never marks a job FAILED.
 */

export interface EmailOutcome {
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  logId: string | null;
  error: string | null;
}

export async function sendEmail(options: EmailSendOptions): Promise<EmailOutcome> {
  const existing = await prisma.emailLog.findUnique({ where: { idempotencyKey: options.idempotencyKey } });
  if (existing) {
    logger.info('email_idempotent_skip', { type: options.type, to: options.to, logId: existing.id });
    return { status: existing.status as EmailOutcome['status'], logId: existing.id as string, error: null };
  }

  let settings;
  try {
    settings = await loadResendSettings();
  } catch (error) {
    return record({ ...options, status: EmailStatus.SKIPPED, error: 'Resend configuration unavailable' }, error);
  }

  if (!settings) {
    return record({ ...options, status: EmailStatus.SKIPPED, error: 'EMAIL_NOT_CONFIGURED' }, null);
  }

  try {
    const result = await sendViaResend(settings, {
      from: settings.fromEmail,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    return record({ ...options, status: EmailStatus.SENT, messageId: result.id ?? undefined }, null);
  } catch (error) {
    return record(
      { ...options, status: EmailStatus.FAILED, error: error instanceof Error ? error.message : 'Send failed' },
      error,
    );
  }
}

interface RecordInput extends EmailSendOptions {
  status: string;
  messageId?: string;
  error?: string;
}

async function record(input: RecordInput, error: unknown): Promise<EmailOutcome> {
  const log = await prisma.emailLog
    .create({
      data: {
        type: input.type,
        status: input.status,
        to: input.to,
        subject: input.subject,
        idempotencyKey: input.idempotencyKey,
        userId: input.userId ?? null,
        jobId: input.jobId ?? null,
        messageId: input.messageId ?? null,
        error: input.error ?? (error instanceof Error ? error.message.slice(0, 500) : null),
      },
      select: { id: true, status: true },
    })
    .catch(async (conflict: unknown) => {
      // A concurrent send won the race on the unique idempotencyKey.
      const winner = await prisma.emailLog.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (!winner) throw conflict;
      return { id: winner.id, status: winner.status } as { id: unknown; status: unknown };
    });

  const outcome: EmailOutcome = {
    status: log.status as EmailOutcome['status'],
    logId: log.id as string,
    error: input.error ?? null,
  };

  if (outcome.status === EmailStatus.FAILED) {
    logger.warn('email_send_failed', { type: input.type, logId: outcome.logId, error: input.error });
  } else {
    logger.info('email_recorded', { type: input.type, status: outcome.status, logId: outcome.logId });
  }
  return outcome;
}

/**
 * Notification helpers. These NEVER throw: callers in the worker pipeline treat
 * email as a best-effort side effect.
 */
export async function notifyResult(options: {
  userId: string;
  to: string;
  jobId: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailOutcome> {
  try {
    return await sendEmail({
      type: EmailType.RESULT,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      idempotencyKey: `result:${options.jobId}`,
      userId: options.userId,
      jobId: options.jobId,
    });
  } catch (error) {
    logger.error('email_notify_result_error', { jobId: options.jobId, error: error instanceof Error ? error.message : String(error) });
    return { status: EmailStatus.FAILED, logId: null, error: 'notification failed' };
  }
}

export async function notifyFailure(options: {
  userId: string;
  to: string;
  jobId: string;
  subject: string;
  html: string;
  text: string;
}): Promise<EmailOutcome> {
  try {
    return await sendEmail({
      type: EmailType.FAILURE,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      idempotencyKey: `failure:${options.jobId}`,
      userId: options.userId,
      jobId: options.jobId,
    });
  } catch (error) {
    logger.error('email_notify_failure_error', { jobId: options.jobId, error: error instanceof Error ? error.message : String(error) });
    return { status: EmailStatus.FAILED, logId: null, error: 'notification failed' };
  }
}
