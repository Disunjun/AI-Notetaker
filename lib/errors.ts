/**
 * Single source of truth for the error catalogue and the HTTP status each error
 * maps to. Route handlers never invent ad-hoc error shapes: they call `fail()`
 * from lib/http/respond.ts, which serialises the envelope mandated by F3.
 */

export const ErrorCode = {
  // generic
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  ORIGIN_REJECTED: 'ORIGIN_REJECTED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',

  // authentication
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_USED: 'TOKEN_USED',
  OTP_INVALID: 'OTP_INVALID',
  EMAIL_INVALID: 'EMAIL_INVALID',
  ADMIN_CREDENTIALS_INVALID: 'ADMIN_CREDENTIALS_INVALID',

  // notes / uploads
  NOTE_NOT_FOUND: 'NOTE_NOT_FOUND',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  UPLOAD_UNSUPPORTED_TYPE: 'UPLOAD_UNSUPPORTED_TYPE',
  UPLOAD_TOO_LARGE: 'UPLOAD_TOO_LARGE',
  UPLOAD_EMPTY: 'UPLOAD_EMPTY',
  UPLOAD_FILENAME_INVALID: 'UPLOAD_FILENAME_INVALID',
  UPLOAD_MISSING: 'UPLOAD_MISSING',

  // ai
  AI_PROVIDER_NOT_CONFIGURED: 'AI_PROVIDER_NOT_CONFIGURED',
  AI_PROVIDER_TIMEOUT: 'AI_PROVIDER_TIMEOUT',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  AI_PROVIDER_INVALID_REQUEST: 'AI_PROVIDER_INVALID_REQUEST',
  AI_RESPONSE_INVALID: 'AI_RESPONSE_INVALID',
  AI_ALL_PROVIDERS_FAILED: 'AI_ALL_PROVIDERS_FAILED',

  // email
  EMAIL_NOT_CONFIGURED: 'EMAIL_NOT_CONFIGURED',
  EMAIL_SEND_FAILED: 'EMAIL_SEND_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 500,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  ORIGIN_REJECTED: 403,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,

  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  TOKEN_INVALID: 400,
  TOKEN_EXPIRED: 400,
  TOKEN_USED: 400,
  OTP_INVALID: 400,
  EMAIL_INVALID: 400,
  ADMIN_CREDENTIALS_INVALID: 401,

  NOTE_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404,
  UPLOAD_UNSUPPORTED_TYPE: 415,
  UPLOAD_TOO_LARGE: 413,
  UPLOAD_EMPTY: 400,
  UPLOAD_FILENAME_INVALID: 400,
  UPLOAD_MISSING: 400,

  // 503 exactly as mandated for missing AI configuration.
  AI_PROVIDER_NOT_CONFIGURED: 503,
  AI_PROVIDER_TIMEOUT: 504,
  AI_PROVIDER_UNAVAILABLE: 502,
  AI_PROVIDER_INVALID_REQUEST: 400,
  AI_RESPONSE_INVALID: 502,
  AI_ALL_PROVIDERS_FAILED: 502,

  EMAIL_NOT_CONFIGURED: 503,
  EMAIL_SEND_FAILED: 502,
};

export function httpStatusFor(code: string): number {
  return STATUS_BY_CODE[code] ?? 500;
}

/**
 * A domain error carrying a stable machine-readable code. `safe` means the
 * message is safe to return to a client; unsafe messages are replaced by a
 * generic one and only logged server-side.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly safe: boolean;
  readonly fields?: Record<string, string>;
  readonly cause?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options: { safe?: boolean; fields?: Record<string, string>; cause?: unknown; status?: number } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? httpStatusFor(code);
    this.safe = options.safe ?? true;
    this.fields = options.fields;
    this.cause = options.cause;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

// ---------------------------------------------------------------------------
// Failure classification used by the retry + fallback logic.
// ---------------------------------------------------------------------------

export const FailureKind = {
  /** Timeout, network failure, HTTP 429 or HTTP 5xx. Retryable + fallback. */
  TRANSIENT: 'TRANSIENT',
  /** HTTP 400, invalid input, corrupt audio, unsupported format, invalid AI
   *  response. Never retried, never falls back. */
  PERMANENT: 'PERMANENT',
} as const;
export type FailureKind = (typeof FailureKind)[keyof typeof FailureKind];

const PERMANENT_CODES: ReadonlySet<string> = new Set<string>([
  ErrorCode.AI_PROVIDER_INVALID_REQUEST,
  ErrorCode.AI_RESPONSE_INVALID,
  ErrorCode.VALIDATION_ERROR,
  ErrorCode.UPLOAD_UNSUPPORTED_TYPE,
  ErrorCode.UPLOAD_TOO_LARGE,
  ErrorCode.UPLOAD_EMPTY,
  ErrorCode.UPLOAD_FILENAME_INVALID,
  ErrorCode.UPLOAD_MISSING,
  ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
]);

export function failureKindOf(code: string): FailureKind {
  return PERMANENT_CODES.has(code) ? FailureKind.PERMANENT : FailureKind.TRANSIENT;
}

/** Map an upstream HTTP status to a failure kind. */
export function failureKindFromHttpStatus(status: number): FailureKind {
  if (status === 429 || status >= 500) return FailureKind.TRANSIENT;
  if (status >= 400 && status < 500) return FailureKind.PERMANENT;
  return FailureKind.TRANSIENT;
}
