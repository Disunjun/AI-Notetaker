# CHANGE CONTROL

The F1–F12 contract documents were not present in the repository at the start of
implementation (the repository contained only `README.md`), and they were not
attached to the implementation request. Implementation therefore follows the
master contract text that was supplied.

Every point below is a detail the supplied master contract does **not** specify.
None of them changes the architecture, the service boundaries, the API surface,
the queue semantics or the security model. Each is recorded here for approval
rather than being invented silently.

| # | Topic | Gap in the supplied contract | Decision taken | Reversible? |
|---|-------|------------------------------|----------------|-------------|
| CC-1 | AI provider roles | `/api/admin/ai-providers/:role` names a role but the roles are not enumerated | Two roles: `TRANSCRIPTION` and `TEXT`, matching the two pipeline capability sets (`transcribe()` and `generateText()`) | Yes — enum + config rows |
| CC-2 | Provider implementations | The provider set is not named | `OPENAI`, `GROQ` and `OPENAI_COMPATIBLE` share one OpenAI-compatible client; `GOOGLE` and `ANTHROPIC` are text-only. All four implement `testConnection`/`listModels`; transcription is OpenAI-compatible only | Yes — new providers plug into `lib/ai/registry.ts` |
| CC-3 | Credential TTLs | "finite TTL, single-use" without durations | Magic link 15 min, OTP 10 min, user session 7 days, admin session 8 hours | Yes — constants in `lib/auth/*` |
| CC-4 | OTP attempt limit | Not specified | 5 wrong attempts per code, then the code is voided | Yes |
| CC-5 | Rate limits | "rate limiting" without numbers | request-link 5/15min, request-otp 5/15min, verify 10/15min, admin login 8/15min, upload 20/hour, keyed by IP+email | Yes |
| CC-6 | Error catalogue | "appropriate HTTP statuses from F3" without the list | Catalogue in `lib/errors.ts`; `AI_PROVIDER_NOT_CONFIGURED` = 503 exactly as mandated, `UPLOAD_UNSUPPORTED_TYPE` = 415, `UPLOAD_TOO_LARGE` = 413, `RATE_LIMITED` = 429 | Yes |
| CC-7 | `Note.status` | Note statuses are not specified | `UPLOADED` → `PROCESSING` → `COMPLETED`/`FAILED`, mirroring the job | Yes |
| CC-8 | Email addresses | Case sensitivity not specified | Emails are lowercased before storage and lookup; no Postgres `citext` extension is required | Yes |
| CC-9 | Upload ordering | The contract lists "save file" before "create Note", but the storage path is derived from the note id | The note id is generated server-side *before* the write, so the path is still server-generated and never client-derived; Note and Job are then created in one transaction | Yes |
| CC-10 | UsageLog granularity | `UsageLog.jobId` must be unique, but usage accrues across 4 stages | One row per job; per-stage detail is kept in the `breakdown` JSON column | Yes |
| CC-11 | Progress sub-steps | Progress *ranges* per stage are given, not the exact values | Each stage writes its range minimum at start and maximum at end; `COMPLETED` = 100 | Yes |
| CC-12 | Queue position semantics | "queue position when available" is undefined | 1-based index in the BullMQ waiting list, plus `totalWaiting` and a wait estimate from `WORKER_CONCURRENCY` | Yes |
| CC-13 | Watchdog interval | Stale threshold (30 min) and cap (3) are given; scan interval is not | Watchdog scans every 5 minutes; a job that exceeds the cap is marked `FAILED` with `WATCHDOG_MAX_REQUEUES` | Yes |
| CC-14 | Transient retry hand-off | BullMQ retries and provider fallback are separate, but the interaction on a transient failure is not stated | On a transient failure with attempts remaining the job is set back to `QUEUED` and the error is rethrown so BullMQ performs the retry; permanent failures mark `FAILED` immediately | Yes |
| CC-15 | Runtime TypeScript execution | Not specified | The worker and migration scripts run through `tsx` (`tsx` and `prisma` are production dependencies) so one image serves web, worker and migrate without a second build step | Yes |
| CC-16 | Migration authoring | Not specified | `prisma/migrations/20260101000000_init/migration.sql` was authored by hand and validated against a real PostgreSQL 18 server. It must be re-verified with `prisma migrate dev` on a machine that can download the Prisma engines | Needs review |
| CC-17 | Test-suite environment gating | Not specified | Integration/e2e suites are gated on `INTEGRATION_DATABASE_URL` and a generated Prisma client; unit and security suites always run | Yes |

## Explicitly NOT changed

No alternative endpoints, models, service boundaries, authentication flows,
queue behaviour, retry semantics or deployment architecture were introduced.

- Queue name is `ai-notetaker-processing`; BullMQ job id is the DB `Job.id`.
- Exactly five compose services; only `web` is public.
- AI and Resend credentials live only in PostgreSQL, encrypted with `APP_SECRET`.
- `prisma db push` is not used anywhere; migrations run only in the `migrate` service.
- Stage order is fixed: Transcription → Summary → Action Items → Mind Map.
- Fallback is transient-only; permanent failures never fall back and never retry.
- UsageLog is created only for successful jobs and `jobId` is unique.
- Email failure never changes a completed job to `FAILED`.
