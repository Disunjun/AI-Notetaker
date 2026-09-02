import { env } from '@/lib/env';

/**
 * Structured JSON logger with mandatory secret redaction.
 *
 * Nothing sensitive may ever reach a log line: API keys, passwords, session
 * tokens, OTPs, magic-link tokens, full transcripts, full prompts and full AI
 * responses are all redacted — both by key name and by an explicit value scan.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const REDACTED_KEYS = new Set([
  'apikey',
  'api_key',
  'apikeyencrypted',
  'authorization',
  'cookie',
  'setcookie',
  'password',
  'passwordhash',
  'adminpassword',
  'token',
  'tokenthash',
  'tokenhash',
  'sessiontoken',
  'otphash',
  'otp',
  'otpcode',
  'signincode',
  'magiclink',
  'secret',
  'appsecret',
  'accesstoken',
  'refreshtoken',
]);

/** Substrings that indicate a credential-bearing value. */
const REDACTED_VALUE_PATTERNS: RegExp[] = [
  /^sk-[A-Za-z0-9_-]{8,}$/,
  /^re_[A-Za-z0-9_-]{8,}$/,
  /^AIza[0-9A-Za-z_-]{16,}$/,
  /^sk-ant-[A-Za-z0-9_-]{8,}$/,
  /^gsk_[A-Za-z0-9_-]{8,}$/,
  /^Bearer\s+\S+/i,
];

/** Longest value we allow through for transcript/prompt/response-ish keys. */
const TRUNCATED_KEYS = new Set(['transcript', 'prompt', 'response', 'content', 'summary', 'markdown', 'body']);
const TRUNCATE_LENGTH = 48;

export const REDACTION_PLACEHOLDER = '[REDACTED]';

function truncate(value: string): string {
  return value.length <= TRUNCATE_LENGTH ? value : `${value.slice(0, TRUNCATE_LENGTH)}…[truncated:${value.length}]`;
}

function redactValue(value: string): string {
  const trimmed = value.trim();
  if (REDACTED_VALUE_PATTERNS.some((p) => p.test(trimmed))) return REDACTION_PLACEHOLDER;
  return value;
}

function normaliseKey(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase();
}

/** Deep redaction — safe to hand any object to. */
export function redact(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[max-depth]';
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return redactValue(input);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (typeof input === 'bigint') return input.toString();
  if (input instanceof Date) return input.toISOString();
  if (input instanceof Error) {
    return { name: input.name, message: redactValue(input.message), stack: undefined };
  }
  if (Array.isArray(input)) return input.map((v) => redact(v, depth + 1));
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const nk = normaliseKey(k);
      if (REDACTED_KEYS.has(nk)) {
        out[k] = REDACTION_PLACEHOLDER;
        continue;
      }
      // A `code` key is ambiguous: it holds error codes (which observability
      // requires) but also 6-digit OTPs (which must never be logged). Only the
      // OTP shape is redacted.
      if (nk === 'code' && typeof v === 'string' && /^\d{6}$/.test(v)) {
        out[k] = REDACTION_PLACEHOLDER;
        continue;
      }
      if (TRUNCATED_KEYS.has(nk) && typeof v === 'string') {
        out[k] = truncate(v);
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return String(input);
}

export interface LogContext {
  requestId?: string;
  jobId?: string;
  noteId?: string;
  userId?: string;
  [key: string]: unknown;
}

function threshold(): number {
  const level = (process.env.LOG_LEVEL ?? env().LOG_LEVEL) as Level;
  return LEVELS[level] ?? LEVELS.info;
}

function emit(level: Level, message: string, context?: LogContext): void {
  if (LEVELS[level] < threshold()) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };
  const serialised = JSON.stringify(line);
  if (level === 'error') process.stderr.write(`${serialised}\n`);
  else process.stdout.write(`${serialised}\n`);
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
  /** Bind a correlation context that is attached to every subsequent line. */
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => emit('debug', m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => emit('info', m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => emit('warn', m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => emit('error', m, { ...base, ...c }),
    };
  },
};

export type Logger = ReturnType<typeof logger.child>;
