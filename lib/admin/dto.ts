import type { AdminJobDto } from '@/types';

/** Admin job row shape before DTO mapping. Lives in lib so both admin routes share it. */
export interface AdminJobRow {
  id: string;
  noteId: string;
  userId: string;
  status: string;
  stage: string;
  progress: number;
  providerUsed: string | null;
  modelUsed: string | null;
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
  user: { email: string };
  note: { title: string };
}

export function toAdminJobDto(row: AdminJobRow): AdminJobDto {
  return {
    id: row.id,
    noteId: row.noteId,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    providerUsed: row.providerUsed,
    modelUsed: row.modelUsed,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    attempts: row.attempts,
    watchdogRequeues: row.watchdogRequeues,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    userEmail: row.user.email,
    noteTitle: row.note.title,
  };
}
