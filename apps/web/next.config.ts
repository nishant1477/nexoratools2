import path from 'node:path';
import type { NextConfig } from 'next';

// The browser only ever talks to this origin; /api/* is proxied to the Fastify API.
// (In production, put Nginx in front and route /api to the API directly — see docker/nginx.conf.)
const onVercel = Boolean(process.env.VERCEL);
const apiInternal = (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
// On Vercel the API runs elsewhere (Docker host); a missing or localhost target would silently break every request.
if (onVercel && (!process.env.API_INTERNAL_URL || /localhost|127\.0\.0\.1/.test(apiInternal))) {
  throw new Error('API_INTERNAL_URL must be set to the public https:// URL of your hosted API (Vercel > Settings > Environment Variables).');
}

const config: NextConfig = {
  // Docker uses the standalone server; Vercel builds its own output.
  output: onVercel ? undefined : 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@nexora/shared'],
  poweredByHeader: false,
  // Next's built-in /api proxy buffers request bodies and truncates at 10 MB by default; uploads can be larger.
  // (Behind Nginx in production the proxy is bypassed, but keep the fallback correct.)
  experimental: { proxyClientMaxBodySize: Number(process.env.PROXY_MAX_BODY_MB ?? 250) * 1024 * 1024 },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternal}/api/:path*` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};
export default config;
