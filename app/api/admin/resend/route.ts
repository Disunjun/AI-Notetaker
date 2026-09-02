import { ok, readJson, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { requireAdmin } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';
import { toResendDto, type ResendRow } from '@/lib/ai/dto';
import { ResendUpsertSchema, parseWith } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = route(async (req) => {
  await requireAdmin(req);
  const row = (await prisma.resendConfig.findFirst()) as unknown as ResendRow | null;
  return ok({ config: row ? toResendDto(row) : null });
});

/**
 * PUT /api/admin/resend — upsert the single Resend configuration.
 * Omitting `apiKey` preserves the stored ciphertext.
 */
export const PUT = route(async (req) => {
  await requireAdmin(req);
  assertSameOrigin(req);

  const payload = parseWith(ResendUpsertSchema, await readJson(req));
  const existing = (await prisma.resendConfig.findFirst()) as unknown as ResendRow | null;

  const data = {
    fromEmail: payload.fromEmail,
    fromName: payload.fromName ?? null,
    replyTo: payload.replyTo ?? null,
    isActive: payload.isActive ?? true,
    ...(payload.apiKey ? { apiKeyEncrypted: encryptSecret(payload.apiKey) } : {}),
  };

  const row = (existing
    ? await prisma.resendConfig.update({ where: { id: existing.id }, data })
    : await prisma.resendConfig.create({ data: { ...data, apiKeyEncrypted: encryptSecret(payload.apiKey ?? '') } })) as unknown as ResendRow;

  return ok(toResendDto(row), { status: existing ? 200 : 201 });
});
