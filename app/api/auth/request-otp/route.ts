import { ok, readJson, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { clientIdentifier, enforceRateLimit } from '@/lib/security/rate-limit';
import { redis } from '@/lib/redis';
import { findOrCreateUserByEmail, issueOtp, OTP_TTL_MS } from '@/lib/auth/tokens';
import { sendEmail } from '@/lib/email/service';
import { otpEmail } from '@/lib/email/templates';
import { RequestOtpSchema, parseWith } from '@/lib/validation';
import { logger } from '@/lib/logger';
import { EmailType } from '@/lib/domain';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { email } = parseWith(RequestOtpSchema, await readJson(req));

  await enforceRateLimit(redis(), 'auth:otp', clientIdentifier(req, email), 5, 15 * 60);

  const user = await findOrCreateUserByEmail(email);
  const { code } = await issueOtp(user.id);

  const template = otpEmail(code, Math.round(OTP_TTL_MS / 60_000));
  const outcome = await sendEmail({
    type: EmailType.OTP,
    to: user.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    idempotencyKey: `otp:${user.id}:${code}`,
    userId: user.id,
  });

  // The 6-digit code is never returned to the client or written to a log.
  logger.info('otp_requested', { userId: user.id, emailStatus: outcome.status });

  return ok({ sent: true, expiresInMinutes: Math.round(OTP_TTL_MS / 60_000), emailDelivered: outcome.status === 'SENT' });
});
