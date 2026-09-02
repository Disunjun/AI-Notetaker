import { describe, expect, it } from 'vitest';
import { AppError, ErrorCode, FailureKind, failureKindFromHttpStatus, failureKindOf, httpStatusFor, isAppError } from '@/lib/errors';

describe('HTTP status mapping', () => {
  it('maps missing AI configuration to 503 as mandated', () => {
    expect(httpStatusFor(ErrorCode.AI_PROVIDER_NOT_CONFIGURED)).toBe(503);
  });

  it('maps not-found errors to 404 so ownership misses do not leak existence', () => {
    expect(httpStatusFor(ErrorCode.NOTE_NOT_FOUND)).toBe(404);
    expect(httpStatusFor(ErrorCode.JOB_NOT_FOUND)).toBe(404);
    expect(httpStatusFor(ErrorCode.NOT_FOUND)).toBe(404);
  });

  it('maps authentication and authorisation errors', () => {
    expect(httpStatusFor(ErrorCode.UNAUTHENTICATED)).toBe(401);
    expect(httpStatusFor(ErrorCode.ADMIN_CREDENTIALS_INVALID)).toBe(401);
    expect(httpStatusFor(ErrorCode.FORBIDDEN)).toBe(403);
    expect(httpStatusFor(ErrorCode.ORIGIN_REJECTED)).toBe(403);
  });

  it('maps upload errors', () => {
    expect(httpStatusFor(ErrorCode.UPLOAD_UNSUPPORTED_TYPE)).toBe(415);
    expect(httpStatusFor(ErrorCode.UPLOAD_TOO_LARGE)).toBe(413);
    expect(httpStatusFor(ErrorCode.UPLOAD_EMPTY)).toBe(400);
    expect(httpStatusFor(ErrorCode.UPLOAD_FILENAME_INVALID)).toBe(400);
  });

  it('maps rate limiting to 429', () => {
    expect(httpStatusFor(ErrorCode.RATE_LIMITED)).toBe(429);
  });

  it('defaults unknown codes to 500', () => {
    expect(httpStatusFor('SOMETHING_NEW')).toBe(500);
  });
});

describe('failure classification', () => {
  it('treats timeout, network, 429 and 5xx as transient', () => {
    expect(failureKindFromHttpStatus(429)).toBe(FailureKind.TRANSIENT);
    expect(failureKindFromHttpStatus(500)).toBe(FailureKind.TRANSIENT);
    expect(failureKindFromHttpStatus(502)).toBe(FailureKind.TRANSIENT);
    expect(failureKindFromHttpStatus(503)).toBe(FailureKind.TRANSIENT);
    expect(failureKindOf(ErrorCode.AI_PROVIDER_TIMEOUT)).toBe(FailureKind.TRANSIENT);
    expect(failureKindOf(ErrorCode.AI_PROVIDER_UNAVAILABLE)).toBe(FailureKind.TRANSIENT);
  });

  it('treats 400, invalid input, corrupt audio, unsupported format and invalid AI response as permanent', () => {
    expect(failureKindFromHttpStatus(400)).toBe(FailureKind.PERMANENT);
    expect(failureKindFromHttpStatus(404)).toBe(FailureKind.PERMANENT);
    expect(failureKindOf(ErrorCode.AI_PROVIDER_INVALID_REQUEST)).toBe(FailureKind.PERMANENT);
    expect(failureKindOf(ErrorCode.AI_RESPONSE_INVALID)).toBe(FailureKind.PERMANENT);
    expect(failureKindOf(ErrorCode.UPLOAD_UNSUPPORTED_TYPE)).toBe(FailureKind.PERMANENT);
    expect(failureKindOf(ErrorCode.UPLOAD_EMPTY)).toBe(FailureKind.PERMANENT);
    expect(failureKindOf(ErrorCode.VALIDATION_ERROR)).toBe(FailureKind.PERMANENT);
  });

  it('never allows missing AI configuration to be retried', () => {
    expect(failureKindOf(ErrorCode.AI_PROVIDER_NOT_CONFIGURED)).toBe(FailureKind.PERMANENT);
  });
});

describe('AppError', () => {
  it('carries its code and derived status', () => {
    const error = new AppError(ErrorCode.RATE_LIMITED, 'slow down');
    expect(isAppError(error)).toBe(true);
    expect(error.code).toBe(ErrorCode.RATE_LIMITED);
    expect(error.status).toBe(429);
    expect(error.safe).toBe(true);
  });

  it('supports an explicit status override and field errors', () => {
    const error = new AppError(ErrorCode.VALIDATION_ERROR, 'bad', { fields: { email: 'required' }, status: 422 });
    expect(error.status).toBe(422);
    expect(error.fields).toEqual({ email: 'required' });
  });

  it('is not confused with a plain Error', () => {
    expect(isAppError(new Error('nope'))).toBe(false);
  });
});
