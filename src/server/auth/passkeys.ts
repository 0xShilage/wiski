import 'server-only';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Passkey, Session, User } from '@/generated/prisma/client';
import { db } from '../db';
import { getEnv } from '../env';
import { HttpError } from '../http/problem';
import { logger } from '../log';
import { redis } from '../redis';

/**
 * Passkeys (WebAuthn) — the second factor MODERATOR and STREAMER must present for /admin and
 * every admin API (11 §9, O6; 12 §2 step 4).
 *
 *  • Challenges are random, bound to the session, single-use (Redis GETDEL) and expire in 5 min.
 *  • User verification is required (PIN/biometric), origin and RP ID are pinned to APP_ORIGIN.
 *  • A sign counter that does not increase (cloned authenticator) is rejected by the library;
 *    the stored counter is updated with a compare-and-set so two parallel assertions can't both win.
 *  • A successful assertion stamps Session.mfaAt; admin routes accept it for MFA_MAX_AGE_SEC.
 */
export const MFA_MAX_AGE_SEC = 10 * 60;
const CHALLENGE_TTL_SEC = 5 * 60;
const MAX_PASSKEYS_PER_USER = 10;

const TRANSPORTS = new Set<string>([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);

export function relyingParty() {
  const origin = getEnv().APP_ORIGIN;
  return { rpID: new URL(origin).hostname, rpName: 'Wiski', origin };
}

type Purpose = 'reg' | 'auth';
const challengeKey = (purpose: Purpose, sessionId: string) => `wa:${purpose}:${sessionId}`;

async function storeChallenge(purpose: Purpose, sessionId: string, challenge: string) {
  await redis().set(challengeKey(purpose, sessionId), challenge, 'EX', CHALLENGE_TTL_SEC);
}

/** Single use: read-and-delete atomically; a replayed response finds no challenge. */
async function takeChallenge(purpose: Purpose, sessionId: string): Promise<string | null> {
  return redis().getdel(challengeKey(purpose, sessionId));
}

export const PasskeyProblems = {
  challengeMissing: () =>
    new HttpError(400, 'PASSKEY_CHALLENGE_EXPIRED', 'O pedido expirou. Tente de novo.'),
  failed: () =>
    new HttpError(400, 'PASSKEY_FAILED', 'Não foi possível confirmar a passkey. Tente de novo.'),
  tooMany: () =>
    new HttpError(409, 'PASSKEY_LIMIT', 'Você atingiu o limite de passkeys. Remova uma antes.'),
  none: () =>
    new HttpError(409, 'PASSKEY_NONE', 'Cadastre uma passkey antes de verificar.', {
      members: { enrollUrl: '/perfil/seguranca' },
    }),
};

const toB64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const fromB64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

function transportsOf(p: Pick<Passkey, 'transports'>): string[] {
  return p.transports.filter((t) => TRANSPORTS.has(t));
}

export async function listPasskeys(userId: string) {
  return db().passkey.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      label: true,
      createdAt: true,
      lastUsedAt: true,
      backedUp: true,
      transports: true,
    },
  });
}

export async function countPasskeys(userId: string): Promise<number> {
  return db().passkey.count({ where: { userId } });
}

export async function registrationOptions(
  user: Pick<User, 'id' | 'username' | 'email'>,
  session: Pick<Session, 'id'>,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await db().passkey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });
  if (existing.length >= MAX_PASSKEYS_PER_USER) throw PasskeyProblems.tooMany();
  const { rpID, rpName } = relyingParty();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    // Stable per account (lets an authenticator replace its own credential); not personal data.
    userID: new Uint8Array(Buffer.from(user.id.replace(/-/g, ''), 'hex')),
    userName: user.username ? `@${user.username}` : 'Wiski',
    userDisplayName: user.username ? `@${user.username}` : 'Wiski',
    attestationType: 'none',
    timeout: CHALLENGE_TTL_SEC * 1000,
    excludeCredentials: existing.map((c) => ({
      id: toB64u(c.credentialId),
      transports: transportsOf(c),
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
  await storeChallenge('reg', session.id, options.challenge);
  return options;
}

export async function verifyRegistration(
  user: Pick<User, 'id'>,
  session: Pick<Session, 'id'>,
  response: RegistrationResponseJSON,
  label: string | null,
) {
  const expectedChallenge = await takeChallenge('reg', session.id);
  if (!expectedChallenge) throw PasskeyProblems.challengeMissing();
  const { rpID, origin } = relyingParty();
  let result;
  try {
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown' },
      'passkey registration rejected',
    );
    throw PasskeyProblems.failed();
  }
  if (!result.verified) throw PasskeyProblems.failed();
  const info = result.registrationInfo;
  if ((await countPasskeys(user.id)) >= MAX_PASSKEYS_PER_USER) throw PasskeyProblems.tooMany();
  try {
    return await db().passkey.create({
      data: {
        userId: user.id,
        credentialId: fromB64u(info.credential.id),
        publicKey: new Uint8Array(info.credential.publicKey),
        signCount: BigInt(info.credential.counter),
        transports: (info.credential.transports ?? []).filter((t) => TRANSPORTS.has(t)),
        label,
        aaguid: /^[0-9a-f-]{36}$/i.test(info.aaguid) ? info.aaguid : null,
        backedUp: info.credentialBackedUp,
      },
      select: { id: true, backedUp: true, transports: true },
    });
  } catch {
    // credentialId is unique: the same authenticator registered twice (or on another account).
    throw PasskeyProblems.failed();
  }
}

export async function authenticationOptions(
  user: Pick<User, 'id'>,
  session: Pick<Session, 'id'>,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const creds = await db().passkey.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });
  if (creds.length === 0) throw PasskeyProblems.none();
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: CHALLENGE_TTL_SEC * 1000,
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({
      id: toB64u(c.credentialId),
      transports: transportsOf(c),
    })),
  });
  await storeChallenge('auth', session.id, options.challenge);
  return options;
}

/** Verify an assertion for THIS user and stamp the session's mfaAt. */
export async function verifyAuthentication(
  user: Pick<User, 'id'>,
  session: Pick<Session, 'id'>,
  response: AuthenticationResponseJSON,
  now = new Date(),
): Promise<{ passkeyId: string; mfaAt: Date }> {
  const expectedChallenge = await takeChallenge('auth', session.id);
  if (!expectedChallenge) throw PasskeyProblems.challengeMissing();
  let credentialId: Uint8Array<ArrayBuffer>;
  try {
    credentialId = fromB64u(response.id);
  } catch {
    throw PasskeyProblems.failed();
  }
  // Only this user's credentials: someone else's passkey can't satisfy my session.
  const passkey = await db().passkey.findFirst({ where: { userId: user.id, credentialId } });
  if (!passkey) throw PasskeyProblems.failed();
  const { rpID, origin } = relyingParty();
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: toB64u(passkey.credentialId),
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.signCount),
        transports: transportsOf(passkey),
      },
    });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown' },
      'passkey assertion rejected',
    );
    throw PasskeyProblems.failed();
  }
  if (!result.verified) throw PasskeyProblems.failed();
  const updated = await db().$transaction(async (tx) => {
    // Compare-and-set on the counter: a parallel assertion with the same counter loses.
    const res = await tx.passkey.updateMany({
      where: { id: passkey.id, signCount: passkey.signCount },
      data: {
        signCount: BigInt(result.authenticationInfo.newCounter),
        lastUsedAt: now,
        backedUp: result.authenticationInfo.credentialBackedUp,
      },
    });
    if (res.count !== 1) return false;
    const s = await tx.session.updateMany({
      where: { id: session.id, userId: user.id, revokedAt: null },
      data: { mfaAt: now },
    });
    return s.count === 1;
  });
  if (!updated) throw PasskeyProblems.failed();
  return { passkeyId: passkey.id, mfaAt: now };
}

export async function deletePasskey(userId: string, passkeyId: string): Promise<boolean> {
  const res = await db().passkey.deleteMany({ where: { id: passkeyId, userId } });
  return res.count === 1;
}

export function isMfaFresh(session: Pick<Session, 'mfaAt'>, now = new Date()): boolean {
  if (!session.mfaAt) return false;
  const age = now.getTime() - session.mfaAt.getTime();
  return age >= -60_000 && age <= MFA_MAX_AGE_SEC * 1000;
}
