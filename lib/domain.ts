/**
 * Domain constants shared by web and worker.
 *
 * These mirror the Prisma enums in prisma/schema.prisma 1:1. They are declared
 * here (rather than imported from `@prisma/client`) so that the domain layer has
 * no dependency on generated ORM code — the dependency direction mandated by
 * F9 is app -> lib and worker -> lib.
 *
 * The values are string literals, which Prisma accepts directly for enum
 * columns, so no runtime enum import is required.
 */

export const AuthTokenType = {
  MAGIC_LINK: 'MAGIC_LINK',
  OTP: 'OTP',
} as const;
export type AuthTokenType = (typeof AuthTokenType)[keyof typeof AuthTokenType];

export const NoteStatus = {
  UPLOADED: 'UPLOADED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type NoteStatus = (typeof NoteStatus)[keyof typeof NoteStatus];

export const JobStatus = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const JobStage = {
  QUEUED: 'QUEUED',
  TRANSCRIPTION: 'TRANSCRIPTION',
  SUMMARY: 'SUMMARY',
  ACTION_ITEMS: 'ACTION_ITEMS',
  MIND_MAP: 'MIND_MAP',
  COMPLETED: 'COMPLETED',
} as const;
export type JobStage = (typeof JobStage)[keyof typeof JobStage];

export const ProviderRole = {
  TRANSCRIPTION: 'TRANSCRIPTION',
  TEXT: 'TEXT',
} as const;
export type ProviderRole = (typeof ProviderRole)[keyof typeof ProviderRole];

export const AIProviderType = {
  OPENAI: 'OPENAI',
  GROQ: 'GROQ',
  GOOGLE: 'GOOGLE',
  ANTHROPIC: 'ANTHROPIC',
  OPENAI_COMPATIBLE: 'OPENAI_COMPATIBLE',
} as const;
export type AIProviderType = (typeof AIProviderType)[keyof typeof AIProviderType];

export const EmailType = {
  MAGIC_LINK: 'MAGIC_LINK',
  OTP: 'OTP',
  RESULT: 'RESULT',
  FAILURE: 'FAILURE',
  TEST: 'TEST',
} as const;
export type EmailType = (typeof EmailType)[keyof typeof EmailType];

export const EmailStatus = {
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type EmailStatus = (typeof EmailStatus)[keyof typeof EmailStatus];

/** Queue name is fixed by the contract. */
export const QUEUE_NAME = 'ai-notetaker-processing';

/** BullMQ payload — never contains credentials. */
export interface ProcessingJobPayload {
  jobId: string;
  noteId: string;
  userId: string;
}

/** Session cookie names are fixed and must remain separate. */
export const USER_SESSION_COOKIE = 'ai_notetaker_session';
export const ADMIN_SESSION_COOKIE = 'ai_notetaker_admin_session';

/** Watchdog: a PROCESSING job with a heartbeat older than this is stale. */
export const WATCHDOG_STALE_AFTER_MS = 30 * 60 * 1000;
/** Hard cap on watchdog requeues for a single job. */
export const WATCHDOG_MAX_REQUEUES = 3;
/** Hard cap on BullMQ retries for a single job. */
export const JOB_MAX_ATTEMPTS = 3;
