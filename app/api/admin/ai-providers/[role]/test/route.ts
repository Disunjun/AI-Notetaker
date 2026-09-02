import { ok, readJson, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { requireAdmin } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { buildProvider, type ProviderConfigRow } from '@/lib/ai/registry';
import { AIProviderUpsertSchema, ProviderRoleSchema, parseWith } from '@/lib/validation';
import type { ProviderTestResultDto } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/ai-providers/:role/test
 *
 * Connectivity test only. It NEVER creates a processing Job and never enqueues
 * anything — it performs a lightweight authenticated call to the provider.
 */
export const POST = route<{ role: string }>(async (req, { params }) => {
  await requireAdmin(req);
  assertSameOrigin(req);

  const role = parseWith(ProviderRoleSchema, params.role);
  // The body is read exactly once; both the stored-config and ad-hoc paths use it.
  const raw = await readJson(req);
  const body = raw as { configId?: string };
  const startedAt = Date.now();

  let providerName = 'ad-hoc';
  let testError: string | null = null;
  let succeeded = false;
  let storedId: string | null = null;

  try {
    let instance;
    if (typeof body.configId === 'string' && body.configId) {
      const row = (await prisma.aIProviderConfig.findFirst({
        where: { id: body.configId, role },
      })) as unknown as ProviderConfigRow | null;
      if (!row) {
        testError = 'AI provider configuration not found';
      } else {
        storedId = row.id;
        providerName = row.name;
        instance = buildProvider(row, decryptSecret(row.apiKeyEncrypted));
      }
    } else {
      const payload = parseWith(AIProviderUpsertSchema, raw);
      providerName = payload.name;
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
      instance = buildProvider(ephemeral, decryptSecret(ephemeral.apiKeyEncrypted));
    }

    if (instance) {
      await instance.testConnection();
      succeeded = true;
    }
  } catch (error) {
    testError = error instanceof Error ? error.message.slice(0, 300) : 'Test failed';
  }

  if (storedId) {
    await prisma.aIProviderConfig.update({
      where: { id: storedId },
      data: { lastTestedAt: new Date(), lastTestOk: succeeded, lastTestError: succeeded ? null : testError },
    });
  }

  const result: ProviderTestResultDto = {
    ok: succeeded,
    provider: providerName,
    latencyMs: Date.now() - startedAt,
    error: testError,
  };
  return ok(result);
});
