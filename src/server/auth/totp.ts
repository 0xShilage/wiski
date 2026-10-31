import 'server-only';
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import type { Session, User } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { db } from '../db';
import { getEnv } from '../env';
import { HttpError, Problems } from '../http/problem';
import { redis } from '../redis';
import { hmacSha256, safeEqual } from '../security/crypto';
import { factorsOf, hasFactor, isMfaFresh, revokeMfaTrust } from './mfa';

/**
 * Authenticator app second factor (TOTP, RFC 6238 — Google Authenticator, Microsoft
 * Authenticator, 1Password, Aegis…): HMAC-SHA1, 6 digits, 30-second steps, ±1 step of clock drift.
 *
 *  • The 160-bit secret is encrypted at rest (AES-256-GCM, user id as AAD) with
 *    TOTP_ENCRYPTION_KEY; during set-up it waits in Redis (encrypted, 10 min, bound to the session).
 *  • A code is accepted once: `totpLastStep` only moves forward (compare-and-set), so a code seen
 *    over someone's shoulder can't be replayed in the same 90 seconds.
 *  • 6 single-use recovery codes (50 bits each), stored as HMAC-SHA256 under the same key, shown
 *    once. Using one counts as the second factor.
 *  • Guessing is capped by the route's rate limit (6 tries per 15 minutes per account).
 */
export const TOTP_DIGITS = 6;
export const TOTP_STEP_SEC = 30;
export const TOTP_DRIFT_STEPS = 1;
export const RECOVERY_CODES = 6;
const SECRET_BYTES = 20;
const PENDING_TTL_SEC = 10 * 60;
const ISSUER = 'Wiski';

// ── RFC 4648 base32 (what authenticator apps expect) ──
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── RFC 4226 / 6238 ──

export function hotp(secret: Uint8Array, counter: bigint, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (now: Date) => BigInt(Math.floor(now.getTime() / 1000 / TOTP_STEP_SEC));

export function totpAt(secret: Uint8Array, now: Date): string {
  return hotp(secret, stepAt(now));
}

/** The matching time step within ±1 step, or null. Compares every candidate in constant time. */
export function matchStep(secret: Uint8Array, code: string, now: Date): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const base = stepAt(now);
  let found: bigint | null = null;
  for (let d = -TOTP_DRIFT_STEPS; d <= TOTP_DRIFT_STEPS; d++) {
    const step = base + BigInt(d);
    if (safeEqual(hotp(secret, step), code) && found === null) found = step;
  }
  return found;
}

// ── encryption at rest ──

function key(): Buffer {
  const env = getEnv();
  if (env.TOTP_ENCRYPTION_KEY) return Buffer.from(env.TOTP_ENCRYPTION_KEY, 'base64url');
  // development/test only (env validation requires the key in production)
  return Buffer.from(hkdfSync('sha256', env.CSRF_SECRET, 'wiski', 'totp-dev-key', 32));
}

function encrypt(secret: Uint8Array, userId: string): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  c.setAAD(Buffer.from(`totp:${userId}`));
  const ct = Buffer.concat([c.update(secret), c.final()]);
  return new Uint8Array(Buffer.concat([iv, ct, c.getAuthTag()]));
}

function decrypt(blob: Uint8Array, userId: string): Buffer {
  const b = Buffer.from(blob);
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAAD(Buffer.from(`totp:${userId}`));
  d.setAuthTag(b.subarray(b.length - 16));
  return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]);
}

// ── recovery codes: XXXXX-XXXXX from an unambiguous alphabet (no 0/O, 1/I/L) ──
const RC_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 symbols ≈ 4.95 bits each

function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => RC_ALPHABET[b % RC_ALPHABET.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

export function normaliseRecoveryCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[2-9A-HJKMNP-Z]{10}$/.test(c)) return null;
  return c;
}

function recoveryHash(userId: string, normalised: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(hmacSha256(key(), `recovery:${userId}:${normalised}`));
}

// ── QR code as an SVG path (rendered as React SVG: no data URL, no inline style) ──

export type Qr = { size: number; path: string };

export function qrFor(text: string): Qr {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 4;
  let path = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(y, x)) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return { size: n + quiet * 2, path };
}

// ── problems ──

export const TotpProblems = {
  invalid: () =>
    new HttpError(
      400,
      'TOTP_INVALID',
      'Código incorreto ou expirado. Confira o app e tente de novo.',
    ),
  pendingMissing: () =>
    new HttpError(
      400,
      'TOTP_SETUP_EXPIRED',
      'A configuração expirou (10 minutos). Comece de novo para gerar outro QR code.',
    ),
  alreadyEnabled: () =>
    new HttpError(409, 'TOTP_ALREADY_ENABLED', 'O app autenticador já está ativado nesta conta.'),
  notEnabled: () =>
    new HttpError(409, 'TOTP_NOT_ENABLED', 'O app autenticador não está ativado nesta conta.'),
};

type Ctx = { requestId: string | null };
type Actor = Pick<User, 'id' | 'role' | 'username'>;
const pendingKey = (sessionId: string) => `wf:totp:pending:${sessionId}`;

function issueRecoveryCodes(): { plain: string[] } {
  const plain = new Set<string>();
  while (plain.size < RECOVERY_CODES) plain.add(newRecoveryCode());
  return { plain: [...plain] };
}

/**
 * Step 1: a new secret and its QR code. Adding the authenticator to an account that already has
 * a second factor needs that factor checked first (else a stolen Google login could add its own).
 */
export async function startTotpSetup(
  user: Actor,
  session: Pick<Session, 'id' | 'mfaAt'>,
  now = new Date(),
): Promise<{ secret: string; uri: string; qr: Qr; expiresAt: string }> {
  const factors = await factorsOf(user.id);
  if (factors.totp) throw TotpProblems.alreadyEnabled();
  if (hasFactor(factors) && !isMfaFresh(session, now)) throw Problems.mfaRequired();
  const secret = randomBytes(SECRET_BYTES);
  await redis().set(
    pendingKey(session.id),
    Buffer.from(encrypt(secret, user.id)).toString('base64url'),
    'EX',
    PENDING_TTL_SEC,
  );
  const b32 = base32Encode(secret);
  const label = encodeURIComponent(`${ISSUER}:@${user.username ?? 'moderacao'}`);
  const uri =
    `otpauth://totp/${label}?secret=${b32}&issuer=${ISSUER}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SEC}`;
  return {
    secret: b32.replace(/(.{4})/g, '$1 ').trim(),
    uri,
    qr: qrFor(uri),
    expiresAt: new Date(now.getTime() + PENDING_TTL_SEC * 1000).toISOString(),
  };
}

/** Step 2: the first code proves the app has the secret → enabled, 6 recovery codes, verified. */
export async function enableTotp(
  user: Actor,
  session: Pick<Session, 'id' | 'mfaAt'>,
  code: string,
  ctx: Ctx,
  now = new Date(),
): Promise<{ recoveryCodes: string[]; mfaAt: Date }> {
  const factors = await factorsOf(user.id);
  if (factors.totp) throw TotpProblems.alreadyEnabled();
  if (hasFactor(factors) && !isMfaFresh(session, now)) throw Problems.mfaRequired();
  const pending = await redis().get(pendingKey(session.id));
  if (!pending) throw TotpProblems.pendingMissing();
  let secret: Buffer;
  try {
    secret = decrypt(Buffer.from(pending, 'base64url'), user.id);
  } catch {
    throw TotpProblems.pendingMissing();
  }
  const step = matchStep(secret, code.trim(), now);
  if (step === null) throw TotpProblems.invalid();
  const { plain } = issueRecoveryCodes();
  const ok = await db().$transaction(async (tx) => {
    const res = await tx.user.updateMany({
      where: { id: user.id, totpEnabledAt: null },
      data: { totpSecretEnc: encrypt(secret, user.id), totpEnabledAt: now, totpLastStep: step },
    });
    if (res.count !== 1) return false;
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.mfaRecoveryCode.createMany({
      data: plain.map((c) => ({
        userId: user.id,
        codeHash: recoveryHash(user.id, normaliseRecoveryCode(c)!),
        createdAt: now,
      })),
    });
    await tx.session.updateMany({
      where: { id: session.id, userId: user.id, revokedAt: null },
      data: { mfaAt: now },
    });
    await audit(
      {
        action: 'totp.enable',
        actor: { id: user.id, role: user.role },
        requestId: ctx.requestId,
        targetType: 'User',
        targetId: user.id,
        metadata: {},
      },
      tx,
    );
    return true;
  });
  if (!ok) throw TotpProblems.alreadyEnabled();
  await redis().del(pendingKey(session.id));
  return { recoveryCodes: plain, mfaAt: now };
}

/** The check itself: a 6-digit code from the app, or one recovery code. */
export async function verifyTotp(
  user: Actor,
  session: Pick<Session, 'id'>,
  input: { code: string } | { recoveryCode: string },
  ctx: Ctx,
  now = new Date(),
): Promise<{ mfaAt: Date; method: 'totp' | 'recovery'; recoveryLeft: number }> {
  const row = await db().user.findUnique({
    where: { id: user.id },
    select: { totpSecretEnc: true, totpLastStep: true },
  });
  if (!row?.totpSecretEnc) throw TotpProblems.notEnabled();

  if ('code' in input) {
    const secret = decrypt(row.totpSecretEnc, user.id);
    const step = matchStep(secret, input.code.trim(), now);
    if (step === null || (row.totpLastStep !== null && step <= row.totpLastStep)) {
      throw TotpProblems.invalid();
    }
    const ok = await db().$transaction(async (tx) => {
      // compare-and-set: the same code (or an older one) can't be used twice, even in parallel
      const res = await tx.user.updateMany({
        where: {
          id: user.id,
          totpEnabledAt: { not: null },
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
        },
        data: { totpLastStep: step },
      });
      if (res.count !== 1) return false;
      const s = await tx.session.updateMany({
        where: { id: session.id, userId: user.id, revokedAt: null },
        data: { mfaAt: now },
      });
      if (s.count !== 1) return false;
      await audit(
        {
          action: 'totp.verify',
          actor: { id: user.id, role: user.role },
          requestId: ctx.requestId,
          targetType: 'User',
          targetId: user.id,
          metadata: { method: 'totp' },
        },
        tx,
      );
      return true;
    });
    if (!ok) throw TotpProblems.invalid();
    return { mfaAt: now, method: 'totp', recoveryLeft: await recoveryLeft(user.id) };
  }

  const normalised = normaliseRecoveryCode(input.recoveryCode);
  if (!normalised) throw TotpProblems.invalid();
  const ok = await db().$transaction(async (tx) => {
    const res = await tx.mfaRecoveryCode.updateMany({
      where: { userId: user.id, codeHash: recoveryHash(user.id, normalised), usedAt: null },
      data: { usedAt: now },
    });
    if (res.count !== 1) return false;
    const s = await tx.session.updateMany({
      where: { id: session.id, userId: user.id, revokedAt: null },
      data: { mfaAt: now },
    });
    if (s.count !== 1) return false;
    await audit(
      {
        action: 'totp.verify',
        actor: { id: user.id, role: user.role },
        requestId: ctx.requestId,
        targetType: 'User',
        targetId: user.id,
        metadata: { method: 'recovery' },
      },
      tx,
    );
    return true;
  });
  if (!ok) throw TotpProblems.invalid();
  return { mfaAt: now, method: 'recovery', recoveryLeft: await recoveryLeft(user.id) };
}

export async function recoveryLeft(userId: string): Promise<number> {
  return db().mfaRecoveryCode.count({ where: { userId, usedAt: null } });
}

/** A fresh set of 6 (the old ones stop working). Route: fresh second factor + Google step-up. */
export async function regenerateRecoveryCodes(
  user: Actor,
  ctx: Ctx,
  now = new Date(),
): Promise<string[]> {
  const { plain } = issueRecoveryCodes();
  await db().$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: user.id }, select: { totpEnabledAt: true } });
    if (!u?.totpEnabledAt) throw TotpProblems.notEnabled();
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.mfaRecoveryCode.createMany({
      data: plain.map((c) => ({
        userId: user.id,
        codeHash: recoveryHash(user.id, normaliseRecoveryCode(c)!),
        createdAt: now,
      })),
    });
    await audit(
      {
        action: 'totp.recovery.regenerate',
        actor: { id: user.id, role: user.role },
        requestId: ctx.requestId,
        targetType: 'User',
        targetId: user.id,
        metadata: {},
      },
      tx,
    );
  });
  return plain;
}

/** Turn the authenticator off. Route: fresh second factor + Google step-up. */
export async function disableTotp(user: Actor, ctx: Ctx): Promise<void> {
  await db().$transaction(async (tx) => {
    const res = await tx.user.updateMany({
      where: { id: user.id, totpEnabledAt: { not: null } },
      data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null },
    });
    if (res.count !== 1) throw TotpProblems.notEnabled();
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    const passkeys = await tx.passkey.count({ where: { userId: user.id } });
    await revokeMfaTrust(tx, user.id, { clearSessions: passkeys === 0 });
    await audit(
      {
        action: 'totp.disable',
        actor: { id: user.id, role: user.role },
        requestId: ctx.requestId,
        targetType: 'User',
        targetId: user.id,
        metadata: {},
      },
      tx,
    );
  });
}
