import { NextResponse } from 'next/server';
import { z } from 'zod';
import { beginLogin, LoginError, OAUTH_COOKIE_TTL_MS } from '@/server/auth/oidc';
import { COOKIE, setHostCookie } from '@/server/auth/cookies';
import { route } from '@/server/http/route';
import { logger } from '@/server/log';
import { RL } from '@/server/ratelimit/rules';

/**
 * GET /api/auth/google/start?returnTo=/perfil[&stepUp=1] → 302 to Google + sealed one-time
 * `__Host-wf_oauth` cookie (10 min, SameSite=Lax so it rides the top-level redirect back).
 * A plain link (not a form): `form-action 'self'` would block a form's redirect to Google.
 */
export const GET = route(
  {
    methods: ['GET'],
    access: 'public',
    rateLimit: RL.auth,
    query: z
      .object({
        returnTo: z.string().max(512).optional(),
        stepUp: z.enum(['1']).optional(),
      })
      .strict(),
  },
  async ({ query, requestId }) => {
    try {
      const { url, cookie } = await beginLogin({
        returnTo: query.returnTo ?? null,
        stepUp: query.stepUp === '1',
      });
      const res = NextResponse.redirect(url, 302);
      setHostCookie(res, COOKIE.oauth, cookie, {
        maxAgeSec: OAUTH_COOKIE_TTL_MS / 1000,
        sameSite: 'lax',
      });
      return res;
    } catch (err) {
      const reason = err instanceof LoginError ? err.reason : 'indisponivel';
      logger.warn(
        { requestId, reason, err: err instanceof Error ? err.message : 'unknown' },
        'login start failed',
      );
      return NextResponse.redirect(new URL(`/perfil?erro=${reason}`, process.env.APP_ORIGIN), 303);
    }
  },
);
