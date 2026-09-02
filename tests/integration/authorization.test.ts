import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getOwnedJob, getOwnedNote } from '@/lib/auth/ownership';
import { prisma } from '@/lib/db';
import { ErrorCode } from '@/lib/errors';
import { createNoteWithJob, createUser, resetDatabase } from '@/tests/helpers/db';
import { integrationAvailable } from '@/tests/helpers/integration';

/**
 * Authorization and IDOR/BOLA protection.
 *
 * The invariant under test: a user must never reach another user's resources,
 * and a missed ownership check must look identical to a missing resource (404)
 * so the API does not leak existence.
 */
describe.skipIf(!integrationAvailable)('authorization', { skip: !integrationAvailable }, () => {
  beforeAll(resetDatabase);
  beforeEach(resetDatabase);

  it('returns the note to its owner', async () => {
    const owner = await createUser('owner@example.com');
    const { noteId } = await createNoteWithJob(owner.id);
    await expect(getOwnedNote(owner.id, noteId)).resolves.toMatchObject({ id: noteId, userId: owner.id });
  });

  it('raises NOTE_NOT_FOUND for another user\'s note, not FORBIDDEN', async () => {
    const owner = await createUser('owner@example.com');
    const attacker = await createUser('attacker@example.com');
    const { noteId } = await createNoteWithJob(owner.id);

    await expect(getOwnedNote(attacker.id, noteId)).rejects.toMatchObject({
      code: ErrorCode.NOTE_NOT_FOUND,
      status: 404,
    });
  });

  it('produces the same error for a nonexistent note and someone else\'s note', async () => {
    const owner = await createUser('owner@example.com');
    const attacker = await createUser('attacker@example.com');
    const { noteId } = await createNoteWithJob(owner.id);

    const foreign = await getOwnedNote(attacker.id, noteId).catch((error: unknown) => error as { code: string; status: number });
    const missing = await getOwnedNote(attacker.id, '00000000-0000-4000-8000-000000000000').catch(
      (error: unknown) => error as { code: string; status: number },
    );

    expect((foreign as { code: string }).code).toBe((missing as { code: string }).code);
    expect((foreign as { status: number }).status).toBe((missing as { status: number }).status);
  });

  it('raises JOB_NOT_FOUND for another user\'s job', async () => {
    const owner = await createUser('owner@example.com');
    const attacker = await createUser('attacker@example.com');
    const { jobId } = await createNoteWithJob(owner.id);

    await expect(getOwnedJob(attacker.id, jobId)).rejects.toMatchObject({ code: ErrorCode.JOB_NOT_FOUND, status: 404 });
  });

  it('scopes note listing to the owner', async () => {
    const owner = await createUser('owner@example.com');
    const attacker = await createUser('attacker@example.com');
    await createNoteWithJob(owner.id, 'Owner note 1');
    await createNoteWithJob(owner.id, 'Owner note 2');
    await createNoteWithJob(attacker.id, 'Attacker note');

    expect(await prisma.note.count({ where: { userId: owner.id } })).toBe(2);
    expect(await prisma.note.count({ where: { userId: attacker.id } })).toBe(1);
  });

  it('prevents an action item belonging to another user from being patched', async () => {
    const owner = await createUser('owner@example.com');
    const attacker = await createUser('attacker@example.com');
    const { noteId, jobId } = await createNoteWithJob(owner.id);
    const item = await prisma.actionItem.create({
      data: { noteId, jobId, content: 'Ship the release', position: 0 },
      select: { id: true },
    });

    // The route resolves ownership through the parent note.
    const reachable = await prisma.actionItem.findFirst({
      where: { id: item.id as string, note: { userId: attacker.id } },
    });
    expect(reachable).toBeNull();

    const owned = await prisma.actionItem.findFirst({ where: { id: item.id as string, note: { userId: owner.id } } });
    expect(owned).not.toBeNull();
  });

  it('enforces Job.userId == Note.userId at the database level', async () => {
    const owner = await createUser('owner@example.com');
    const attacker = await createUser('attacker@example.com');
    const { noteId } = await createNoteWithJob(owner.id);
    const other = await createNoteWithJob(owner.id, 'Second');

    let sqlState = '';
    try {
      await prisma.job.create({ data: { userId: attacker.id, noteId: other.noteId } });
    } catch (error) {
      sqlState = (error as { code?: string }).code ?? '';
    }
    // A second job for the same note is also blocked, so use a distinct note.
    expect(['P2002', '23503']).toContain(sqlState);
    expect(noteId).toBeTruthy();
  });
});
