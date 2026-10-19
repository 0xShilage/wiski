import 'server-only';
import { z } from 'zod';
import { getEnv, TURNSTILE_TEST_SECRET_KEY } from '../env';
import { logger } from '../log';
import { randomToken } from './crypto';

/**
 * Cloudflare Turnstile server-side verification (05 §9): siteverify with secret, response,
 * remoteip and idempotency_key; require success, hostname == ours, action == the form's action,
 * token age ≤ 300 s. Tokens are single-use at Cloudflare's side.
 */
export const TURNSTILE_HEADER = 'x-turnstile-token';
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_AGE_MS = 300_000;

const responseSchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional(),
  challenge_ts: z.string().optional(),
  hostname: z.string().optional(),
  action: z.string().optional(),
});

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

export async function verifyTurnstile(
  token: string | null,
  expectedAction: string,
  remoteIp: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!token || token.length > 2048) return { ok: false, reason: 'missing-token' };
  const env = getEnv();
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
    idempotency_key: crypto.randomUUID?.() ?? randomToken(16),
  });
  if (remoteIp) body.set('remoteip', remoteIp);

  let data: z.infer<typeof responseSchema>;
  try {
    const res = await fetchImpl(SITEVERIFY, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5_000),
    });
    data = responseSchema.parse(await res.json());
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown' },
      'turnstile siteverify failed',
    );
    return { ok: false, reason: 'siteverify-unavailable' };
  }
  if (!data.success) return { ok: false, reason: (data['error-codes'] ?? ['rejected']).join(',') };

  // Cloudflare's test secret returns placeholder hostname/action; skip those checks for it only
  // (allowed outside production only — enforced by env.ts).
  if (env.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET_KEY) return { ok: true };

  if (data.hostname !== new URL(env.APP_ORIGIN).hostname) return { ok: false, reason: 'hostname' };
  if (data.action !== expectedAction) return { ok: false, reason: 'action' };
  const issued = data.challenge_ts ? Date.parse(data.challenge_ts) : NaN;
  if (!Number.isFinite(issued) || Date.now() - issued > MAX_AGE_MS)
    return { ok: false, reason: 'stale' };
  return { ok: true };
}
