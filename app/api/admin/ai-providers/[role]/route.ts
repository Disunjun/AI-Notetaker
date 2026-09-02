import { ok, readJson, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { requireAdmin } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { encryptSecret } from '@/lib/crypto';
import { toProviderDto, type ProviderRow } from '@/lib/ai/dto';
import { AIProviderUpsertSchema, ProviderRoleSchema, parseWith } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = route<{ role: string }>(async (req, { params }) => {
  await requireAdmin(req);
  const role = parseWith(ProviderRoleSchema, params.role);
  const rows = (await prisma.aIProviderConfig.findMany({ where: { role }, orderBy: { priority: 'asc' } })) as unknown as ProviderRow[];
  return ok({ role, items: rows.map(toProviderDto) });
});

export const PUT = route<{ role: string }>(async (req, { params }) => {
  await requireAdmin(req);
  assertSameOrigin(req);

  const role = parseWith(ProviderRoleSchema, params.role);
  const payload = parseWith(AIProviderUpsertSchema, await readJson(req));

  const existing = (await prisma.aIProviderConfig.findUnique({
    where: { role_name: { role, name: payload.name } },
  })) as unknown as ProviderRow | null;

  const data = {
    role,
    name: payload.name,
    provider: payload.provider,
    baseUrl: payload.baseUrl ?? null,
    model: payload.model,
    isPrimary: payload.isPrimary ?? false,
    priority: payload.priority ?? 100,
    isActive: payload.isActive ?? true,
    timeoutMs: payload.timeoutMs ?? 60_000,
    ...(payload.apiKey ? { apiKeyEncrypted: encryptSecret(payload.apiKey) } : {}),
  };

  const row = (existing
    ? await prisma.aIProviderConfig.update({ where: { id: existing.id }, data })
    : await prisma.aIProviderConfig.create({ data: { ...data, apiKeyEncrypted: encryptSecret(payload.apiKey ?? '') } })) as unknown as ProviderRow;

  if (payload.isPrimary) {
    await prisma.aIProviderConfig.updateMany({ where: { role, NOT: { id: row.id } }, data: { isPrimary: false } });
  }

  return ok(toProviderDto(row), { status: existing ? 200 : 201 });
});
