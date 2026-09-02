import { ok, route } from '@/lib/http/respond';
import { requireUser } from '@/lib/auth/sessions';
import { getOwnedNote } from '@/lib/auth/ownership';
import { prisma } from '@/lib/db';
import type { ActionItemDto } from '@/types';

export const dynamic = 'force-dynamic';

export const GET = route<{ noteId: string }>(async (req, { params }) => {
  const user = await requireUser(req);
  await getOwnedNote(user.id, params.noteId);

  const rows = (await prisma.actionItem.findMany({
    where: { noteId: params.noteId },
    orderBy: { position: 'asc' },
  })) as unknown as Array<{
    id: string;
    content: string;
    assignee: string | null;
    dueDate: string | null;
    completed: boolean;
    position: number;
    updatedAt: Date;
  }>;

  const items: ActionItemDto[] = rows.map((row) => ({
    id: row.id,
    content: row.content,
    assignee: row.assignee,
    dueDate: row.dueDate,
    completed: row.completed,
    position: row.position,
    updatedAt: row.updatedAt.toISOString(),
  }));

  return ok({ items });
});
