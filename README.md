# AI Notetaker

Converts meeting audio into a **transcript**, an **executive summary**, **action
items** and an **interactive mind map**.

Users sign in passwordlessly (email magic link or 6-digit OTP). Administrators
sign in separately with email + password (Argon2id) and configure AI providers
and Resend from the admin panel.

---

## Architecture

A single repository, no monorepo workspaces.

```
app/        Next.js UI + Route Handlers   (HTTP, auth, validation, DB, enqueue)
worker/     BullMQ consumer + AI pipeline (no HTTP server)
lib/        shared services
components/ React components
prisma/     schema, migrations, seed
tests/      unit / integration / security / e2e
```

Dependency direction is `app → lib` and `worker → lib`. It is enforced by an
ESLint rule, so a violation fails `npm run lint`.

`web` owns HTTP, authentication, authorization, validation, database access,
upload handling and enqueueing. It performs **no** AI processing.

`worker` owns the BullMQ consumer, job lifecycle, the AI pipeline, provider
selection and fallback, transient retries, heartbeat, watchdog, usage logging
and result notification. It exposes **no** HTTP server.

### Services (docker-compose)

Exactly five: `db`, `redis`, `migrate`, `web`, `worker`. Only `web` publishes a
port. One multi-stage `Dockerfile` produces one image used by `migrate`, `web`
and `worker`. `ai-notetaker-shared` is mounted at `/app/data/shared` in both
`web` and `worker`.

`migrate` is one-shot: wait for PostgreSQL → `prisma migrate deploy` → seed →
exit. `prisma db push` is never used, and neither `web` nor `worker` runs
migrations.

---

## Pipeline

Order is mandatory and every stage is checkpointed:

```
TRANSCRIPTION → SUMMARY → ACTION_ITEMS → MIND_MAP
   10–35%         35–60%      60–80%        80–95%      COMPLETED = 100%
```

If a stage's output row already exists, that stage is skipped and processing
resumes from the next missing one.

**Fallback** is allowed only for transient failures (timeout, network failure,
HTTP 429, HTTP 5xx). It is never allowed for HTTP 400, invalid input, corrupt
audio, unsupported formats or an invalid AI response. The provider actually used
is recorded in `Job.providerUsed`. Provider fallback and BullMQ retry
(max 3, exponential backoff) are separate mechanisms.

**Watchdog**: the worker refreshes `lastHeartbeatAt` every 30s. A `PROCESSING`
job whose heartbeat is more than 30 minutes stale is requeued, at most 3 times;
beyond that it is marked `FAILED` rather than looping forever.

**Usage**: only successful jobs create a `UsageLog`, and `UsageLog.jobId` is
unique so a retry or requeue can never double-count. V1 costs are estimates.

**Email**: sent via Resend using a key stored encrypted in PostgreSQL. A failed
`RESULT`/`FAILURE` notification never changes a completed job to `FAILED`.

---

## Security

- Separate `ai_notetaker_session` and `ai_notetaker_admin_session` cookies; only
  token **hashes** are stored. `HttpOnly`, `SameSite=Lax`, `Secure` in production.
- Magic links and OTPs are finite-TTL and single-use; OTPs are 6 digits and
  hashed. Admin passwords use Argon2id. Admin sign-in does not depend on Resend.
- Ownership checks on every lookup; a resource belonging to someone else returns
  the same `404` as one that does not exist (IDOR/BOLA protection).
- CSRF/origin protection on all mutating methods, Redis-backed rate limiting,
  bounded pagination, upload validation (extension, MIME, size, empty,
  filename), server-generated storage paths and path-traversal protection.
- Credentials are encrypted with `APP_SECRET` (AES-256-GCM), never logged, never
  sent to the browser (keys are always masked), and never placed in queue
  payloads or environment variables.
- Prompt-injection boundary: transcripts are wrapped in explicit untrusted
  markers and the model is instructed to treat them as data. All AI output is
  validated before it is persisted.
- Security headers on every response, including HSTS in production.

---

## Configuration

These are the **only** environment variables (see `.env.example`):

`DATABASE_URL`, `REDIS_URL`, `APP_SECRET`, `APP_URL`, `ADMIN_EMAIL`,
`ADMIN_PASSWORD`, `WORKER_CONCURRENCY` (default 2), `MAX_UPLOAD_SIZE`.

AI provider and Resend credentials are configured through the admin panel and
stored encrypted in PostgreSQL — deliberately **not** in the environment.

---

## Running

```bash
cp .env.example .env          # then edit APP_SECRET, ADMIN_PASSWORD, APP_URL
docker compose up --build
```

`web` is published on `http://localhost:3000`; the admin panel is at
`/admin/login`.

### Local development without Docker

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm run dev                   # web on :3000
npm run worker                # BullMQ consumer, in a second shell
```

---

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Test layout:

| Suite | Needs |
|---|---|
| `tests/unit` | nothing — always runs |
| `tests/security` | nothing — always runs |
| `tests/integration` | a generated Prisma client + PostgreSQL (+ Redis for queue cases) |
| `tests/e2e` | a running deployment (`E2E_BASE_URL`) |

Integration and e2e suites skip themselves when their environment is absent, so
`npm test` stays meaningful in a restricted sandbox.

To validate the migration SQL directly against a real PostgreSQL server:

```bash
DATABASE_URL=postgresql://... node scripts/validate-migration.mjs
```

---

## Contract conformance

Implementation follows the supplied master contract. The F1–F12 documents were
not present in the repository, so every detail the master contract leaves open
is recorded for approval in **[CHANGE_CONTROL.md](CHANGE_CONTROL.md)**.
