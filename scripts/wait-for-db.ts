import pg from 'pg';

/**
 * Blocks until PostgreSQL accepts connections.
 *
 * Used by the one-shot `migrate` service so it never runs `prisma migrate
 * deploy` against a database that is still initialising.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[wait-for-db] DATABASE_URL is required');
    process.exit(1);
  }

  const timeoutMs = Number(process.env.DB_WAIT_TIMEOUT_MS ?? 60_000);
  const startedAt = Date.now();
  let attempt = 0;

  for (;;) {
    attempt += 1;
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      console.log(`[wait-for-db] PostgreSQL is ready (attempt ${attempt})`);
      return;
    } catch (error) {
      await client.end().catch(() => undefined);
      if (Date.now() - startedAt > timeoutMs) {
        console.error(`[wait-for-db] timed out after ${timeoutMs}ms: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
      console.log(`[wait-for-db] not ready (attempt ${attempt}); retrying in 2s`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

void main();
