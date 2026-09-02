import { AppError, ErrorCode, FailureKind, failureKindFromHttpStatus } from '@/lib/errors';

/**
 * Provider abstraction.
 *
 * Every provider implements the same four operations. Configuration is read
 * from PostgreSQL at job start — never from environment variables, and never
 * cached across jobs.
 */

export interface TranscribeInput {
  /** Absolute path to the source audio file. */
  filePath: string;
  /** Suggested output name including extension, e.g. `source.mp3`. */
  fileName: string;
  mimeType: string;
}

export interface TranscribeResult {
  text: string;
  language: string | null;
  provider: string;
  model: string;
  audioSeconds: number | null;
}

export interface GenerateTextInput {
  system: string;
  prompt: string;
  /** Keep JSON outputs parseable. */
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  temperature?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GenerateTextResult {
  text: string;
  provider: string;
  model: string;
  usage: TokenUsage;
}

export interface AIProvider {
  readonly name: string;
  readonly type: string;
  readonly model: string;
  readonly role: string;

  testConnection(): Promise<void>;
  listModels(): Promise<string[]>;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
}

/**
 * Error raised by provider calls. `kind` drives both retry and fallback:
 * TRANSIENT (timeout, network, 429, 5xx) may fall back and retry; PERMANENT
 * (400, invalid input, corrupt audio, unsupported format, invalid AI response)
 * must not.
 */
export class AiCallError extends AppError {
  readonly kind: FailureKind;
  readonly provider: string;

  constructor(options: {
    code: ErrorCode;
    message: string;
    kind: FailureKind;
    provider: string;
    cause?: unknown;
    safe?: boolean;
  }) {
    super(options.code, options.message, { safe: options.safe ?? false, cause: options.cause });
    this.name = 'AiCallError';
    this.kind = options.kind;
    this.provider = options.provider;
  }
}

export function transientError(provider: string, code: ErrorCode, message: string, cause?: unknown): AiCallError {
  return new AiCallError({ code, message, kind: FailureKind.TRANSIENT, provider, cause });
}

export function permanentError(provider: string, code: ErrorCode, message: string, cause?: unknown): AiCallError {
  return new AiCallError({ code, message, kind: FailureKind.PERMANENT, provider, cause });
}

export function errorFromHttpStatus(provider: string, status: number, detail: string): AiCallError {
  const kind = failureKindFromHttpStatus(status);
  const code =
    status === 429
      ? ErrorCode.AI_PROVIDER_UNAVAILABLE
      : kind === FailureKind.TRANSIENT
        ? ErrorCode.AI_PROVIDER_UNAVAILABLE
        : ErrorCode.AI_PROVIDER_INVALID_REQUEST;
  return new AiCallError({
    code,
    message: `Provider returned HTTP ${status}: ${detail}`.slice(0, 500),
    kind,
    provider,
  });
}

/** Thrown when a provider does not implement the requested capability. */
export function unsupportedCapability(provider: string, capability: 'transcribe' | 'generateText'): AiCallError {
  return permanentError(
    provider,
    ErrorCode.AI_PROVIDER_INVALID_REQUEST,
    `Provider ${provider} does not support ${capability}`,
  );
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' || error.name === 'AbortError' || /aborted|timeout/i.test(error.message);
  }
  return false;
}
