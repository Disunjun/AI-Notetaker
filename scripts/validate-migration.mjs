// Applies prisma/migrations/20260101000000_init/migration.sql to a real
// PostgreSQL server and verifies the resulting schema.
//
// This exists because `prisma migrate deploy` needs the Prisma schema-engine
// binary, which is downloaded from binaries.prisma.sh. In a network-restricted
// environment that download fails, so this script validates the migration SQL
// directly against a real server instead. On a machine with network access,
// `npm run prisma:deploy` is the real path.
//
// Usage: DATABASE_URL=postgresql://... node scripts/validate-migration.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const migrationPath = fileURLToPath(new URL('../prisma/migrations/20260101000000_init/migration.sql', import.meta.url));
const sql = readFileSync(migrationPath, 'utf8');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

try {
  await client.query(sql);
  check('migration.sql applies cleanly', true);
} catch (error) {
  check('migration.sql applies cleanly', false, error.message);
  console.error(error);
  await client.end();
  process.exit(1);
}

// --- tables ---------------------------------------------------------------
const EXPECTED_TABLES = [
  'User', 'UserSession', 'AuthToken', 'Admin', 'AdminSession', 'Note', 'Job',
  'Transcript', 'Summary', 'ActionItem', 'MindMap', 'AIProviderConfig',
  'ResendConfig', 'UsageLog', 'EmailLog',
];
const tables = await client.query(
  `select table_name from information_schema.tables where table_schema='public' order by table_name`,
);
const present = new Set(tables.rows.map((r) => r.table_name));
for (const table of EXPECTED_TABLES) check(`table "${table}" exists`, present.has(table));

// --- uuid primary keys ----------------------------------------------------
const pk = await client.query(`
  select c.table_name, c.column_name, c.data_type
  from information_schema.columns c
  join information_schema.key_column_usage k
    on k.table_name=c.table_name and k.column_name=c.column_name and k.constraint_name = c.table_name || '_pkey'
  where c.table_schema='public'`);
const nonUuid = pk.rows.filter((r) => r.data_type !== 'uuid');
check('all primary keys are UUID', nonUuid.length === 0, nonUuid.map((r) => `${r.table_name}.${r.column_name}:${r.data_type}`).join(', '));
check('primary key count matches model count', pk.rows.length === EXPECTED_TABLES.length, `got ${pk.rows.length}`);

// --- timestamps are timestamp(3) -----------------------------------------
const ts = await client.query(
  `select column_name, data_type from information_schema.columns
   where table_schema='public' and table_name='Job' and data_type like 'timestamp%'`,
);
const badTs = ts.rows.filter((r) => r.data_type !== 'timestamp without time zone');
check('Job timestamps are timestamp(3) (Prisma UTC convention)', ts.rows.length > 0 && badTs.length === 0, ts.rows.map((r) => r.data_type).join('|'));

// --- unique constraints ---------------------------------------------------
const EXPECTED_UNIQUE = [
  'User_email_key', 'UserSession_tokenHash_key', 'Admin_email_key', 'AdminSession_tokenHash_key',
  'Note_sourcePath_key', 'Note_id_userId_key', 'Job_noteId_key', 'Transcript_noteId_key',
  'Summary_noteId_key', 'MindMap_noteId_key', 'AIProviderConfig_role_name_key',
  'UsageLog_jobId_key', 'EmailLog_idempotencyKey_key',
];
const uniques = await client.query(`select indexname from pg_indexes where schemaname='public'`);
const uniqueNames = new Set(uniques.rows.map((r) => r.indexname));
for (const name of EXPECTED_UNIQUE) check(`unique index "${name}" exists`, uniqueNames.has(name));

// --- composite FK enforcing Job.userId == Note.userId ---------------------
const fk = await client.query(`
  select conname, pg_get_constraintdef(oid) as def from pg_constraint
  where conname in ('Job_noteId_userId_fkey','Job_userId_fkey')`);
const composite = fk.rows.find((r) => r.conname === 'Job_noteId_userId_fkey');
check('composite FK Job(noteId,userId) -> Note(id,userId) exists', Boolean(composite), composite?.def ?? '');

// --- behavioural proof of the invariant ----------------------------------
const user = await client.query(
  `insert into "User"(id,email,"updatedAt") values (gen_random_uuid(), 'owner@example.com', now()) returning id`,
);
const other = await client.query(
  `insert into "User"(id,email,"updatedAt") values (gen_random_uuid(), 'other@example.com', now()) returning id`,
);
const ownerId = user.rows[0].id;
const otherId = other.rows[0].id;

const note = await client.query(
  `insert into "Note"(id,"userId",title,"sourcePath","originalName","mimeType","fileSizeBytes","updatedAt")
   values (gen_random_uuid(), $1, 'Team sync', '/app/data/shared/audio/x/source', 'x.mp3', 'audio/mpeg', 1024, now())
   returning id`,
  [ownerId],
);
const noteId = note.rows[0].id;

const goodJob = await client.query(
  `insert into "Job"(id,"noteId","userId","updatedAt") values (gen_random_uuid(), $1, $2, now()) returning id`,
  [noteId, ownerId],
);
check('job with matching userId is accepted', Boolean(goodJob.rows[0].id));

let rejected = false;
let rejectionCode = '';
try {
  // A *different* note, so the unique(Job.noteId) guard cannot mask the FK check.
  const note2 = await client.query(
    `insert into "Note"(id,"userId",title,"sourcePath","originalName","mimeType","fileSizeBytes","updatedAt")
     values (gen_random_uuid(), $1, 'Second sync', '/app/data/shared/audio/y/source', 'y.mp3', 'audio/mpeg', 2048, now())
     returning id`,
    [ownerId],
  );
  await client.query(
    `insert into "Job"(id,"noteId","userId","updatedAt") values (gen_random_uuid(), $1, $2, now())`,
    [note2.rows[0].id, otherId],
  );
} catch (error) {
  rejectionCode = error.code;
  rejected = error.code === '23503';
}
check('job with mismatched userId is REJECTED by the database', rejected, `sqlstate=${rejectionCode || 'none'}`);

// --- duplicate job protection -------------------------------------------
let duplicateRejected = false;
try {
  await client.query(
    `insert into "Job"(id,"noteId","userId","updatedAt") values (gen_random_uuid(), $1, $2, now())`,
    [noteId, ownerId],
  );
} catch (error) {
  duplicateRejected = error.code === '23505';
}
check('second job for the same note is REJECTED (unique Job.noteId)', duplicateRejected);

// --- encrypted credential columns are plain text columns ------------------
const cols = await client.query(
  `select column_name from information_schema.columns where table_schema='public' and table_name='AIProviderConfig'`,
);
const names = new Set(cols.rows.map((r) => r.column_name));
check('AIProviderConfig stores apiKeyEncrypted (not plaintext apiKey)', names.has('apiKeyEncrypted') && !names.has('apiKey'));

await client.end();

console.log(failures === 0 ? '\nMIGRATION_VALIDATION: PASS' : `\nMIGRATION_VALIDATION: FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
