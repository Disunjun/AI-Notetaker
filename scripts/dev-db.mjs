// Development / CI helper: runs a REAL PostgreSQL server locally using the
// binaries shipped by the `embedded-postgres` dev dependency.
//
// This exists because the target runtime (docker-compose `db` service) is not
// always available in a development sandbox. It is NOT part of the product:
// `embedded-postgres` is a devDependency and is never installed into the
// application image.
//
// Usage:
//   node scripts/dev-db.mjs            # start and stay alive on :55432
//   DATABASE_NAME=ai_notetaker_test node scripts/dev-db.mjs
import EmbeddedPostgres from 'embedded-postgres';

const port = Number(process.env.PGPORT ?? 55432);
const databaseDir = process.env.PGDATA_DIR ?? new URL('../.pg-test/data', import.meta.url).pathname;
const database = process.env.DATABASE_NAME ?? 'ai_notetaker';

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  database,
});

await pg.initialise();
await pg.start();

console.log(`[dev-db] PostgreSQL listening on postgresql://postgres:postgres@127.0.0.1:${port}/${database}`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
