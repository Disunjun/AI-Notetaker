import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma client instance.
 *
 * Instantiation is deliberately lazy: importing this module must not require a
 * live database (or a generated client) at import time. That keeps `next build`
 * page-data collection and test imports cheap, and avoids opening a connection
 * pool in processes that never touch the database.
 *
 * Note: web and worker both import this, and neither of them ever runs
 * migrations — `prisma migrate deploy` is executed exclusively by the one-shot
 * `migrate` service (see scripts/migrate.sh).
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function instantiate(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

function client(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = instantiate();
  return globalForPrisma.prisma;
}

/** Lazily-resolved client. Use exactly like a normal `PrismaClient`. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const target = client();
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
  has(_target, property) {
    return Reflect.has(client(), property);
  },
});

export async function disconnectPrisma(): Promise<void> {
  if (globalForPrisma.prisma) await globalForPrisma.prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}

/**
 * Type used for interactive-transaction callbacks.
 *
 * Declared here so no application module needs to import Prisma's generated
 * namespace, keeping the dependency direction app -> lib / worker -> lib.
 */
export type PrismaTransactionClient = typeof prisma;
