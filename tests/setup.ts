/**
 * Test environment.
 *
 * Only the environment variables the application actually reads are set. No AI
 * or Resend credentials are defined here — those live in the database, so tests
 * that need them create encrypted rows explicitly.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/ai_notetaker?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
process.env.APP_SECRET = process.env.APP_SECRET ?? 'test-secret-value-that-is-at-least-32-characters-long';
process.env.APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'test-admin-password-123';
process.env.WORKER_CONCURRENCY = process.env.WORKER_CONCURRENCY ?? '2';
process.env.MAX_UPLOAD_SIZE = process.env.MAX_UPLOAD_SIZE ?? '10485760';
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

export {};
