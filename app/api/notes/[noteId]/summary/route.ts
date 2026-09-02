import { ok, route } from '@/lib/http/respond';
import { requireUser } from '@/lib/auth/sessions';
import { getOwnedNote } from '@/lib/auth/ownership';
import { prisma } from '@/lib/db';
import type { SummaryDto } from '@/types';

export const dynamic = 'force-dynamic';

export const GET = route<{ noteId: string }>(async (req, { params }) => {
  const user = await requireUser(req);
  await getOwnedNote(user.id, params.noteId);

  const row = (await prisma.summary.findUnique({ where: { noteId: params.noteId } })) as unknown as {
    content: string;
    provider: string;
    model: string;
    createdAt: Date;
  } | null;

  if (!row) return ok(null, { status: 404 });

  const dto: SummaryDto = {
    noteId: params.noteId,
    content: row.content,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
  return ok(dto);
});
