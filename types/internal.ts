import type { OwnedJob } from '@/lib/auth/ownership';

/** Internal row shapes used by route handlers before DTO mapping. */
export type OwnedJobLike = OwnedJob;

export interface NoteDetailRow {
  id: string;
  userId: string;
  title: string;
  originalName: string;
  mimeType: string;
  fileSizeBytes: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  jobs: OwnedJob[];
  _count: { actionItems: number };
  transcript: { id: string } | null;
  summary: { id: string } | null;
  mindMap: { id: string } | null;
}
