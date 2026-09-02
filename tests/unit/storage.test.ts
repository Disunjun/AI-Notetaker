import { describe, expect, it } from 'vitest';
import {
  assertSafeId,
  assertWithinSharedRoot,
  audioSourcePath,
  outputFile,
  outputDirectory,
  SHARED_ROOT,
} from '@/lib/upload/storage';
import { ErrorCode } from '@/lib/errors';

const NOTE_ID = '6f1c2b3a-4d5e-4f60-8a9b-0c1d2e3f4a5b';

describe('server-generated storage paths', () => {
  it('places audio at <shared>/audio/<note-id>/source', () => {
    expect(audioSourcePath(NOTE_ID)).toBe(`${SHARED_ROOT}/audio/${NOTE_ID}/source`);
  });

  it('places output at <shared>/output/<note-id>/', () => {
    expect(outputDirectory(NOTE_ID)).toBe(`${SHARED_ROOT}/output/${NOTE_ID}`);
  });

  it('derives output file paths from the note id only', () => {
    expect(outputFile(NOTE_ID, 'summary.json')).toBe(`${SHARED_ROOT}/output/${NOTE_ID}/summary.json`);
  });

  it('refuses a non-UUID identifier', () => {
    expect(() => audioSourcePath('../../etc')).toThrowError(expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR }));
    expect(() => audioSourcePath('not-a-uuid')).toThrow();
    expect(() => assertSafeId('abc')).toThrow();
    expect(() => assertSafeId(NOTE_ID)).not.toThrow();
  });

  it('strips any directory component from an output name', () => {
    expect(outputFile(NOTE_ID, '../../../etc/passwd')).toBe(`${SHARED_ROOT}/output/${NOTE_ID}/passwd`);
  });

  it('rejects an empty output name', () => {
    expect(() => outputFile(NOTE_ID, '.')).toThrow();
    expect(() => outputFile(NOTE_ID, '')).toThrow();
  });
});

describe('path traversal protection', () => {
  it('accepts a path inside the shared root', () => {
    expect(assertWithinSharedRoot(`${SHARED_ROOT}/audio/x/source`)).toContain('/audio/x/source');
  });

  it('rejects a path that escapes the shared root', () => {
    expect(() => assertWithinSharedRoot(`${SHARED_ROOT}/../etc/passwd`)).toThrowError(
      expect.objectContaining({ code: ErrorCode.FORBIDDEN }),
    );
    expect(() => assertWithinSharedRoot('/etc/passwd')).toThrowError(expect.objectContaining({ code: ErrorCode.FORBIDDEN }));
    expect(() => assertWithinSharedRoot(`${SHARED_ROOT}/audio/../../../../secret`)).toThrow();
  });
});
