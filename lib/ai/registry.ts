import { decryptSecret } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { AIProviderType, ProviderRole } from '@/lib/domain';
import { AppError, ErrorCode } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { GoogleProvider } from '@/lib/ai/providers/google';
import { AnthropicProvider } from '@/lib/ai/providers/anthropic';
import { OpenAiCompatibleProvider } from '@/lib/ai/providers/openai-compatible';
import type { AIProvider } from '@/lib/ai/types';

/**
 * Builds provider instances from the configuration stored in PostgreSQL.
 *
 * Called at job start (and by the admin test endpoint) so a job always uses the
 * latest configuration. Nothing is cached across jobs.
 */

export interface ProviderConfigRow {
  id: string;
  role: string;
  name: string;
  provider: string;
  baseUrl: string | null;
  apiKeyEncrypted: string;
  model: string;
  isPrimary: boolean;
  priority: number;
  isActive: boolean;
  timeoutMs: number;
}

export function buildProvider(row: ProviderConfigRow, apiKey: string): AIProvider {
  const base = {
    name: row.name,
    role: row.role,
    model: row.model,
    apiKey,
    baseUrl: row.baseUrl,
    timeoutMs: row.timeoutMs,
  };

  switch (row.provider) {
    case AIProviderType.GOOGLE:
      return new GoogleProvider(base);
    case AIProviderType.ANTHROPIC:
      return new AnthropicProvider(base);
    case AIProviderType.OPENAI:
    case AIProviderType.GROQ:
    case AIProviderType.OPENAI_COMPATIBLE:
      return new OpenAiCompatibleProvider({ ...base, type: row.provider });
    default:
      throw new AppError(ErrorCode.AI_PROVIDER_NOT_CONFIGURED, `Unknown provider type ${row.provider}`);
  }
}

export interface ResolvedProviderChain {
  primary: AIProvider;
  fallbacks: AIProvider[];
  all: AIProvider[];
  primaryConfigName: string;
}

function rowOrder(a: ProviderConfigRow, b: ProviderConfigRow): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.name.localeCompare(b.name);
}

/**
 * Load the active, ordered provider chain for a role.
 * Throws AI_PROVIDER_NOT_CONFIGURED (503) when no active provider exists — this
 * is exactly what makes POST /api/notes/upload return 503 without side effects.
 */
export async function loadProviderChain(role: string): Promise<ResolvedProviderChain> {
  const rows = (await prisma.aIProviderConfig.findMany({
    where: { role, isActive: true },
  })) as unknown as ProviderConfigRow[];

  if (rows.length === 0) {
    logger.warn('ai_provider_chain_empty', { role });
    throw new AppError(ErrorCode.AI_PROVIDER_NOT_CONFIGURED, `No active AI provider configured for ${role}`);
  }

  const ordered = [...rows].sort(rowOrder);
  const providers = ordered.map((row) => buildProvider(row, decryptSecret(row.apiKeyEncrypted)));
  const [primary, ...fallbacks] = providers;

  return {
    primary: primary!,
    fallbacks,
    all: providers,
    primaryConfigName: ordered[0]!.name,
  };
}

export async function assertAiConfigured(): Promise<void> {
  await Promise.all([loadProviderChain(ProviderRole.TRANSCRIPTION), loadProviderChain(ProviderRole.TEXT)]);
}

/** Build a single provider instance for the admin "test connection" endpoint. */
export async function buildProviderById(configId: string): Promise<AIProvider> {
  const row = (await prisma.aIProviderConfig.findUnique({ where: { id: configId } })) as unknown as ProviderConfigRow | null;
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'AI provider configuration not found');
  return buildProvider(row, decryptSecret(row.apiKeyEncrypted));
}

/** Mask a key for display: never reveal more than the last 4 characters. */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 4) return '****';
  return `****${key.slice(-4)}`;
}
