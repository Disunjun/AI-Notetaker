import { FailureKind } from '@/lib/errors';
import { ErrorCode } from '@/lib/errors';
import { AppError } from '@/lib/errors';
import type { AIProvider } from '@/lib/ai/types';
import type { ResolvedProviderChain } from '@/lib/ai/registry';
import type { Logger } from '@/lib/logger';

/**
 * Primary / fallback execution.
 *
 * Fallback is permitted ONLY for transient failures (timeout, network failure,
 * HTTP 429, HTTP 5xx). A permanent failure (HTTP 400, invalid input, corrupt
 * audio, unsupported format, invalid AI response) aborts immediately — falling
 * back would only repeat the same deterministic failure with another provider.
 */

export interface StageOutcome<T> {
  result: T;
  provider: string;
  model: string;
  fellBack: boolean;
}

export async function runWithFallback<T>(
  chain: ResolvedProviderChain,
  stage: string,
  log: Logger,
  invoke: (provider: AIProvider) => Promise<T>,
): Promise<StageOutcome<T>> {
  let lastError: unknown;

  for (let index = 0; index < chain.all.length; index += 1) {
    const provider = chain.all[index]!;
    try {
      const result = await invoke(provider);
      return { result, provider: provider.name, model: provider.model, fellBack: index > 0 };
    } catch (error) {
      lastError = error;
      const kind = readFailureKind(error);

      if (kind === FailureKind.PERMANENT) {
        log.error('stage_permanent_failure', {
          stage,
          provider: provider.name,
          code: readCode(error),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      const hasNext = index < chain.all.length - 1;
      log.warn('fallback', {
        stage,
        fromProvider: provider.name,
        toProvider: hasNext ? chain.all[index + 1]!.name : null,
        reason: error instanceof Error ? error.message : String(error),
        code: readCode(error),
      });

      if (!hasNext) break;
    }
  }

  throw new AppError(
    ErrorCode.AI_ALL_PROVIDERS_FAILED,
    `All configured providers failed for stage ${stage}`,
    { cause: lastError },
  );
}

function readFailureKind(error: unknown): FailureKind {
  const candidate = error as { kind?: FailureKind };
  return candidate && candidate.kind === FailureKind.PERMANENT ? FailureKind.PERMANENT : FailureKind.TRANSIENT;
}

function readCode(error: unknown): string {
  const candidate = error as { code?: string };
  return typeof candidate?.code === 'string' ? candidate.code : 'UNKNOWN';
}
