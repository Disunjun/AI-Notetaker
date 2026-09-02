import { ok, readJson, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { requireAdmin } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { buildProvider, type ProviderConfigRow } from '@/lib/ai/registry';
import { AIProviderUpsertSchema, ProviderRoleSchema, parseWith } from '@/lib/validation';
import { AppError, ErrorCode } from '@/lib/errors';
import type { ProviderModelsDto } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/ai-providers/:role/models
 *
 * Lists models for a stored configuration or for ad-hoc credentials supplied in
 * the request body. Creates no Job and enqueues nothing.
 */
export const POST = route<{ role: string }>(async (req, { params }) => {
  await requireAdmin(req);
  assertSameOrigin(req);

  const role = parseWith(ProviderRoleSchema, params.role);
  const raw = await readJson(req);
  const body = raw as { configId?: string };

  if (typeof body.configId === 'string' && body.configId) {
    const row = (await prisma.aIProviderConfig.findFirst({
      where: { id: body.configId, role },
    })) as unknown as ProviderConfigRow | null;
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'AI provider configuration not found');
    const instance = buildProvider(row, decryptSecret(row.apiKeyEncrypted));
    const models = await instance.listModels();
    const result: ProviderModelsDto = { models };
    return ok(result);
  }

  const payload = parseWith(AIProviderUpsertSchema, raw);
  const ephemeral: ProviderConfigRow = {
    id: 'ephemeral',
    role,
    name: payload.name,
    provider: payload.provider,
    baseUrl: payload.baseUrl ?? null,
    apiKeyEncrypted: encryptSecret(payload.apiKey ?? ''),
    model: payload.model,
    isPrimary: false,
    priority: 100,
    isActive: true,
    timeoutMs: payload.timeoutMs ?? 30_000,
  };
  const instance = buildProvider(ephemeral, decryptSecret(ephemeral.apiKeyEncrypted));
  const models = await instance.listModels();
  const result: ProviderModelsDto = { models };
  return ok(result);
});
