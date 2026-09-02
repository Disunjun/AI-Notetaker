import { prisma } from '@/lib/db';
import { AppError, ErrorCode } from '@/lib/errors';

/**
 * Ownership checks — the core IDOR/BOLA protection.
 *
 * Every lookup is scoped by userId. A resource that exists but belongs to
 * someone else produces the same 404 as one that does not exist at all, so the
 * API never leaks the existence of another user's data.
 */

export interface OwnedNote {
  id: string;
  userId: string;
  title: string;
  originalName: string;
  mimeType: string;
  fileSizeBytes: number;
  sourcePath: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getOwnedNote(userId: string, noteId: string): Promise<OwnedNote> {
  const note = (await prisma.note.findFirst({
    where: { id: noteId, userId },
  })) as unknown as OwnedNote | null;
  if (!note) throw new AppError(ErrorCode.NOTE_NOT_FOUND, 'Note not found');
  return note;
}

export interface OwnedJob {
  id: string;
  noteId: string;
  userId: string;
  status: string;
  stage: string;
  progress: number;
  providerUsed: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  watchdogRequeues: number;
  lastHeartbeatAt: Date | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getOwnedJob(userId: string, jobId: string): Promise<OwnedJob> {
  const job = (await prisma.job.findFirst({ where: { id: jobId, userId } })) as unknown as OwnedJob | null;
  if (!job) throw new AppError(ErrorCode.JOB_NOT_FOUND, 'Job not found');
  return job;
}

export function toJobDto(job: OwnedJob) {
  return {
    id: job.id,
    noteId: job.noteId,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    providerUsed: job.providerUsed,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    attempts: job.attempts,
    queuedAt: job.queuedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    failedAt: job.failedAt?.toISOString() ?? null,
  };
}
