import { ok, route } from '@/lib/http/respond';
import { requireUser } from '@/lib/auth/sessions';
import { prisma } from '@/lib/db';
import { buildPage, parsePagination, skipFor } from '@/lib/pagination';
import { toJobDto } from '@/lib/auth/ownership';
import type { NoteListItemDto } from '@/types';
import type { OwnedJobLike } from '@/types/internal';

export const dynamic = 'force-dynamic';

interface NoteRow {
  id: string;
  title: string;
  originalName: string;
  fileSizeBytes: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  jobs: OwnedJobLike[];
}

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const pagination = parsePagination(new URL(req.url).searchParams);

  const [rows, total] = await Promise.all([
    prisma.note.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      skip: skipFor(pagination),
      take: pagination.pageSize,
      include: { jobs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    }) as unknown as Promise<NoteRow[]>,
    prisma.note.count({ where: { userId: user.id } }),
  ]);

  const items: NoteListItemDto[] = rows.map((note) => ({
    id: note.id,
    title: note.title,
    originalName: note.originalName,
    fileSizeBytes: note.fileSizeBytes,
    status: note.status,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    latestJob: note.jobs[0] ? toJobDto(note.jobs[0]!) : null,
  }));

  return ok(buildPage(items, total, pagination));
});
