import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Docker image (Phase 5) runs the minimal standalone server.
  output: 'standalone',
  // No `X-Powered-By: Next.js` (05 §7).
  poweredByHeader: false,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  experimental: {
    // "Instant" navigation (2026-11-14, IntentPrefetch): a page fetched on intent (hover, touch,
    // focus) is reused for 30 s, not the default 5 min, so nothing on screen is ever older than that
    staleTimes: { dynamic: 0, static: 30 },
  },
  // Server-only packages that should not be bundled (native/optional deps, worker threads).
  serverExternalPackages: ['pino', 'pg', 'ioredis'],
  // the share images' fonts (2026-11-14) are read from disk at run time: ship them in standalone
  outputFileTracingIncludes: {
    '/**/opengraph-image*': ['./src/server/og/fonts/*.ttf'],
  },
  // R1: /entrar and /conta fold into /perfil (12 §2 step 7). 301 keeps the query (?erro, ?returnTo).
  async redirects() {
    return [
      { source: '/entrar', destination: '/perfil', statusCode: 301 },
      { source: '/conta', destination: '/perfil', statusCode: 301 },
      { source: '/conta/sessoes', destination: '/perfil/sessoes', statusCode: 301 },
      { source: '/admin', destination: '/admin/catalogo', statusCode: 307 },
      // 2026-11-01: Termos de uso and Privacidade are one text now (src/content/legal/privacy.ts)
      { source: '/termos', destination: '/privacidade', statusCode: 308 },
    ];
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    // R1: no remote images at all — every image is uploaded and processed (11 §5).
    remotePatterns: [],
    dangerouslyAllowSVG: false,
    contentDispositionType: 'attachment',
  },
};

export default nextConfig;
