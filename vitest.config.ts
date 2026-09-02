import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Integration/e2e suites share one embedded PostgreSQL cluster per file.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    sequence: { concurrent: false },
  },
});
