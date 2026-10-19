import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { hmacSha256 } from '../security/crypto';

/**
 * Mercado Pago notification signature (05 §6 steps 2–5; same mechanism for the Orders API):
 *
 *   x-signature: ts=<ts>,v1=<hex HMAC-SHA256>
 *   manifest:    id:<data.id from the query string>;request-id:<x-request-id>;ts:<ts>;
 *
 * `data.id` is lower-cased when alphanumeric (MP's documented rule — Orders ids are upper-case,
 * e.g. "ORD01…"); as the Orders notification page doesn't restate the rule, the id as received is
 * accepted too (both variants need the secret). Comparison is constant-time on equal-length
 * buffers; the current and, during rotation, the previous secret are tried.
 */
export type SignatureParts = { ts: string; v1: string };

export function parseSignature(header: string | null): SignatureParts | null {
  if (!header || header.length > 512) return null;
  let ts: string | null = null;
  let v1: string | null = null;
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) return null;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 'ts') {
      if (ts !== null) return null;
      ts = v;
    } else if (k === 'v1') {
      if (v1 !== null) return null;
      v1 = v;
    }
  }
  if (!ts || !/^\d{9,16}$/.test(ts)) return null;
  if (!v1 || !/^[0-9a-f]{64}$/i.test(v1)) return null;
  return { ts, v1: v1.toLowerCase() };
}

export function manifest(dataId: string | null, requestId: string | null, ts: string): string {
  // MP omits absent components entirely.
  return `${dataId !== null ? `id:${dataId};` : ''}${requestId !== null ? `request-id:${requestId};` : ''}ts:${ts};`;
}

/** ts may be seconds or milliseconds (MP's examples show ms) — decided by magnitude. */
export function tsMillis(ts: string): number {
  const n = Number(ts);
  return n > 1e12 ? n : n * 1000;
}

export type VerifyResult = 'ok' | 'bad-signature' | 'stale' | 'malformed';

export function verifyNotification(input: {
  dataId: string | null;
  requestId: string | null;
  signature: string | null;
  secrets: readonly string[];
  now?: number;
  toleranceMs?: number;
}): VerifyResult {
  const parts = parseSignature(input.signature);
  if (!parts) return 'malformed';
  const expected = Buffer.from(parts.v1, 'hex');
  const ids =
    input.dataId !== null && /^[a-z0-9]+$/i.test(input.dataId)
      ? [...new Set([input.dataId.toLowerCase(), input.dataId])]
      : [input.dataId];
  let match = false;
  for (const secret of input.secrets) {
    for (const id of ids) {
      const mac = hmacSha256(secret, manifest(id, input.requestId, parts.ts));
      if (mac.length === expected.length && timingSafeEqual(mac, expected)) match = true;
    }
  }
  if (!match) return 'bad-signature';
  const age = Math.abs((input.now ?? Date.now()) - tsMillis(parts.ts));
  if (age > (input.toleranceMs ?? 10 * 60_000)) return 'stale';
  return 'ok';
}
