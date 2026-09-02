import { decryptSecret } from '@/lib/crypto';
import { maskApiKey } from '@/lib/ai/registry';
import type { AIProviderConfigDto, ResendConfigDto } from '@/types';

export interface ProviderRow {
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
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The API key is ALWAYS masked in responses. The plaintext is decrypted only to
 * derive the last-four mask and is never serialised.
 */
export function toProviderDto(row: ProviderRow): AIProviderConfigDto {
  let masked = '****';
  try {
    masked = maskApiKey(decryptSecret(row.apiKeyEncrypted));
  } catch {
    masked = '****';
  }
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    isPrimary: row.isPrimary,
    priority: row.priority,
    isActive: row.isActive,
    timeoutMs: row.timeoutMs,
    apiKeyMasked: masked,
    hasApiKey: row.apiKeyEncrypted.length > 0,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    lastTestError: row.lastTestError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ResendRow {
  id: string;
  apiKeyEncrypted: string;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  isActive: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toResendDto(row: ResendRow): ResendConfigDto {
  let masked = '****';
  try {
    masked = maskApiKey(decryptSecret(row.apiKeyEncrypted));
  } catch {
    masked = '****';
  }
  return {
    id: row.id,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    replyTo: row.replyTo,
    isActive: row.isActive,
    apiKeyMasked: masked,
    hasApiKey: row.apiKeyEncrypted.length > 0,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestOk: row.lastTestOk,
    lastTestError: row.lastTestError,
    updatedAt: row.updatedAt.toISOString(),
  };
}
