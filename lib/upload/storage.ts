import path from 'node:path';
import { AppError, ErrorCode } from '@/lib/errors';
import { env } from '@/lib/env';

/**
 * Upload validation and storage paths.
 *
 * Storage paths are ALWAYS server-generated from the note id. A client-supplied
 * filename is used only for display, after sanitisation, and is never part of a
 * filesystem path.
 */

export const SHARED_ROOT = process.env.SHARED_STORAGE_ROOT ?? '/app/data/shared';

export const ALLOWED_AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'mpeg'] as const;
export type AllowedAudioExtension = (typeof ALLOWED_AUDIO_EXTENSIONS)[number];

export const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
] as const;

export interface UploadValidationInput {
  filename: string;
  mimeType: string;
  size: number;
}

export interface ValidatedUpload {
  extension: AllowedAudioExtension;
  mimeType: string;
  size: number;
  /** Sanitised display name only — never used to build a path. */
  displayName: string;
}

/** Strip anything that could escape a directory or confuse a filesystem. */
export function sanitizeDisplayName(filename: string): string {
  const base = filename
    // Drop any directory component (both separators, plus URL-encoded forms).
    .replace(/\\/g, '/')
    .split('/')
    .pop();
  if (!base) throw new AppError(ErrorCode.UPLOAD_FILENAME_INVALID, 'Filename is invalid');

  // Strip control characters by code point (avoids control-character regexes).
  const withoutControl = Array.from(base)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');

  const cleaned = withoutControl
    .replace(/\.\.+/g, '.')
    .replace(/[<>:"/\\|?*]/g, '_')
    .trim();

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new AppError(ErrorCode.UPLOAD_FILENAME_INVALID, 'Filename is invalid');
  }
  return cleaned.slice(0, 200);
}

export function validateUpload(input: UploadValidationInput): ValidatedUpload {
  const { filename, mimeType, size } = input;

  if (!filename || filename.trim().length === 0) {
    throw new AppError(ErrorCode.UPLOAD_FILENAME_INVALID, 'Filename is required');
  }
  if (filename.length > 512) {
    throw new AppError(ErrorCode.UPLOAD_FILENAME_INVALID, 'Filename is too long');
  }
  if (filename.includes('\0')) {
    throw new AppError(ErrorCode.UPLOAD_FILENAME_INVALID, 'Filename contains illegal characters');
  }

  const displayName = sanitizeDisplayName(filename);

  const dotIndex = displayName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === displayName.length - 1) {
    throw new AppError(ErrorCode.UPLOAD_UNSUPPORTED_TYPE, 'File must have an extension');
  }
  const extension = displayName.slice(dotIndex + 1).toLowerCase();
  if (!ALLOWED_AUDIO_EXTENSIONS.includes(extension as AllowedAudioExtension)) {
    throw new AppError(
      ErrorCode.UPLOAD_UNSUPPORTED_TYPE,
      `Unsupported file type. Allowed: ${ALLOWED_AUDIO_EXTENSIONS.join(', ')}`,
    );
  }

  const normalisedMime = (mimeType || '').split(';')[0]!.trim().toLowerCase();
  if (!ALLOWED_AUDIO_MIME_TYPES.includes(normalisedMime as (typeof ALLOWED_AUDIO_MIME_TYPES)[number])) {
    throw new AppError(ErrorCode.UPLOAD_UNSUPPORTED_TYPE, 'Unsupported media type');
  }

  if (!Number.isFinite(size) || size <= 0) {
    throw new AppError(ErrorCode.UPLOAD_EMPTY, 'Uploaded file is empty');
  }
  const max = env().MAX_UPLOAD_SIZE;
  if (size > max) {
    throw new AppError(ErrorCode.UPLOAD_TOO_LARGE, `File exceeds the ${Math.floor(max / 1024 / 1024)}MB limit`);
  }

  return { extension: extension as AllowedAudioExtension, mimeType: normalisedMime, size, displayName };
}

/**
 * Server-generated storage paths.
 *   audio : <shared>/audio/<note-id>/source
 *   output: <shared>/output/<note-id>/
 */
export function audioSourcePath(noteId: string): string {
  assertSafeId(noteId);
  return path.posix.join(normaliseRoot(), 'audio', noteId, 'source');
}

export function outputDirectory(noteId: string): string {
  assertSafeId(noteId);
  return path.posix.join(normaliseRoot(), 'output', noteId);
}

export function outputFile(noteId: string, name: string): string {
  assertSafeId(noteId);
  const safe = path.posix.basename(name);
  if (!safe || safe === '.' || safe === '..') throw new AppError(ErrorCode.UPLOAD_FILENAME_INVALID, 'Invalid output name');
  return path.posix.join(outputDirectory(noteId), safe);
}

function normaliseRoot(): string {
  return SHARED_ROOT.replace(/\/+$/, '') || '/app/data/shared';
}

/** Defence in depth: ids used in paths must be UUIDs. */
export function assertSafeId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid identifier');
  }
}

/** Reject any path that escapes the shared root (path traversal protection). */
export function assertWithinSharedRoot(candidate: string): string {
  const resolved = path.posix.resolve(candidate);
  const root = path.posix.resolve(normaliseRoot());
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Path escapes the shared storage root');
  }
  return resolved;
}
