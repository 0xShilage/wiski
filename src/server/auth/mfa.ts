import 'server-only';
import type { Prisma, Session, User } from '@/generated/prisma/client';
import type { NextResponse } from 'next/server';
import { db } from '../db';
import { getEnv } from '../env';
import { seal, unseal } from '../security/crypto';
import { clearHostCookie, COOKIE, setHostCookie } from './cookies';

/**
 * Admin second factor (11 §9, O6; changed 2026-10-31): a passkey **or** an authenticator app.
 *
 *  • A successful check stamps Session.mfaAt; admin routes accept it for MFA_MAX_AGE_SEC (96 h).
 *  • Admin sessions still end after 8 h idle / 24 h, so the check is also remembered on the
 *    device: a sealed `__Host-wf_mfa` cookie (user, time, epoch) lets the next Google login on the
 *    same browser start already verified, until the original 96 h are up. Logging out clears it.
 *  • `User.mfaEpoch` invalidates every remembered device at once: bumped when a factor is removed
 *    or the role changes.
 *  • Money actions (moderators and the streamer) still need a Google login in the last 10 minutes (step-up).
 */
export const MFA_MAX_AGE_SEC = 96 * 3600;
const DEVICE_PURPOSE = 'mfa-device';

export function isMfaFresh(session: Pick<Session, 'mfaAt'>, now = new Date()): boolean {
  if (!session.mfaAt) return false;
  const age = now.getTime() - session.mfaAt.getTime();
  return age >= -60_000 && age <= MFA_MAX_AGE_SEC * 1000;
}

export function mfaVerifiedUntil(mfaAt: Date): Date {
  return new Date(mfaAt.getTime() + MFA_MAX_AGE_SEC * 1000);
}

export type Factors = { passkeys: number; totp: boolean };

export async function factorsOf(userId: string): Promise<Factors> {
  const [passkeys, user] = await Promise.all([
    db().passkey.count({ where: { userId } }),
    db().user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } }),
  ]);
  return { passkeys, totp: !!user?.totpEnabledAt };
}

export const hasFactor = (f: Factors) => f.passkeys > 0 || f.totp;

/** "totp", "passkey", "totp,passkey" or "" — for the STEP_UP_REQUIRED problem. */
export const factorList = (f: Factors) =>
  [f.totp ? 'totp' : null, f.passkeys > 0 ? 'passkey' : null].filter(Boolean).join(',');

// ── remembered device ──

type DeviceClaim = { u: string; at: number; e: number };

function keys() {
  const env = getEnv();
  return { current: env.COOKIE_SEAL_KEY, previous: env.COOKIE_SEAL_KEY_PREVIOUS };
}

/** After a successful check: remember this browser until mfaAt + 96 h. */
export function rememberDevice(
  res: NextResponse,
  user: Pick<User, 'id' | 'mfaEpoch'>,
  mfaAt: Date,
  now = new Date(),
): void {
  const remaining = mfaVerifiedUntil(mfaAt).getTime() - now.getTime();
  if (remaining <= 0) return;
  const claim: DeviceClaim = { u: user.id, at: mfaAt.getTime(), e: user.mfaEpoch };
  setHostCookie(res, COOKIE.mfa, seal(claim, keys(), DEVICE_PURPOSE, remaining), {
    maxAgeSec: Math.floor(remaining / 1000),
    // Lax: the redirect back from Google is a top-level navigation that must carry it.
    sameSite: 'lax',
  });
}

export function forgetDevice(res: NextResponse): void {
  clearHostCookie(res, COOKIE.mfa);
}

/**
 * At login: the time of this browser's last check, if it belongs to this user, the epoch still
 * matches, it is within 96 h, and the user still has a factor.
 */
export async function rememberedMfaAt(
  cookie: string | undefined,
  user: Pick<User, 'id' | 'role' | 'mfaEpoch'>,
  now = new Date(),
): Promise<Date | null> {
  if (!cookie || user.role === 'USER') return null;
  const claim = unseal<DeviceClaim>(cookie, keys(), DEVICE_PURPOSE);
  if (!claim || claim.u !== user.id || claim.e !== user.mfaEpoch || typeof claim.at !== 'number') {
    return null;
  }
  const at = new Date(claim.at);
  if (!isMfaFresh({ mfaAt: at }, now)) return null;
  if (!hasFactor(await factorsOf(user.id))) return null;
  return at;
}

/**
 * A factor was removed or the role changed: forget every remembered device and, when no factor
 * is left, every session's check too.
 */
export async function revokeMfaTrust(
  tx: Prisma.TransactionClient,
  userId: string,
  opts: { clearSessions: boolean },
): Promise<void> {
  await tx.user.update({ where: { id: userId }, data: { mfaEpoch: { increment: 1 } } });
  if (opts.clearSessions) {
    await tx.session.updateMany({ where: { userId, mfaAt: { not: null } }, data: { mfaAt: null } });
  }
}
