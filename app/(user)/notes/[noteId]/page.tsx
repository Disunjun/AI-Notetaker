import { notFound } from 'next/navigation';
import { resolveUser } from '@/lib/auth/sessions';
import { getOwnedJob, getOwnedNote, toJobDto } from '@/lib/auth/ownership';
import { prisma } from '@/lib/db';
import { NoteView, type NoteViewProps } from '@/components/NoteView';
import type { ActionItemDto, JobDto, MindMapDto, SummaryDto, TranscriptDto } from '@/types';

export const dynamic = 'force-dynamic';

interface TranscriptRow {
  language: string | null;
  content: string;
  provider: string;
  model: string;
  createdAt: Date;
}
interface SummaryRow {
  content: string;
  provider: string;
  model: string;
  createdAt: Date;
}
interface ActionItemRow {
  id: string;
  content: string;
  assignee: string | null;
  dueDate: string | null;
  completed: boolean;
  position: number;
  updatedAt: Date;
}
interface MindMapRow {
  markdown: string;
  provider: string;
  model: string;
  createdAt: Date;
}
interface JobRefRow {
  id: string;
}

export default async function NotePage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  const user = await resolveUser();
  if (!user) notFound();

  let note;
  try {
    note = await getOwnedNote(user!.id, noteId);
  } catch {
    // Identical 404 for "does not exist" and "belongs to someone else".
    notFound();
  }

  const [transcript, summary, actionItems, mindMap, jobRef] = await Promise.all([
    prisma.transcript.findUnique({ where: { noteId } }) as unknown as Promise<TranscriptRow | null>,
    prisma.summary.findUnique({ where: { noteId } }) as unknown as Promise<SummaryRow | null>,
    prisma.actionItem.findMany({ where: { noteId }, orderBy: { position: 'asc' } }) as unknown as Promise<ActionItemRow[]>,
    prisma.mindMap.findUnique({ where: { noteId } }) as unknown as Promise<MindMapRow | null>,
    prisma.job.findFirst({ where: { noteId }, orderBy: { createdAt: 'desc' }, select: { id: true } }) as unknown as Promise<JobRefRow | null>,
  ]);

  const jobDto: JobDto | null = jobRef ? toJobDto(await getOwnedJob(user!.id, jobRef.id)) : null;

  const transcriptDto: TranscriptDto | null = transcript
    ? {
        noteId,
        language: transcript.language,
        content: transcript.content,
        provider: transcript.provider,
        model: transcript.model,
        createdAt: transcript.createdAt.toISOString(),
      }
    : null;

  const summaryDto: SummaryDto | null = summary
    ? { noteId, content: summary.content, provider: summary.provider, model: summary.model, createdAt: summary.createdAt.toISOString() }
    : null;

  const actionItemDtos: ActionItemDto[] = actionItems.map((row) => ({
    id: row.id,
    content: row.content,
    assignee: row.assignee,
    dueDate: row.dueDate,
    completed: row.completed,
    position: row.position,
    updatedAt: row.updatedAt.toISOString(),
  }));

  const mindMapDto: MindMapDto | null = mindMap
    ? { noteId, markdown: mindMap.markdown, provider: mindMap.provider, model: mindMap.model, createdAt: mindMap.createdAt.toISOString() }
    : null;

  const props: NoteViewProps = {
    noteId,
    title: note!.title,
    originalName: note!.originalName,
    status: note!.status,
    job: jobDto,
    transcript: transcriptDto,
    summary: summaryDto,
    actionItems: actionItemDtos,
    mindMap: mindMapDto,
  };

  return <NoteView {...props} />;
}
