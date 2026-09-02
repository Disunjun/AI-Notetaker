import { ok, route } from '@/lib/http/respond';
import { prisma } from '@/lib/db';
import { ProviderRole } from '@/lib/domain';
import type { ServiceStatusDto } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Public service status. Lets the login screen degrade gracefully (for example
 * offering only OTP when email is not configured) without exposing credentials.
 */
export const GET = route(async () => {
  const [resendCount, transcriptionCount, textCount] = await Promise.all([
    prisma.resendConfig.count({ where: { isActive: true } }),
    prisma.aIProviderConfig.count({ where: { role: ProviderRole.TRANSCRIPTION, isActive: true } }),
    prisma.aIProviderConfig.count({ where: { role: ProviderRole.TEXT, isActive: true } }),
  ]);

  const emailConfigured = resendCount > 0;
  const status: ServiceStatusDto = {
    emailConfigured,
    aiConfigured: transcriptionCount > 0 && textCount > 0,
    // Without a working mail transport no passwordless credential can be
    // delivered, so both methods are reported as unavailable.
    otpEnabled: emailConfigured,
    magicLinkEnabled: emailConfigured,
  };

  return ok(status);
});
