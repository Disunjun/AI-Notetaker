import type { ErrorCode } from '@/lib/errors';

/** Row shapes returned to API clients. Mirrors the Prisma models in F2. */

export interface UserDto {
  id: string;
  email: string;
  createdAt: string;
}

export interface NoteListItemDto {
  id: string;
  title: string;
  originalName: string;
  fileSizeBytes: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  latestJob: JobDto | null;
}

export interface NoteDetailDto extends NoteListItemDto {
  mimeType: string;
  hasTranscript: boolean;
  hasSummary: boolean;
  hasMindMap: boolean;
  actionItemCount: number;
}

export interface JobDto {
  id: string;
  noteId: string;
  status: string;
  stage: string;
  progress: number;
  providerUsed: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
}

export interface QueuePositionDto {
  jobId: string;
  position: number | null;
  totalWaiting: number;
  estimatedWaitSeconds: number | null;
}

export interface TranscriptDto {
  noteId: string;
  language: string | null;
  content: string;
  provider: string;
  model: string;
  createdAt: string;
}

export interface SummaryDto {
  noteId: string;
  content: string;
  provider: string;
  model: string;
  createdAt: string;
}

export interface ActionItemDto {
  id: string;
  content: string;
  assignee: string | null;
  dueDate: string | null;
  completed: boolean;
  position: number;
  updatedAt: string;
}

export interface MindMapDto {
  noteId: string;
  markdown: string;
  provider: string;
  model: string;
  createdAt: string;
}

export interface ServiceStatusDto {
  emailConfigured: boolean;
  aiConfigured: boolean;
  otpEnabled: boolean;
  magicLinkEnabled: boolean;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AIProviderConfigDto {
  id: string;
  role: string;
  name: string;
  provider: string;
  baseUrl: string | null;
  model: string;
  isPrimary: boolean;
  priority: number;
  isActive: boolean;
  timeoutMs: number;
  /** Always masked. The real key never leaves the server. */
  apiKeyMasked: string;
  hasApiKey: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResendConfigDto {
  id: string;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  isActive: boolean;
  apiKeyMasked: string;
  hasApiKey: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  updatedAt: string;
}

export interface AdminJobDto extends JobDto {
  userEmail: string;
  noteTitle: string;
  watchdogRequeues: number;
  lastHeartbeatAt: string | null;
  modelUsed: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UsageRowDto {
  id: string;
  jobId: string;
  userEmail: string;
  provider: string;
  model: string;
  audioSeconds: number | null;
  totalTokens: number | null;
  estimatedCost: string;
  currency: string;
  createdAt: string;
}

export interface UsageSummaryDto {
  totalJobs: number;
  totalAudioSeconds: number;
  totalTokens: number;
  totalEstimatedCost: string;
  currency: string;
}

export interface EmailLogDto {
  id: string;
  type: string;
  status: string;
  to: string;
  subject: string | null;
  jobId: string | null;
  messageId: string | null;
  error: string | null;
  createdAt: string;
}

export interface QueueHealthDto {
  queueName: string;
  connected: boolean;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  workerConcurrency: number;
  staleProcessingJobs: number;
  stuckQueuedJobs: number;
}

export interface ProviderTestResultDto {
  ok: boolean;
  provider: string;
  latencyMs: number;
  error: string | null;
}

export interface ProviderModelsDto {
  models: string[];
}

export interface EmailSendOptions {
  type: 'MAGIC_LINK' | 'OTP' | 'RESULT' | 'FAILURE' | 'TEST';
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
  userId?: string | null;
  jobId?: string | null;
}

export type { ErrorCode };
