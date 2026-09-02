import { ok, readJson, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { requireAdmin } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { EmailStatus, EmailType } from '@/lib/domain';
import { loadResendSettings, sendViaResend } from '@/lib/email/resend';
import { testEmail } from '@/lib/email/templates';
import { ResendTestSchema, parseWith } from '@/lib/validation';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/resend/test
 *
 * Sends one test email. Creates no processing Job and enqueues nothing.
 */
export const POST = route(async (req) => {
  await requireAdmin(req);
  assertSameOrigin(req);

  const { to } = parseWith(ResendTestSchema, await readJson(req));
  const template = testEmail();
  const idempotencyKey = `test:${Date.now()}:${to}`;

  const settings = await loadResendSettings();
  if (!settings) {
    await prisma.emailLog.create({
      data: { type: EmailType.TEST, status: EmailStatus.SKIPPED, to, subject: template.subject, idempotencyKey, error: 'EMAIL_NOT_CONFIGURED' },
    });
    return ok({ ok: false, error: 'Resend is not configured' });
  }

  try {
    const result = await sendViaResend(settings, { from: settings.fromEmail, to: [to], subject: template.subject, html: template.html, text: template.text });
    await prisma.emailLog.create({
      data: { type: EmailType.TEST, status: EmailStatus.SENT, to, subject: template.subject, idempotencyKey, messageId: result.id },
    });
    await prisma.resendConfig.updateMany({ where: { id: settings.id }, data: { lastTestedAt: new Date(), lastTestOk: true, lastTestError: null } });
    return ok({ ok: true, messageId: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Send failed';
    logger.warn('resend_test_failed', { error: message });
    await prisma.emailLog.create({
      data: { type: EmailType.TEST, status: EmailStatus.FAILED, to, subject: template.subject, idempotencyKey, error: message },
    });
    await prisma.resendConfig.updateMany({ where: { id: settings.id }, data: { lastTestedAt: new Date(), lastTestOk: false, lastTestError: message } });
    return ok({ ok: false, error: message });
  }
});
