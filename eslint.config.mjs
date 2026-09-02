import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Flat ESLint config.
 *
 * The architecture rules mandated by the master contract are encoded here so a
 * violation fails `npm run lint` rather than being caught in review:
 *  - `worker/**` must not import from `app/**` and must not import Next.js at
 *    all (the worker exposes NO HTTP server).
 *  - `lib/**` must not import from `app/**` (dependency direction is
 *    app -> lib and worker -> lib only).
 */

const NODE_GLOBALS = {
  console: 'readonly',
  process: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Headers: 'readonly',
  FormData: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  crypto: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  require: 'readonly',
  module: 'readonly',
};

const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  HTMLElement: 'readonly',
  SVGElement: 'readonly',
  EventSource: 'readonly',
  alert: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
};

export default tseslint.config(
  { ignores: ['.next/**', 'dist/**', 'node_modules/**', 'coverage/**', 'tests/.tmp/**', '.pg-test/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // React component rules apply to the web layer only.
    files: ['app/**/*.tsx', 'components/**/*.tsx'],
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
    },
    settings: { react: { version: 'detect' } },
  },
  {
    // Node helper scripts (dev database bootstrap, migration wrapper).
    files: ['scripts/**/*.mjs', 'scripts/**/*.js', '*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: NODE_GLOBALS },
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  {
    // lib/ must never reach up into app/.
    files: ['lib/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['@/app/*', 'app/*'], message: 'lib/ must not import from app/ (dependency direction: app -> lib).' }],
        },
      ],
    },
  },
  {
    // worker/ must not import Next.js or app/ — it exposes no HTTP server.
    files: ['worker/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'next', message: 'worker/ must not import next (the worker MUST NOT expose an HTTP server).' },
            { name: 'next/server', message: 'worker/ must not import next/server.' },
            { name: 'next/headers', message: 'worker/ must not import next/headers.' },
          ],
          patterns: [{ group: ['@/app/*', 'app/*'], message: 'worker/ must not import from app/.' }],
        },
      ],
    },
  },
  {
    // Client components run in the browser: no Node globals.
    files: ['components/**/*.tsx', 'app/**/*.tsx'],
    rules: {
      'no-restricted-globals': ['error', 'process', '__dirname', 'require', 'Buffer'],
    },
  },
);
