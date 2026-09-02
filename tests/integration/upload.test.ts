import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { prisma } from '@/lib/db';
import { createNoteFromUpload } from '@/lib/upload/service';
import { enqueueProcessingJob } from '@/lib/queue/producer';
import { audioSourcePath } from '@/lib/upload/storage';
import { JobStatus, NoteStatus } from '@/lib/domain';
import { ErrorCode } from '@/lib/errors';
import { configureProviders, createNoteWithJob, createUser, resetDatabase } from '@/tests/helpers/db';
import { integrationAvailable } from '@/tests/helpers/integration';

const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02, 0x03]);

/**
 * Upload handling, the missing-AI-configuration contract, and queue enqueue
 * (including duplicate protection). Requires PostgreSQL and Redis.
 */
describe.skipIf(!integrationAvailable)('upload', { skip: !integrationAvailable }, () => {
  beforeAll(resetDatabase);
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates a note, a QUEUED job and enqueues with jobId as the BullMQ id', async () => {
    await configureProviders();
    const user = await createUser('uploader@example.com');

    const result = await createNoteFromUpload(user.id, { filename: 'team-sync.mp3', mimeType: 'audio/mpeg', bytes: audio });

    const note = await prisma.note.findUnique({ where: { id: result.noteId } });
    expect(note!.status).toBe(NoteStatus.UPLOADED);
    expect(note!.sourcePath).toBe(audioSourcePath(result.noteId));

    const job = await prisma.job.findUnique({ where: { id: result.jobId } });
    expect(job!.status).toBe(JobStatus.QUEUED);
    expect(job!.userId).toBe(user.id);

    const queued = await enqueueProcessingJob({ jobId: result.jobId, noteId: result.noteId, userId: user.id });
    expect(queued.enqueued).toBe(false); // already enqueued by the upload
  });

  it('returns 503 AI_PROVIDER_NOT_CONFIGURED and creates NO note, job or queue entry', async () => {
    // Providers deliberately not configured.
    const user = await createUser('blocked@example.com');

    await expect(createNoteFromUpload(user.id, { filename: 'a.mp3', mimeType: 'audio/mpeg', bytes: audio })).rejects.toMatchObject({
      code: ErrorCode.AI_PROVIDER_NOT_CONFIGURED,
      status: 503,
    });

    expect(await prisma.note.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.job.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects an unsupported file type before creating anything', async () => {
    await configureProviders();
    const user = await createUser('pick@example.com');

    await expect(createNoteFromUpload(user.id, { filename: 'notes.txt', mimeType: 'text/plain', bytes: audio })).rejects.toMatchObject({
      code: ErrorCode.UPLOAD_UNSUPPORTED_TYPE,
    });
    expect(await prisma.note.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects an empty file', async () => {
    await configureProviders();
    const user = await createUser('empty@example.com');
    await expect(
      createNoteFromUpload(user.id, { filename: 'a.mp3', mimeType: 'audio/mpeg', bytes: new Uint8Array(0) }),
    ).rejects.toMatchObject({ code: ErrorCode.UPLOAD_EMPTY });
  });

  it('writes the audio to the server-generated path', async () => {
    await configureProviders();
    const user = await createUser('writer@example.com');
    const result = await createNoteFromUpload(user.id, { filename: 'a.mp3', mimeType: 'audio/mpeg', bytes: audio });

    const path = audioSourcePath(result.noteId);
    await mkdir(dirname(path), { recursive: true });
    const stats = await stat(path);
    expect(stats.size).toBe(audio.byteLength);

    await rm(path, { force: true });
  });

  it('does not enqueue the same jobId twice (duplicate job protection)', async () => {
    const user = await createUser('dupe@example.com');
    const { noteId, jobId } = await createNoteWithJob(user.id);

    const first = await enqueueProcessingJob({ jobId, noteId, userId: user.id });
    const second = await enqueueProcessingJob({ jobId, noteId, userId: user.id });

    expect(first.enqueued).toBe(true);
    expect(second.enqueued).toBe(false);
  });

  it('allows only one job per note at the database level', async () => {
    const user = await createUser('unique@example.com');
    const { noteId } = await createNoteWithJob(user.id);

    let rejected = false;
    try {
      await prisma.job.create({ data: { userId: user.id, noteId } });
    } catch (error) {
      rejected = (error as { code?: string }).code === 'P2002';
    }
    expect(rejected).toBe(true);
  });
});
