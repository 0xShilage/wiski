import { NextResponse, userAgent } from 'next/server';
import { z } from 'zod';
import { completeLogin, LoginError, readOAuthCookie } from '@/server/auth/oidc';
import { upsertGoogleUser } from '@/server/auth/accounts';
import { clearHostCookie, COOKIE, setSessionCookie } from '@/server/auth/cookies';
import { createSession, revokeSessionByToken, uaFamilyFrom } from '@/server/auth/session';
import { audit } from '@/server/audit/audit';
import { getEnv } from '@/server/env';
import { route } from '@/server/http/route';
import { logger } from '@/server/log';
import { RL } from '@/server/ratelimit/rules';
import { isPrivileged } from '@/server/rbac';

/**
 * GET /api/auth/google/callback?code&state — finishes the OIDC flow (01 §3.1):
 * one-time cookie (always cleared) → constant-time state → code + PKCE → ID-token checks →
 * upsert by `sub` → NEW session (the request's previous session is revoked: no fixation) →
 * 303 to returnTo, or to onboarding on first login.
 */
const fail = (reason: LoginError['reason']) => {
  const res = NextResponse.redirect(new URL(`/perfil?erro=${reason}`, getEnv().APP_ORIGIN), 303);
  clearHostCookie(res, COOKIE.oauth);
  return res;
};

export const GET = route(
  {
    methods: ['GET'],
    access: 'public',
    rateLimit: RL.auth,
    query: z
      .object({
        code: z.string().max(2048).optional(),
        state: z.string().max(512).optional(),
        scope: z.string().max(1024).optional(),
        authuser: z.string().max(16).optional(),
        hd: z.string().max(255).optional(),
        prompt: z.string().max(64).optional(),
        iss: z.string().max(255).optional(),
        error: z.string().max(128).optional(),
        error_description: z.string().max(512).optional(),
      })
      .strict(),
  },
  async ({ req, requestId }) => {
    const env = getEnv();
    const oauth = readOAuthCookie(req.cookies.get(COOKIE.oauth)?.value);
    // Re-root the URL on the canonical origin: never trust the Host header.
    const callbackUrl = new URL(`${req.nextUrl.pathname}${req.nextUrl.search}`, env.APP_ORIGIN);

    let identity;
    try {
      identity = await completeLogin(callbackUrl, oauth);
    } catch (err) {
      const reason = err instanceof LoginError ? err.reason : 'falha';
      logger.warn(
        { requestId, reason, err: err instanceof Error ? err.message : 'unknown' },
        'login rejected',
      );
      return fail(reason);
    }

    const user = await upsertGoogleUser(identity);
    if (user.status === 'DELETED') return fail('conta');

    // Session fixation defence: whatever session came in is revoked; a fresh token is issued.
    await revokeSessionByToken(req.cookies.get(COOKIE.session)?.value);
    const ua = userAgent(req);
    const { token, maxAgeSec } = await createSession(user, {
      authTime: identity.authTime,
      uaFamily: uaFamilyFrom(ua.browser.name, ua.os.name),
    });

    if (isPrivileged(user.role)) {
      await audit({
        action: 'auth.login',
        actor: { id: user.id, role: user.role },
        targetType: 'User',
        targetId: user.id,
        metadata: { method: 'google', stepUp: oauth?.m !== undefined },
        requestId,
      });
    }

    const destination =
      user.username === null ? `/bem-vindo?next=${encodeURIComponent(oauth!.r)}` : oauth!.r;
    const res = NextResponse.redirect(new URL(destination, env.APP_ORIGIN), 303);
    clearHostCookie(res, COOKIE.oauth);
    setSessionCookie(res, token, maxAgeSec);
    return res;
  },
);
