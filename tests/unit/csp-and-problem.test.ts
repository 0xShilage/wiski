import { describe, expect, it } from 'vitest';
import { HttpError, Problems, problemResponse } from '@/server/http/problem';
import {
  API_CSP,
  makeNonce,
  pageCsp,
  reportingEndpoints,
  TRUSTED_TYPES_REPORT_ONLY,
} from '@/server/security/csp';

describe('CSP (05 §7)', () => {
  it('production policy is exactly the specified one', () => {
    expect(pageCsp({ nonce: 'N', origin: 'https://wiski.fun', dev: false })).toBe(
      "default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic'; style-src 'self' 'nonce-N'; " +
        "img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com; " +
        "manifest-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; " +
        "frame-ancestors 'none'; upgrade-insecure-requests; report-to csp; report-uri /api/csp-report",
    );
  });
  it('never allows unsafe-inline scripts; unsafe-eval only in development', () => {
    const prod = pageCsp({ nonce: 'N', origin: 'https://wiski.fun', dev: false });
    expect(prod).not.toContain('unsafe');
    const dev = pageCsp({ nonce: 'N', origin: 'http://localhost:3000', dev: true });
    expect(dev).toMatch(/script-src [^;]*'unsafe-eval'/);
    expect(dev).not.toMatch(/script-src [^;]*'unsafe-inline'/);
    expect(dev).not.toContain('upgrade-insecure-requests');
  });
  it('nonces are 128-bit and unique', () => {
    const nonces = Array.from({ length: 200 }, makeNonce);
    expect(new Set(nonces).size).toBe(200);
    expect(Buffer.from(nonces[0]!, 'base64')).toHaveLength(16);
  });
  it('API responses deny everything; Trusted Types trial is report-only; reporting endpoint', () => {
    expect(API_CSP).toContain("default-src 'none'");
    expect(TRUSTED_TYPES_REPORT_ONLY).toContain("require-trusted-types-for 'script'");
    expect(reportingEndpoints('https://wiski.fun')).toBe('csp="https://wiski.fun/api/csp-report"');
  });
});

describe('RFC 9457 problems', () => {
  it('renders application/problem+json with a stable code and no-store', async () => {
    const res = problemResponse(Problems.validation([{ path: 'name', message: 'curto' }]), 'rid');
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      type: 'urn:wiskiflix:problem:validation-failed',
      title: 'Unprocessable Content',
      status: 422,
      code: 'VALIDATION_FAILED',
      detail: 'Alguns campos estão inválidos.',
      errors: [{ path: 'name', message: 'curto' }],
    });
  });
  it('sets Retry-After on 429', () => {
    expect(problemResponse(Problems.rateLimited(2.2)).headers.get('retry-after')).toBe('3');
  });
  it('custom errors keep their status', () => {
    expect(problemResponse(new HttpError(409, 'X', 'y')).status).toBe(409);
  });
});
