import { ok, readJson, route } from '@/lib/http/respond';
import { assertSameOrigin } from '@/lib/security/origin';
import { requireUser } from '@/lib/auth/sessions';
import { ActionItemPatchSchema, parseWith } from '@/lib/validation';
import { prisma } from '@/lib/db';
import { AppError, ErrorCode } from '@/lib/errors';
import type { ActionItemDto } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/action-items/:id — persists checkbox state (and optional edits).
 *
 * Ownership is resolved through the parent note, so a user cannot toggle
 * another user's action item even with a guessed id.
 */
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  assertSameOrigin(req);
  const user = await requireUser(req);
  const patch = parseWith(ActionItemPatchSchema, await readJson(req));

  const owned = (await prisma.actionItem.findFirst({
    where: { id: params.id, note: { userId: user.id } },
  })) as unknown as { id: string } | null;

  if (!owned) throw new AppError(ErrorCode.NOT_FOUND, 'Action item not found');

  const updated = (await prisma.actionItem.update({
    where: { id: params.id },
    data: {
      ...(patch.completed === undefined ? {} : { completed: patch.completed }),
      ...(patch.content === undefined ? {} : { content: patch.content }),
    },
  })) as unknown as {
    id: string;
    content: string;
    assignee: string | null;
    dueDate: string | null;
    completed: boolean;
    position: number;
    updatedAt: Date;
  };

  const dto: ActionItemDto = {
    id: updated.id,
    content: updated.content,
    assignee: updated.assignee,
    dueDate: updated.dueDate,
    completed: updated.completed,
    position: updated.position,
    updatedAt: updated.updatedAt.toISOString(),
  };
  return ok(dto);
});
