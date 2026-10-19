import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** 256-bit random token, base64url (43 chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(data: string | Uint8Array): Buffer {
  return createHash('sha256').update(data).digest();
}

/** SHA-256 as a plain Uint8Array (the type Prisma 7 uses for `Bytes` columns). */
export function sha256Bytes(data: string | Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(sha256(data));
}

export function hmacSha256(key: string | Uint8Array, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** Constant-time comparison for strings/bytes of possibly different length. */
export function safeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const ba = typeof a === 'string' ? Buffer.from(a) : Buffer.from(a);
  const bb = typeof b === 'string' ? Buffer.from(b) : Buffer.from(b);
  // Hash first so the comparison is always equal-length and timing-independent of the length.
  return timingSafeEqual(sha256(ba), sha256(bb)) && ba.length === bb.length;
}

// ── Sealed values (AES-256-GCM) — short-lived cookies such as __Host-wf_oauth ─────────────────

const SEAL_VERSION = 'v1';

function keyId(key: Buffer): string {
  return sha256(key).subarray(0, 4).toString('hex');
}

export type SealKeys = { current: string; previous?: string | undefined };

function decodeKey(key: string): Buffer {
  const buf = Buffer.from(key, 'base64url');
  if (buf.length !== 32) throw new Error('seal key must be 32 bytes');
  return buf;
}

/**
 * Encrypt + authenticate a JSON payload. `purpose` is bound as AAD, so a value sealed for one
 * cookie can't be replayed as another. Expiry is inside the ciphertext.
 */
export function seal(payload: unknown, keys: SealKeys, purpose: string, ttlMs: number): string {
  const key = decodeKey(keys.current);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${SEAL_VERSION}:${purpose}`));
  const body = JSON.stringify({ exp: Date.now() + ttlMs, v: payload });
  const ct = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SEAL_VERSION}.${keyId(key)}.${Buffer.concat([iv, ct, tag]).toString('base64url')}`;
}

/** Returns the payload, or null when tampered, expired, malformed or sealed with an unknown key. */
export function unseal<T = unknown>(sealed: string, keys: SealKeys, purpose: string): T | null {
  if (sealed.length > 4096) return null;
  const parts = sealed.split('.');
  if (parts.length !== 3 || parts[0] !== SEAL_VERSION) return null;
  const candidates = [keys.current, keys.previous].filter((k): k is string => !!k).map(decodeKey);
  const key = candidates.find((k) => keyId(k) === parts[1]);
  if (!key) return null;
  const raw = Buffer.from(parts[2]!, 'base64url');
  if (raw.length < 12 + 16 + 2) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${SEAL_VERSION}:${purpose}`));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const body = Buffer.concat([
      decipher.update(raw.subarray(12, raw.length - 16)),
      decipher.final(),
    ]);
    const parsed = JSON.parse(body.toString('utf8')) as { exp?: unknown; v?: unknown };
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return parsed.v as T;
  } catch {
    return null;
  }
}
