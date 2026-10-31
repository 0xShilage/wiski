import { type NextRequest, NextResponse } from 'next/server';
import {
  API_CSP,
  makeNonce,
  pageCsp,
  reportingEndpoints,
  TRUSTED_TYPES_REPORT_ONLY,
} from './server/security/csp';

/**
 * Per-request CSP nonce (05 §7, 10 §2 step 9). Next.js reads the nonce from the request's CSP
 * header and applies it to its own scripts; pages read `x-nonce` for anything we add.
 * Incoming `x-nonce` / CSP request headers from the client are always overwritten.
 */
export function proxy(request: NextRequest) {
  const origin = process.env.APP_ORIGIN ?? request.nextUrl.origin;

  if (request.nextUrl.pathname.startsWith('/api/')) {
    const res = NextResponse.next();
    res.headers.set('Content-Security-Policy', API_CSP);
    return res;
  }

  const nonce = makeNonce();
  const csp = pageCsp({ nonce, origin, dev: process.env.NODE_ENV === 'development' });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('Content-Security-Policy-Report-Only', TRUSTED_TYPES_REPORT_ONLY);
  res.headers.set('Reporting-Endpoints', reportingEndpoints(origin));
  return res;
}

export const config = {
  matcher: [
    {
      // Everything except immutable static files (they carry no HTML and are cached by nginx/CF).
      source:
        '/((?!_next/static|_next/image|brand/|avatars/|media/|favicon\\.ico|icon\\.png|apple-icon\\.png|opengraph-image|manifest\\.webmanifest|robots\\.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
