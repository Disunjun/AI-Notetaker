import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maskApiKey } from '@/lib/ai/registry';
import { encryptSecret } from '@/lib/crypto';
import { redact, REDACTION_PLACEHOLDER } from '@/lib/logger';
import { AIProviderType, ProviderRole, QUEUE_NAME } from '@/lib/domain';
import type { ProcessingJobPayload } from '@/lib/domain';

const SOURCE_DIRS = ['app', 'lib', 'worker', 'components', 'scripts', 'prisma'];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) yield full;
  }
}

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) {
    try {
      files.push(...walk(dir));
    } catch {
      /* directory absent */
    }
  }
  return files;
}

describe('no secrets in source', () => {
  it('contains no hardcoded API keys', () => {
    const patterns = [/sk-[A-Za-z0-9_-]{20,}/, /sk-ant-[A-Za-z0-9_-]{20,}/, /re_[A-Za-z0-9_-]{20,}/, /AIza[0-9A-Za-z_-]{20,}/, /gsk_[A-Za-z0-9_-]{20,}/];
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        if (pattern.test(content)) hits.push(`${file}: ${pattern.source}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('never reads AI or Resend credentials from the environment', () => {
    const forbidden = ['OPENAI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'RESEND_API_KEY', 'GEMINI_API_KEY'];
    const hits: string[] = [];
    for (const file of sourceFiles()) {
      const content = readFileSync(file, 'utf8');
      for (const name of forbidden) {
        if (content.includes(name)) hits.push(`${file}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('stores provider keys only as ciphertext', () => {
    const key = 'sk-live-abcdef0123456789';
    const encrypted = encryptSecret(key);
    expect(encrypted).not.toContain(key);
    expect(encrypted.startsWith('v1.')).toBe(true);
  });
});

describe('API keys are masked before they reach a client', () => {
  it('reveals at most the last four characters', () => {
    const masked = maskApiKey('sk-live-abcdef0123456789');
    expect(masked).toBe('****6789');
    expect(masked).not.toContain('sk-live');
    expect(masked).not.toContain('abcdef');
  });

  it('fully masks a short key', () => {
    expect(maskApiKey('abc')).toBe('****');
    expect(maskApiKey('abcd')).toBe('****');
  });

  it('returns an empty mask for an empty key', () => {
    expect(maskApiKey('')).toBe('');
  });
});

describe('the queue payload carries no credentials', () => {
  it('contains exactly jobId, noteId and userId', () => {
    const payload: ProcessingJobPayload = { jobId: 'j', noteId: 'n', userId: 'u' };
    expect(Object.keys(payload).sort()).toEqual(['jobId', 'noteId', 'userId']);
    const serialised = JSON.stringify(payload).toLowerCase();
    for (const word of ['apikey', 'token', 'password', 'secret', 'authorization']) {
      expect(serialised).not.toContain(word);
    }
  });

  it('uses the fixed queue name from the contract', () => {
    expect(QUEUE_NAME).toBe('ai-notetaker-processing');
  });
});

describe('no secrets reach the logs', () => {
  it('redacts a realistic provider configuration object', () => {
    const output = redact({
      role: ProviderRole.TEXT,
      provider: AIProviderType.OPENAI,
      apiKeyEncrypted: encryptSecret('sk-live-abcdef0123456789'),
      model: 'gpt-4o-mini',
    }) as Record<string, unknown>;

    expect(output.apiKeyEncrypted).toBe(REDACTION_PLACEHOLDER);
    expect(JSON.stringify(output)).not.toContain('sk-live');
  });

  it('redacts a login request body', () => {
    const output = redact({ email: 'admin@example.com', password: 'correct horse battery staple' }) as Record<string, unknown>;
    expect(output.password).toBe(REDACTION_PLACEHOLDER);
    expect(JSON.stringify(output)).not.toContain('correct horse');
  });

  it('redacts session cookies and OTP codes', () => {
    const output = redact({ cookie: 'ai_notetaker_session=abc', otp: '482913' }) as Record<string, unknown>;
    expect(output.cookie).toBe(REDACTION_PLACEHOLDER);
    expect(output.otp).toBe(REDACTION_PLACEHOLDER);
  });
});
