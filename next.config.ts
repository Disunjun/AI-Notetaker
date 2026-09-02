import type { NextConfig } from 'next';

/**
 * Only `web` is publicly exposed. All security headers required by F7 are
 * applied here; HSTS is emitted only in production.
 */
const securityHeaders: Array<{ key: string; value: string }> = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
];

if (process.env.NODE_ENV === 'production') {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  });
}

const nextConfig: NextConfig = {
  // Full production node_modules are used at runtime (see Dockerfile): a single
  // coherent dependency tree serves web, worker and migrate from one image.
  reactStrictMode: true,
  poweredByHeader: false,
  // Server-only packages must not be bundled into the client graph. This also
  // keeps BullMQ's optional Valkey driver out of the web build.
  serverExternalPackages: ['@prisma/client', 'bullmq', 'ioredis', 'argon2'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  experimental: {
    // Uploads stream through route handlers; keep the body limit explicit.
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
