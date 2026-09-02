import { z } from 'zod';

/**
 * The ONLY configuration the application reads from the environment.
 *
 * AI provider credentials and Resend credentials are deliberately absent:
 * per F7 they live encrypted in PostgreSQL and are configured through the
 * admin panel.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  APP_SECRET: z.string().min(32, 'APP_SECRET must be at least 32 characters'),
  APP_URL: z.string().url('APP_URL must be an absolute URL'),
  ADMIN_EMAIL: z.string().email('ADMIN_EMAIL must be a valid email'),
  ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD must be at least 12 characters'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  MAX_UPLOAD_SIZE: z.coerce.number().int().min(1).default(100 * 1024 * 1024),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/**
 * Parse and freeze environment configuration. Throws on first use if invalid so
 * a misconfigured container fails fast instead of half-working.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return env().NODE_ENV === 'production';
}

/** Test helper — never call from application code. */
export function __resetEnvCacheForTests(): void {
  cached = undefined;
}
