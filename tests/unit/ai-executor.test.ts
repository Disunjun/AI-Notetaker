import { describe, expect, it } from 'vitest';
import { runWithFallback } from '@/lib/ai/executor';
import { permanentError, transientError, type AIProvider } from '@/lib/ai/types';
import type { ResolvedProviderChain } from '@/lib/ai/registry';
import { ErrorCode } from '@/lib/errors';
import { logger } from '@/lib/logger';

function provider(name: string, behaviour: () => Promise<string>): AIProvider {
  return {
    name,
    type: 'OPENAI',
    model: `${name}-model`,
    role: 'TEXT',
    testConnection: async () => undefined,
    listModels: async () => ['m'],
    transcribe: async () => ({ text: 'x', language: null, provider: name, model: 'm', audioSeconds: null }),
    generateText: async () => ({ text: await behaviour(), provider: name, model: `${name}-model`, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }),
  };
}

function chain(...providers: AIProvider[]): ResolvedProviderChain {
  return { primary: providers[0]!, fallbacks: providers.slice(1), all: providers, primaryConfigName: providers[0]!.name };
}

const log = logger.child({ test: true });

describe('primary / fallback execution', () => {
  it('uses the primary provider when it succeeds and reports no fallback', async () => {
    const primary = provider('primary', async () => 'ok');
    const fallback = provider('fallback', async () => 'should-not-run');

    const outcome = await runWithFallback(chain(primary, fallback), 'SUMMARY', log, (p) => p.generateText({ system: '', prompt: '' }));

    expect(outcome.result.text).toBe('ok');
    expect(outcome.provider).toBe('primary');
    expect(outcome.model).toBe('primary-model');
    expect(outcome.fellBack).toBe(false);
  });

  it('falls back to the next provider on a transient failure', async () => {
    const primary = provider('primary', async () => {
      throw transientError('primary', ErrorCode.AI_PROVIDER_TIMEOUT, 'timed out');
    });
    const fallback = provider('fallback', async () => 'recovered');

    const outcome = await runWithFallback(chain(primary, fallback), 'SUMMARY', log, (p) => p.generateText({ system: '', prompt: '' }));

    expect(outcome.result.text).toBe('recovered');
    expect(outcome.provider).toBe('fallback');
    expect(outcome.fellBack).toBe(true);
  });

  it('falls back on HTTP 429 and 5xx style transient errors', async () => {
    for (const code of [ErrorCode.AI_PROVIDER_UNAVAILABLE, ErrorCode.AI_PROVIDER_TIMEOUT]) {
      const primary = provider('primary', async () => {
        throw transientError('primary', code, 'upstream problem');
      });
      const fallback = provider('fallback', async () => 'recovered');
      const outcome = await runWithFallback(chain(primary, fallback), 'SUMMARY', log, (p) => p.generateText({ system: '', prompt: '' }));
      expect(outcome.provider).toBe('fallback');
    }
  });

  it('does NOT fall back on a permanent failure (HTTP 400 / invalid input)', async () => {
    let fallbackCalled = false;
    const primary = provider('primary', async () => {
      throw permanentError('primary', ErrorCode.AI_PROVIDER_INVALID_REQUEST, 'HTTP 400');
    });
    const fallback = provider('fallback', async () => {
      fallbackCalled = true;
      return 'should-not-run';
    });

    await expect(
      runWithFallback(chain(primary, fallback), 'SUMMARY', log, (p) => p.generateText({ system: '', prompt: '' })),
    ).rejects.toMatchObject({ code: ErrorCode.AI_PROVIDER_INVALID_REQUEST });

    expect(fallbackCalled).toBe(false);
  });

  it('does NOT fall back when the AI response is invalid', async () => {
    let fallbackCalled = false;
    const primary = provider('primary', async () => {
      throw permanentError('primary', ErrorCode.AI_RESPONSE_INVALID, 'malformed JSON');
    });
    const fallback = provider('fallback', async () => {
      fallbackCalled = true;
      return 'should-not-run';
    });

    await expect(
      runWithFallback(chain(primary, fallback), 'ACTION_ITEMS', log, (p) => p.generateText({ system: '', prompt: '' })),
    ).rejects.toMatchObject({ code: ErrorCode.AI_RESPONSE_INVALID });

    expect(fallbackCalled).toBe(false);
  });

  it('walks the whole chain and then reports that every provider failed', async () => {
    const a = provider('a', async () => {
      throw transientError('a', ErrorCode.AI_PROVIDER_UNAVAILABLE, 'down');
    });
    const b = provider('b', async () => {
      throw transientError('b', ErrorCode.AI_PROVIDER_TIMEOUT, 'slow');
    });

    await expect(
      runWithFallback(chain(a, b), 'MIND_MAP', log, (p) => p.generateText({ system: '', prompt: '' })),
    ).rejects.toMatchObject({ code: ErrorCode.AI_ALL_PROVIDERS_FAILED });
  });

  it('tries providers in chain order', async () => {
    const order: string[] = [];
    const make = (name: string) =>
      provider(name, async () => {
        order.push(name);
        throw transientError(name, ErrorCode.AI_PROVIDER_UNAVAILABLE, 'down');
      });

    await expect(
      runWithFallback(chain(make('first'), make('second'), make('third')), 'SUMMARY', log, (p) => p.generateText({ system: '', prompt: '' })),
    ).rejects.toBeDefined();

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('succeeds on the third provider when the first two fail transiently', async () => {
    const a = provider('a', async () => {
      throw transientError('a', ErrorCode.AI_PROVIDER_UNAVAILABLE, 'down');
    });
    const b = provider('b', async () => {
      throw transientError('b', ErrorCode.AI_PROVIDER_TIMEOUT, 'slow');
    });
    const c = provider('c', async () => 'finally');

    const outcome = await runWithFallback(chain(a, b, c), 'SUMMARY', log, (p) => p.generateText({ system: '', prompt: '' }));
    expect(outcome.provider).toBe('c');
    expect(outcome.fellBack).toBe(true);
  });
});
