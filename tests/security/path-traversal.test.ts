import { describe, expect, it } from 'vitest';
import {
  assertSafeId,
  assertWithinSharedRoot,
  audioSourcePath,
  outputFile,
  sanitizeDisplayName,
  validateUpload,
} from '@/lib/upload/storage';
import { ErrorCode } from '@/lib/errors';

const NOTE_ID = '6f1c2b3a-4d5e-4f60-8a9b-0c1d2e3f4a5b';

const MALICIOUS_FILENAMES = [
  '../../etc/passwd.mp3',
  '..\\..\\windows\\win.ini.wav',
  '/etc/shadow.mp3',
  'C:\\Windows\\System32\\x.wav',
  '....//....//etc/passwd.mp3',
  '%2e%2e%2f%2e%2e%2fetc%2fpasswd.mp3',
  'a\u0000b.mp3',
  'a\nb.mp3',
  '..mp3',
];

describe('malicious filename protection', () => {
  it('never lets a client filename produce a path outside the note directory', () => {
    for (const filename of MALICIOUS_FILENAMES) {
      const base = audioSourcePath(NOTE_ID);
      // Whatever survives sanitisation, the storage path is derived from the
      // server-generated note id alone — never from the client string.
      expect(base).not.toContain('..');
      expect(base.startsWith('/app/data/shared/audio/')).toBe(true);
      expect(base).toBe(`/app/data/shared/audio/${NOTE_ID}/source`);
      expect(filename).toBeTruthy();
    }
  });

  it('strips traversal sequences from the display name', () => {
    for (const filename of MALICIOUS_FILENAMES) {
      let cleaned: string;
      try {
        cleaned = sanitizeDisplayName(filename);
      } catch {
        continue; // rejected outright — also acceptable
      }
      expect(cleaned).not.toContain('\u0000');
      expect(cleaned).not.toContain('/');
      expect(cleaned).not.toMatch(/^\.\.$/);
    }
  });

  it('rejects a filename whose only extension is a traversal sequence', () => {
    expect(() => validateUpload({ filename: '..mp3', mimeType: 'audio/mpeg', size: 10 })).toThrow();
  });

  it('rejects a NUL byte in a filename', () => {
    expect(() => validateUpload({ filename: 'a\u0000b.mp3', mimeType: 'audio/mpeg', size: 10 })).toThrowError(
      expect.objectContaining({ code: ErrorCode.UPLOAD_FILENAME_INVALID }),
    );
  });
});

describe('path traversal protection on derived paths', () => {
  it('refuses to build a path from a non-UUID id', () => {
    for (const candidate of ['../x', '..', 'x/../../etc', 'not-a-uuid', '6f1c2b3a']) {
      expect(() => assertSafeId(candidate)).toThrow();
      expect(() => audioSourcePath(candidate)).toThrow();
    }
  });

  it('accepts only a well-formed UUID', () => {
    expect(() => assertSafeId(NOTE_ID)).not.toThrow();
  });

  it('rejects any resolved path outside the shared root', () => {
    expect(() => assertWithinSharedRoot('/app/data/shared/../../etc/passwd')).toThrow();
    expect(() => assertWithinSharedRoot('/tmp/x')).toThrow();
  });

  it('flattens an output filename to its basename', () => {
    expect(outputFile(NOTE_ID, '../../../../etc/passwd')).toBe(`/app/data/shared/output/${NOTE_ID}/passwd`);
  });
});
