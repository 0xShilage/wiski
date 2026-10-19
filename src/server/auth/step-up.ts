import 'server-only';
import type { Session } from '@/generated/prisma/client';
import { STEP_UP_MAX_AGE_SEC } from './oidc';

/**
 * Step-up primitive (03 §3): sensitive admin actions need an interactive Google login within the
 * last 10 minutes (prompt=login&max_age=600). Phase 4 adds the passkey assertion (mfaAt) that
 * the STREAMER must also present (Q17).
 */
export function isStepUpFresh(session: Pick<Session, 'authTime'>, now = new Date()): boolean {
  const age = now.getTime() - session.authTime.getTime();
  return age >= -60_000 && age <= STEP_UP_MAX_AGE_SEC * 1000;
}

export function stepUpUrl(returnTo: string): string {
  return `/api/auth/google/start?stepUp=1&returnTo=${encodeURIComponent(returnTo)}`;
}
