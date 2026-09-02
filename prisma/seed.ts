import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { hashPassword } from '@/lib/auth/password';

/**
 * Idempotent seed.
 *
 * Seeds exactly one thing: the admin account from ADMIN_EMAIL / ADMIN_PASSWORD.
 * If the admin already exists its password is NEVER overwritten — a rotated
 * password in the environment must not silently replace a changed one.
 */
async function main(): Promise<void> {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = env();
  const email = ADMIN_EMAIL.toLowerCase();

  const existing = (await prisma.admin.findUnique({
    where: { email },
    select: { id: true, email: true } },
  )) as unknown as { id: string; email: string } | null;

  if (existing) {
    console.log(`[seed] admin already present (${existing.email}); password left unchanged`);
    return;
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  await prisma.admin.create({ data: { email, passwordHash } });
  console.log(`[seed] created admin ${email}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log('[seed] complete');
  })
  .catch(async (error: unknown) => {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
