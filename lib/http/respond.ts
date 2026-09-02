import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode, httpStatusFor, isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { assertSameOrigin } from '@/lib/security/origin';

/**
 * F3 response envelope.
 *   success -> { "data": {...} }
 *   error   -> { "error": { "code", "message", "fields" } }
 */

export const REQUEST_ID_HEADER = 'x-request-id';

export function ok<T>(data: T, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify({ data }), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
  });
}

export function fail(
  code: ErrorCode,
  message: string,
  options: { status?: number; fields?: Record<string, string>; headers?: Record<string, string> } = {},
): Response {
  return new Response(
    JSON.stringify({
      error: { code, message, fields: options.fields ?? {} },
    }),
    {
      status: options.status ?? httpStatusFor(code),
      headers: { 'content-type': 'application/json; charset=utf-8', ...options.headers },
    },
  );
}

/** Convert a Zod issue list into the `fields` map of the error envelope. */
export function fieldsFromZodIssues(issues: Array<{ path: Array<string | number>; message: string }>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export interface ResolvedContext<P> {
  params: P;
  requestId: string;
}

export type RouteHandler<P> = (req: Request, ctx: ResolvedContext<P>) => Promise<Response> | Response;

interface RouteOptions {
  /**
   * Reject requests whose Origin/Referer does not match APP_URL on mutating
   * methods (CSRF/origin protection). Enabled by default.
   */
  originCheck?: boolean;
}

function extractRequestId(req: Request): string {
  const incoming = req.headers.get(REQUEST_ID_HEADER);
  // Only accept a caller-supplied id if it is a plausible id — never echo
  // arbitrary attacker-controlled strings into our logs.
  if (incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming)) return incoming;
  return randomUUID();
}

function toErrorResponse(error: unknown, requestId: string): Response {
  if (isAppError(error)) {
    const response = fail(error.code, error.safe ? error.message : 'Request failed', {
      status: error.status,
      fields: error.fields,
      headers: { [REQUEST_ID_HEADER]: requestId },
    });
    if (error.status >= 500) {
      logger.error('request_failed', { requestId, code: error.code, status: error.status, detail: error.message });
    } else {
      logger.info('request_rejected', { requestId, code: error.code, status: error.status });
    }
    return response;
  }

  logger.error('request_error', {
    requestId,
    code: ErrorCode.INTERNAL_ERROR,
    error: error instanceof Error ? error.message : String(error),
  });
  return fail(ErrorCode.INTERNAL_ERROR, env().NODE_ENV === 'production' ? 'Internal server error' : 'Internal server error', {
    status: 500,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

/**
 * Wraps a route handler with: request-id correlation, envelope serialisation,
 * Zod/AppError translation and structured access logging.
 */
export function route<P extends Record<string, string>>(handler: RouteHandler<P>, options: RouteOptions = {}) {
  const originCheck = options.originCheck ?? true;
  return async (req: Request, nextCtx: { params: Promise<P> }): Promise<Response> => {
    const requestId = extractRequestId(req);
    const startedAt = Date.now();
    try {
      // Defence in depth: origin/CSRF protection is on by default for every
      // route, so a new handler cannot forget it.
      if (originCheck) assertSameOrigin(req);
      const params = await nextCtx.params;
      const response = await handler(req, { params, requestId });
      response.headers.set(REQUEST_ID_HEADER, requestId);
      logger.info('http_request', {
        requestId,
        method: req.method,
        path: new URL(req.url).pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      const response = toErrorResponse(error, requestId);
      logger.info('http_request', {
        requestId,
        method: req.method,
        path: new URL(req.url).pathname,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return response;
    }
  };
}

/** Read and validate a JSON body, throwing a VALIDATION_ERROR AppError on failure. */
export async function readJson(req: Request): Promise<unknown> {
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Request body could not be read');
  }
  if (!raw) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Request body is required');
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Request body must be valid JSON');
  }
}
