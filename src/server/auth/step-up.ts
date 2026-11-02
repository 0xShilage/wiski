import 'server-only';
import type { Session } from '@/generated/prisma/client';
import { STEP_UP_MAX_AGE_SEC } from './oidc';

/**
 * Step-up primitive (03 §3): sensitive actions need a proof of presence from the last 10 minutes:
 *
 *  • the second factor checked just now (authenticator code, recovery code or passkey — it stamps
 *    Session.mfaAt), which is how everyone with a factor confirms (2026-11-01), or
 *  • a Google login just now, for accounts without a factor.
 *
 * Google cannot be made to ask for the password again (it ignores prompt=login, has no reauth
 * request and returns auth_time only when enabled), so for admins the second factor is the real
 * step-up; the Google path proves an interactive account choice.
 */
const fresh = (t: Date | null | undefined, now: Date) => {
  if (!t) return false;
  const age = now.getTime() - t.getTime();
  return age >= -60_000 && age <= STEP_UP_MAX_AGE_SEC * 1000;
};

export function isStepUpFresh(
  session: Pick<Session, 'authTime'> & Partial<Pick<Session, 'mfaAt'>>,
  now = new Date(),
): boolean {
  return fresh(session.authTime, now) || fresh(session.mfaAt, now);
}

export function stepUpUrl(returnTo: string): string {
  return `/api/auth/google/start?stepUp=1&returnTo=${encodeURIComponent(returnTo)}`;
}
