import { ok, route } from '@/lib/http/respond';
import { requireUser } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { getOwnedNote, toJobDto } from '@/lib/auth/ownership';
import type { NoteDetailDto } from '@/types';
import type { NoteDetailRow } from '@/types/internal';

export const dynamic = 'force-dynamic';

export const GET = route<{ noteId: string }>(async (req, { params }) => {
  const user = await requireUser(req);
  await getOwnedNote(user.id, params.noteId);

  const note = (await prisma.note.findUnique({
    where: { id: params.noteId },
    include: {
      jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
      transcript: { select: { id: true } },
      summary: { select: { id: true } },
      mindMap: { select: { id: true } },
      _count: { select: { actionItems: true } },
    },
  })) as unknown as NoteDetailRow | null;

  if (!note) return ok(null, { status: 404 });

  const detail: NoteDetailDto = {
    id: note.id,
    title: note.title,
    originalName: note.originalName,
    mimeType: note.mimeType,
    fileSizeBytes: note.fileSizeBytes,
    status: note.status,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    latestJob: note.jobs[0] ? toJobDto(note.jobs[0]!) : null,
    hasTranscript: Boolean(note.transcript),
    hasSummary: Boolean(note.summary),
    hasMindMap: Boolean(note.mindMap),
    actionItemCount: note._count.actionItems,
  };

  return ok(detail);
});
