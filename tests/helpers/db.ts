import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { encryptSecret } from '@/lib/crypto';

/** Shared helpers for the integration suites. */

const TABLES_IN_FK_ORDER = [
  'EmailLog',
  'UsageLog',
  'MindMap',
  'ActionItem',
  'Summary',
  'Transcript',
  'Job',
  'Note',
  'AuthToken',
  'UserSession',
  'AdminSession',
  'ResendConfig',
  'AIProviderConfig',
  'User',
  'Admin',
] as const;

export async function resetDatabase(): Promise<void> {
  for (const table of TABLES_IN_FK_ORDER) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
  }
}

export async function createUser(email: string): Promise<{ id: string; email: string }> {
  const created = await prisma.user.create({ data: { email: email.toLowerCase() }, select: { id: true, email: true } });
  return { id: created.id as string, email: created.email as string };
}

export async function createAdmin(email: string, password: string): Promise<{ id: string; email: string }> {
  const created = await prisma.admin.create({
    data: { email: email.toLowerCase(), passwordHash: await hashPassword(password) },
    select: { id: true, email: true },
  });
  return { id: created.id as string, email: created.email as string };
}

export async function createNoteWithJob(userId: string, title = 'Team sync'): Promise<{ noteId: string; jobId: string }> {
  const note = await prisma.note.create({
    data: {
      userId,
      title,
      sourcePath: `/app/data/shared/audio/pending/source-${Math.random().toString(36).slice(2)}`,
      originalName: 'meeting.mp3',
      mimeType: 'audio/mpeg',
      fileSizeBytes: 1024,
    },
    select: { id: true },
  });
  const job = await prisma.job.create({
    data: { userId, noteId: note.id as string },
    select: { id: true },
  });
  return { noteId: note.id as string, jobId: job.id as string };
}

/** Configure both provider roles so uploads are accepted. */
export async function configureProviders(apiKey = 'sk-test-0123456789abcdef'): Promise<void> {
  await prisma.aIProviderConfig.createMany({
    data: [
      {
        role: 'TRANSCRIPTION',
        name: 'openai-whisper',
        provider: 'OPENAI',
        apiKeyEncrypted: encryptSecret(apiKey),
        model: 'whisper-large-v3',
        isPrimary: true,
        priority: 10,
      },
      {
        role: 'TEXT',
        name: 'openai-text',
        provider: 'OPENAI',
        apiKeyEncrypted: encryptSecret(apiKey),
        model: 'gpt-4o-mini',
        isPrimary: true,
        priority: 10,
      },
    ],
  });
}

export async function configureResend(apiKey = 're_test_0123456789'): Promise<void> {
  await prisma.resendConfig.create({
    data: { apiKeyEncrypted: encryptSecret(apiKey), fromEmail: 'notes@example.com', fromName: 'AI Notetaker' },
  });
}
