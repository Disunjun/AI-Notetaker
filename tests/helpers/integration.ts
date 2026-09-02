import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Integration and e2e suites need two things that are environment-dependent:
 *   1. a generated Prisma client (produced by `prisma generate`, which downloads
 *      the Prisma engine binaries)
 *   2. a reachable PostgreSQL, and for e2e a reachable Redis
 *
 * When either is missing the suites report themselves as skipped rather than
 * failing, so `npm test` stays meaningful in a restricted sandbox. Unit and
 * security suites are never gated and always run.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export function prismaClientGenerated(): boolean {
  return existsSync(`${repoRoot}node_modules/.prisma/client/schema.prisma`);
}

export function hasIntegrationDatabase(): boolean {
  return Boolean(process.env.INTEGRATION_DATABASE_URL) || Boolean(process.env.DATABASE_URL);
}

export function hasRedis(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export const integrationAvailable = prismaClientGenerated() && hasIntegrationDatabase();

export const integrationSkipReason = integrationAvailable
  ? false
  : `integration environment unavailable (prismaClientGenerated=${prismaClientGenerated()}, database=${hasIntegrationDatabase()})`;
