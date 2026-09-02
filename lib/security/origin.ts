import { AppError, ErrorCode } from '@/lib/errors';
import { env } from '@/lib/env';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF / origin protection.
 *
 * Every mutating request must carry an Origin (or Referer) header whose origin
 * matches APP_URL. Requests with no Origin header at all are rejected: the
 * application's own browser clients always send one, and rejecting the
 * ambiguous case is the safer default for a cookie-authenticated API.
 */
export function assertSameOrigin(req: Request): void {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return;

  const expected = new URL(env().APP_URL).origin;
  const header = req.headers.get('origin') ?? req.headers.get('referer');

  if (!header) {
    throw new AppError(ErrorCode.ORIGIN_REJECTED, 'Missing Origin header');
  }

  let actual: string;
  try {
    actual = new URL(header).origin;
  } catch {
    throw new AppError(ErrorCode.ORIGIN_REJECTED, 'Malformed Origin header');
  }

  if (actual !== expected) {
    throw new AppError(ErrorCode.ORIGIN_REJECTED, 'Origin not allowed');
  }
}
