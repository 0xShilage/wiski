import { NextRequest } from 'next/server';
import type { User } from '@/generated/prisma/client';
import { COOKIE } from '@/server/auth/cookies';
import { createSession } from '@/server/auth/session';
import { csrfTokenFor } from '@/server/security/csrf';
import { db } from '@/server/db';

export const ORIGIN = 'http://localhost:3000';
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let ipSeq = 0;
/** A fresh documentation-range IP per call so rate-limit buckets don't collide across tests. */
export function freshIp(): string {
  ipSeq++;
  return `198.51.${Math.floor(ipSeq / 250) % 250}.${(ipSeq % 250) + 1}`;
}

export type ReqInit = {
  headers?: Record<string, string | null>;
  body?: unknown;
  rawBody?: string | Uint8Array<ArrayBuffer>;
  cookies?: Record<string, string>;
  ip?: string;
};

/** Build a NextRequest the way a same-origin browser fetch would (overridable per test). */
export function req(method: string, path: string, init: ReqInit = {}): NextRequest {
  const headers = new Headers({
    'x-real-ip': init.ip ?? freshIp(),
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  });
  if (MUTATIONS.has(method)) {
    headers.set('origin', ORIGIN);
    headers.set('sec-fetch-site', 'same-origin');
  }
  let body: string | Uint8Array<ArrayBuffer> | undefined = init.rawBody;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers.set('content-type', 'application/json');
  }
  if (init.cookies) {
    headers.set(
      'cookie',
      Object.entries(init.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    );
  }
  for (const [k, v] of Object.entries(init.headers ?? {})) {
    if (v === null) headers.delete(k);
    else headers.set(k, v);
  }
  return new NextRequest(new URL(path, ORIGIN), {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}

type AnyHandler = (req: NextRequest, ctx?: { params?: Promise<never> }) => Promise<Response>;

export function call(
  handler: AnyHandler,
  request: NextRequest,
  params: Record<string, string> = {},
): Promise<Response> {
  return handler(request, { params: Promise.resolve(params as never) });
}

export type ParsedCookie = { value: string; attributes: Record<string, string | true> };

export function setCookies(res: Response): Record<string, ParsedCookie> {
  const out: Record<string, ParsedCookie> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair!.indexOf('=');
    const attributes: Record<string, string | true> = {};
    for (const a of attrs) {
      const i = a.indexOf('=');
      attributes[(i === -1 ? a : a.slice(0, i)).toLowerCase()] = i === -1 ? true : a.slice(i + 1);
    }
    out[pair!.slice(0, eq)] = { value: pair!.slice(eq + 1), attributes };
  }
  return out;
}

/**
 * Log a user in directly (no Google) → session cookie + matching CSRF token header.
 * `mfaAt` simulates a verified passkey (admin second factor); default: verified now for
 * MODERATOR/STREAMER, so authorization tests exercise the role checks.
 */
export async function signedIn(
  user: Pick<User, 'id' | 'role'>,
  authTime = new Date(),
  opts: { mfaAt?: Date | null } = {},
) {
  const { token, session } = await createSession(user, { authTime, uaFamily: 'Chrome · Windows' });
  // Admins: second factor checked 30 minutes ago — inside the 96-h window, but not a fresh
  // step-up confirmation (10 min), so step-up tests decide freshness through authTime/mfaAt.
  const mfaAt =
    opts.mfaAt === undefined
      ? user.role === 'USER'
        ? null
        : new Date(Date.now() - 30 * 60_000)
      : opts.mfaAt;
  if (mfaAt) {
    await db().session.update({ where: { id: session.id }, data: { mfaAt } });
    session.mfaAt = mfaAt;
  }
  return {
    session,
    token,
    cookies: { [COOKIE.session]: token },
    headers: { 'x-csrf-token': csrfTokenFor(session.id) },
  };
}
