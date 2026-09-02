import { ok, readJson, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { clientIdentifier, enforceRateLimit } from '@/lib/security/rate-limit';
import { redis } from '@/lib/redis';
import { findOrCreateUserByEmail, issueMagicLink } from '@/lib/auth/tokens';
import { sendEmail } from '@/lib/email/service';
import { magicLinkEmail } from '@/lib/email/templates';
import { MAGIC_LINK_TTL_MS } from '@/lib/auth/tokens';
import { RequestLinkSchema, parseWith } from '@/lib/validation';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { EmailType } from '@/lib/domain';

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { email } = parseWith(RequestLinkSchema, await readJson(req));

  await enforceRateLimit(redis(), 'auth:link', clientIdentifier(req, email), 5, 15 * 60);

  const user = await findOrCreateUserByEmail(email);
  const { token } = await issueMagicLink(user.id);

  const url = `${env().APP_URL.replace(/\/$/, '')}/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
  const template = magicLinkEmail(url, Math.round(MAGIC_LINK_TTL_MS / 60_000));

  const outcome = await sendEmail({
    type: EmailType.MAGIC_LINK,
    to: user.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    idempotencyKey: `magic:${user.id}:${token.slice(0, 16)}`,
    userId: user.id,
  });

  logger.info('magic_link_requested', { userId: user.id, emailStatus: outcome.status });

  // Always 200 — the response must not reveal whether the address is registered.
  return ok({ sent: true, expiresInMinutes: Math.round(MAGIC_LINK_TTL_MS / 60_000), emailDelivered: outcome.status === 'SENT' });
});
