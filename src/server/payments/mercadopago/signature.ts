import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Mercado Pago webhook signature (05 §6 steps 2–5). Pure — no env, no I/O — so it is unit-tested
 * directly. `x-signature: ts=<ts>,v1=<hex>`; v1 = HMAC-SHA256(secret, manifest) with the manifest
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`. data.id comes from the QUERY STRING and is
 * lower-cased when alphanumeric; a component that is absent is left out of the manifest, as
 * Mercado Pago specifies.
 */
export type SignatureInput = {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secrets: readonly string[];
  now: number;
  toleranceMs?: number;
};

export type SignatureResult =
  | { ok: true; ts: Date }
  | { ok: false; reason: 'missing' | 'malformed' | 'mismatch' | 'stale' | 'no-secret' };

const DEFAULT_TOLERANCE_MS = 10 * 60_000;

export function parseSignatureHeader(header: string): { ts: string; v1: string } | null {
  if (header.length > 512) return null;
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) return null;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 'ts') {
      if (ts !== undefined) return null;
      ts = value;
    } else if (key === 'v1') {
      if (v1 !== undefined) return null;
      v1 = value;
    }
    // other keys (future versions) are ignored
  }
  if (!ts || !v1 || !/^\d{9,16}$/.test(ts) || !/^[0-9a-f]{64}$/.test(v1)) return null;
  return { ts, v1 };
}

export function manifest(dataId: string | null, requestId: string | null, ts: string): string {
  const id = dataId && /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  return `${id ? `id:${id};` : ''}${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;
}

/** ts may be seconds or milliseconds (MP's examples use ms): normalise by magnitude. */
export function tsToMs(ts: string): number {
  const n = Number(ts);
  return n < 1e12 ? n * 1000 : n;
}

export function verifyMpSignature(input: SignatureInput): SignatureResult {
  if (input.secrets.length === 0) return { ok: false, reason: 'no-secret' };
  if (!input.xSignature) return { ok: false, reason: 'missing' };
  const parsed = parseSignatureHeader(input.xSignature);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const text = manifest(input.dataId, input.xRequestId, parsed.ts);
  const given = Buffer.from(parsed.v1, 'hex');
  const match = input.secrets.some((secret) => {
    const want = createHmac('sha256', secret).update(text).digest();
    return want.length === given.length && timingSafeEqual(want, given);
  });
  if (!match) return { ok: false, reason: 'mismatch' };
  const at = tsToMs(parsed.ts);
  if (Math.abs(input.now - at) > (input.toleranceMs ?? DEFAULT_TOLERANCE_MS)) {
    return { ok: false, reason: 'stale' };
  }
  return { ok: true, ts: new Date(at) };
}

/** Test helper / docs: the header Mercado Pago would send. */
export function signForTest(secret: string, dataId: string, requestId: string, ts: string): string {
  const v1 = createHmac('sha256', secret)
    .update(manifest(dataId, requestId, ts))
    .digest('hex');
  return `ts=${ts},v1=${v1}`;
}
