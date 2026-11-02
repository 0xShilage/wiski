import 'server-only';
import { z } from 'zod';
import type { PaymentStatus } from '@/generated/prisma/enums';
import { getEnv } from '../../env';
import { logger } from '../../log';
import { plainText } from '../../text/sanitize';

/**
 * Mercado Pago Payments API client (09 §B, 01 §3.2–3.3). Server-side only; the access token never
 * leaves this module and is never logged. Every response is validated with Zod before use; only
 * the fields the site relies on are read. Money crosses the boundary exactly once: integer cents
 * → `transaction_amount` (reais) with a round-trip assertion.
 */
export const MP_API = 'https://api.mercadopago.com';
const TIMEOUT_MS = 8_000;

export class MpError extends Error {
  constructor(
    readonly kind: 'not-configured' | 'timeout' | 'network' | 'http' | 'invalid-response',
    readonly status: number | null = null,
  ) {
    super(`mercadopago ${kind}${status ? ` ${status}` : ''}`);
    this.name = 'MpError';
  }
  /** Worth retrying later (the worker backs off; checkout gives up and releases the reservation). */
  get transient(): boolean {
    return (
      this.kind === 'timeout' ||
      this.kind === 'network' ||
      (this.kind === 'http' && (this.status === 429 || (this.status ?? 0) >= 500))
    );
  }
}

const isoDate = z.string().min(10).max(40);

export const mpPaymentSchema = z.object({
  id: z.number().int().positive(),
  status: z.string().min(1).max(40),
  status_detail: z.string().max(100).nullish(),
  transaction_amount: z.number().nonnegative(),
  currency_id: z.string().max(5),
  payment_method_id: z.string().max(40).nullish(),
  external_reference: z.string().max(256).nullish(),
  collector_id: z.number().int().nullish(),
  live_mode: z.boolean(),
  date_created: isoDate.nullish(),
  date_approved: isoDate.nullish(),
  date_last_updated: isoDate.nullish(),
  date_of_expiration: isoDate.nullish(),
  point_of_interaction: z
    .object({
      transaction_data: z
        .object({
          qr_code: z.string().max(2048).nullish(),
          qr_code_base64: z.string().max(200_000).nullish(),
        })
        .nullish(),
    })
    .nullish(),
});
export type MpPayment = z.infer<typeof mpPaymentSchema>;

const STATUS: Record<string, PaymentStatus> = {
  pending: 'PENDING',
  approved: 'APPROVED',
  authorized: 'AUTHORIZED',
  in_process: 'IN_PROCESS',
  in_mediation: 'IN_MEDIATION',
  rejected: 'REJECTED',
  cancelled: 'CANCELLED',
  refunded: 'REFUNDED',
  charged_back: 'CHARGED_BACK',
};

/** MP status → ours; unknown values are null (the caller treats them as "needs attention"). */
export function mapStatus(status: string): PaymentStatus | null {
  return STATUS[status] ?? null;
}

export function isMpConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.MP_ACCESS_TOKEN && env.MP_COLLECTOR_ID);
}

/** Cents → reais for `transaction_amount`, asserting the value survives the round trip. */
export function centsToAmount(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new RangeError('amount');
  const amount = cents / 100;
  if (Math.round(amount * 100) !== cents) throw new RangeError('amount round-trip');
  return amount;
}

/** `transaction_amount` (reais, may carry float noise) → cents. */
export function amountToCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * MP's date format with an explicit offset: "2026-10-30T12:31:00.000-03:00". Brazil has had no
 * daylight-saving time since 2019, so America/Sao_Paulo is a fixed −03:00.
 */
export function mpDate(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().replace('Z', '-03:00');
}

async function call(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<MpPayment> {
  return request(mpPaymentSchema, method, path, body, idempotencyKey);
}

async function request<T>(
  schema: z.ZodType<T>,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<T> {
  const token = getEnv().MP_ACCESS_TOKEN;
  if (!token) throw new MpError('not-configured');
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`${MP_API}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    });
  } catch (err) {
    const timeout =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new MpError(timeout ? 'timeout' : 'network');
  }
  if (!res.ok) {
    let detail: { code: string | null; message: string | null } = { code: null, message: null };
    try {
      detail = mpErrorDetail(await res.json());
    } catch {
      // not JSON: the status is all we log
    }
    logger.warn(
      {
        mp: {
          method,
          path: path.replace(/\d+/g, ':id'),
          status: res.status,
          // not "code": the logger redacts any field with that name (OAuth codes)
          causes: detail.code,
          message: detail.message,
        },
      },
      'mercadopago error',
    );
    throw new MpError('http', res.status);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new MpError('invalid-response', res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new MpError('invalid-response', res.status);
  return parsed.data;
}

const errorBody = z.object({
  message: z.string().optional(),
  error: z.string().optional(),
  cause: z
    .array(
      z.object({
        code: z.union([z.string(), z.number()]).optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * What Mercado Pago said about a refused request, safe to log (2026-11-02): its error codes and
 * message, cut to 200 characters with e-mail addresses and long digit runs (ids, documents)
 * masked, because the body can echo request data. E.g. code 13253 = "Collector user without key
 * enabled for QR render" (the account has no Pix key).
 */
export function mpErrorDetail(body: unknown): { code: string | null; message: string | null } {
  const parsed = errorBody.safeParse(body);
  if (!parsed.success) return { code: null, message: null };
  const b = parsed.data;
  const clean = (s: string) =>
    plainText(s.slice(0, 400))
      .replace(/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){0,8}/g, '<email>')
      .replace(/\d{7,}/g, '<n>')
      .slice(0, 200);
  const codes = (b.cause ?? [])
    .map((c) => (c.code === undefined ? '' : String(c.code)))
    .filter((c) => /^[\w-]{1,20}$/.test(c));
  const texts = [b.message, b.error, ...(b.cause ?? []).map((c) => c.description)].filter(
    (t): t is string => !!t,
  );
  return {
    code: codes.length ? codes.slice(0, 5).join(',') : null,
    message: texts.length ? clean([...new Set(texts)].join(' | ')) : null,
  };
}

export type CreatePix = {
  amountCents: number;
  description: string;
  externalReference: string;
  payerEmail: string;
  /** development only (MP_TEST_PAYER_EMAIL): MP's test payer name, "APRO" = approve */
  payerFirstName?: string | undefined;
  expiresAt: Date;
  idempotencyKey: string;
};

/**
 * POST /v1/payments with payment_method_id "pix". No per-payment notification_url: notifications
 * come from the signed panel configuration (01 §3.2).
 */
export function createPixPayment(p: CreatePix): Promise<MpPayment> {
  if (getEnv().MP_ALLOW_LIVE_IN_DEV) {
    logger.warn({ alert: 'payments' }, 'MP_ALLOW_LIVE_IN_DEV: creating a REAL Pix (development)');
  }
  return call(
    'POST',
    '/v1/payments',
    {
      transaction_amount: centsToAmount(p.amountCents),
      description: p.description,
      payment_method_id: 'pix',
      external_reference: p.externalReference,
      date_of_expiration: mpDate(p.expiresAt),
      payer: { email: p.payerEmail, ...(p.payerFirstName ? { first_name: p.payerFirstName } : {}) },
    },
    p.idempotencyKey,
  );
}

export function getPayment(id: string): Promise<MpPayment> {
  if (!/^\d{1,20}$/.test(id)) throw new MpError('invalid-response');
  return call('GET', `/v1/payments/${id}`);
}

/** Cancel a still-pending Pix (PUT status=cancelled). */
export function cancelPayment(id: string): Promise<MpPayment> {
  if (!/^\d{1,20}$/.test(id)) throw new MpError('invalid-response');
  return call('PUT', `/v1/payments/${id}`, { status: 'cancelled' });
}

export const mpRefundSchema = z.object({
  id: z.number().int().positive(),
  payment_id: z.number().int().positive(),
  amount: z.number().positive(),
  status: z.string().min(1).max(40),
});
export type MpRefund = z.infer<typeof mpRefundSchema>;

/**
 * Full refund of an approved payment (POST /v1/payments/{id}/refunds) — the streamer's exception
 * tool only (04 §8). The idempotency key makes a retried request return the same refund.
 */
export function refundPayment(id: string, idempotencyKey: string): Promise<MpRefund> {
  if (!/^\d{1,20}$/.test(id)) throw new MpError('invalid-response');
  return request(mpRefundSchema, 'POST', `/v1/payments/${id}/refunds`, {}, idempotencyKey);
}

const BASE64 = /^[a-z\d+/]+={0,2}$/i;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * QR payload from MP, validated before it is cached or shown (05 §5 "QR swap"): the image must be
 * strict base64 decoding to a PNG ≤ 64 KB; the copia-e-cola must be a printable EMV string.
 */
export function pixPayload(p: MpPayment): { qrCode: string; qrCodeBase64: string } | null {
  const td = p.point_of_interaction?.transaction_data;
  const qrCode = td?.qr_code ?? '';
  const b64 = td?.qr_code_base64 ?? '';
  if (!/^000201[\x20-\x7e]{20,1000}$/.test(qrCode)) return null;
  if (b64.length > 90_000 || b64.length % 4 !== 0 || !BASE64.test(b64)) return null;
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length > 64 * 1024 || !bytes.subarray(0, 8).equals(PNG)) return null;
  return { qrCode, qrCodeBase64: b64 };
}
