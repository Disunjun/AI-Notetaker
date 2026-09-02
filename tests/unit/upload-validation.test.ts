import { describe, expect, it } from 'vitest';
import { sanitizeDisplayName, validateUpload } from '@/lib/upload/storage';
import { ErrorCode } from '@/lib/errors';

const ok = { filename: 'meeting.mp3', mimeType: 'audio/mpeg', size: 1024 };

describe('upload validation', () => {
  it('accepts each supported extension', () => {
    for (const [filename, mimeType] of [
      ['a.mp3', 'audio/mpeg'],
      ['a.m4a', 'audio/mp4'],
      ['a.wav', 'audio/wav'],
      ['a.mpeg', 'audio/mpeg'],
    ]) {
      const result = validateUpload({ filename, mimeType, size: 1024 });
      expect(result.displayName).toBe(filename);
      expect(result.size).toBe(1024);
    }
  });

  it('rejects an unsupported extension with UPLOAD_UNSUPPORTED_TYPE', () => {
    expect(() => validateUpload({ filename: 'notes.txt', mimeType: 'text/plain', size: 10 })).toThrowError(
      expect.objectContaining({ code: ErrorCode.UPLOAD_UNSUPPORTED_TYPE }),
    );
    expect(() => validateUpload({ filename: 'evil.exe', mimeType: 'audio/mpeg', size: 10 })).toThrowError(
      expect.objectContaining({ code: ErrorCode.UPLOAD_UNSUPPORTED_TYPE }),
    );
  });

  it('rejects a missing extension', () => {
    expect(() => validateUpload({ filename: 'noextension', mimeType: 'audio/mpeg', size: 10 })).toThrowError(
      expect.objectContaining({ code: ErrorCode.UPLOAD_UNSUPPORTED_TYPE }),
    );
  });

  it('rejects an unsupported MIME type even when the extension is allowed', () => {
    expect(() => validateUpload({ filename: 'a.mp3', mimeType: 'application/x-msdownload', size: 10 })).toThrowError(
      expect.objectContaining({ code: ErrorCode.UPLOAD_UNSUPPORTED_TYPE }),
    );
  });

  it('ignores MIME parameters when matching', () => {
    expect(validateUpload({ filename: 'a.mp3', mimeType: 'audio/mpeg; codec=mp3', size: 10 }).mimeType).toBe('audio/mpeg');
  });

  it('rejects an empty file', () => {
    expect(() => validateUpload({ ...ok, size: 0 })).toThrowError(expect.objectContaining({ code: ErrorCode.UPLOAD_EMPTY }));
    expect(() => validateUpload({ ...ok, size: -1 })).toThrowError(expect.objectContaining({ code: ErrorCode.UPLOAD_EMPTY }));
  });

  it('rejects a file larger than MAX_UPLOAD_SIZE', () => {
    // MAX_UPLOAD_SIZE is 10 MB in the test environment.
    expect(() => validateUpload({ ...ok, size: 11 * 1024 * 1024 })).toThrowError(
      expect.objectContaining({ code: ErrorCode.UPLOAD_TOO_LARGE }),
    );
  });

  it('rejects a missing filename', () => {
    expect(() => validateUpload({ ...ok, filename: '' })).toThrowError(
      expect.objectContaining({ code: ErrorCode.UPLOAD_FILENAME_INVALID }),
    );
  });

  it('accepts a valid upload and reports the normalised extension', () => {
    const result = validateUpload({ filename: 'Team Sync.MP3', mimeType: 'AUDIO/MPEG', size: 2048 });
    expect(result.extension).toBe('mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.displayName).toBe('Team Sync.MP3');
  });
});

describe('filename sanitisation', () => {
  it('strips directory components', () => {
    expect(sanitizeDisplayName('../../etc/passwd.mp3')).toBe('passwd.mp3');
    expect(sanitizeDisplayName('..\\..\\windows\\system32\\x.wav')).toBe('x.wav');
    expect(sanitizeDisplayName('/absolute/path/audio.mp3')).toBe('audio.mp3');
  });

  it('rejects a name that reduces to nothing', () => {
    expect(() => sanitizeDisplayName('///')).toThrowError(expect.objectContaining({ code: ErrorCode.UPLOAD_FILENAME_INVALID }));
  });

  it('removes control characters and reserved characters', () => {
    const cleaned = sanitizeDisplayName('a\u0000b<>:"|?*c.mp3');
    expect(cleaned).not.toContain('\u0000');
    expect(cleaned).not.toMatch(/[<>:"|?*]/);
    expect(cleaned.endsWith('.mp3')).toBe(true);
  });

  it('collapses traversal sequences', () => {
    expect(sanitizeDisplayName('a....mp3')).not.toContain('..');
  });

  it('caps length', () => {
    expect(sanitizeDisplayName(`${'a'.repeat(400)}.mp3`).length).toBeLessThanOrEqual(200);
  });
});
