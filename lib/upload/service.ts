import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { prisma, type PrismaTransactionClient } from '@/lib/db';
import { JobStage, JobStatus, NoteStatus } from '@/lib/domain';
import { AppError, ErrorCode } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertAiConfigured } from '@/lib/ai/registry';
import { enqueueProcessingJob } from '@/lib/queue/producer';
import { audioSourcePath, validateUpload } from '@/lib/upload/storage';
import type { ValidatedUpload } from '@/lib/upload/storage';

/**
 * Upload orchestration: validate -> save file -> create Note -> create Job
 * (QUEUED) -> enqueue BullMQ -> return.
 *
 * The note id is generated server-side before anything is written, so the
 * storage path is derived from it and never from client input.
 */

export interface UploadInput {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface UploadResult {
  noteId: string;
  jobId: string;
  validated: ValidatedUpload;
}

export async function createNoteFromUpload(userId: string, input: UploadInput): Promise<UploadResult> {
  // 1. Validate the file before any side effect.
  const validated = validateUpload({ filename: input.filename, mimeType: input.mimeType, size: input.bytes.byteLength });

  // AI configuration must exist before we create anything: a missing provider
  // is a 503 with NO note, NO job and NO queue entry.
  await assertAiConfigured();

  const noteId = randomUUID();
  const sourcePath = audioSourcePath(noteId);
  const title = validated.displayName.replace(/\.[^.]+$/, '').slice(0, 180) || 'Untitled meeting';

  // 2. Save the file to the server-generated path.
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, input.bytes);

  try {
    // 3 + 4. Note and Job are created atomically.
    const created = await prisma.$transaction(async (tx: PrismaTransactionClient) => {
      const note = await tx.note.create({
        data: {
          id: noteId,
          userId,
          title,
          sourcePath,
          originalName: validated.displayName,
          mimeType: validated.mimeType,
          fileSizeBytes: validated.size,
          status: NoteStatus.UPLOADED,
        },
        select: { id: true },
      });

      const job = await tx.job.create({
        data: {
          userId,
          noteId: note.id,
          status: JobStatus.QUEUED,
          stage: JobStage.QUEUED,
          progress: 0,
        },
        select: { id: true },
      });

      return { noteId: note.id as string, jobId: job.id as string };
    });

    // 5. Enqueue. The BullMQ job id IS the DB job id, so this is idempotent.
    await enqueueProcessingJob({ jobId: created.jobId, noteId: created.noteId, userId });

    logger.info('upload_accepted', { noteId: created.noteId, jobId: created.jobId, userId, size: validated.size });
    return { noteId: created.noteId, jobId: created.jobId, validated };
  } catch (error) {
    // Never leave an orphaned file behind if the database work failed.
    await rm(sourcePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Guard against absurd multipart bodies before buffering them. */
export function assertWithinMaxUpload(size: number, max: number): void {
  if (size > max) {
    throw new AppError(ErrorCode.UPLOAD_TOO_LARGE, 'Uploaded file exceeds the configured maximum size');
  }
}
