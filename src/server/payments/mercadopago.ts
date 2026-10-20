import 'server-only';
import { z } from 'zod';
import { getEnv, isLocalOrigin } from '../env';
import { logger } from '../log';

/**
 * Mercado Pago Orders API client (13 D1): one MP order holding one Pix payment per Order.
 *
 *  • Server-side only. The access token never leaves this module and is never logged.
 *  • Amounts cross the boundary as exact decimal strings built from integer cents ("20.00") and
 *    are parsed back with a strict regex — no floating point anywhere.
 *  • Every response is validated with Zod; anything unexpected is an `invalid-response` error.
 *  • POSTs carry X-Idempotency-Key, so retrying a create/cancel/refund can't double it.
 *  • Bounded retries with backoff on network errors, timeouts and 5xx; 4xx is final.
 */

export class MercadoPagoError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'rejected' | 'invalid-response' | 'not-configured',
    readonly status: number | null,
    readonly mpCode: string | null = null,
  ) {
    super(`mercadopago ${kind}${status ? ` ${status}` : ''}${mpCode ? ` ${mpCode}` : ''}`);
    this.name = 'MercadoPagoError';
  }
}

// ── money ──────────────────────────────────────────────────────────────────────────────────

export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new RangeError('cents');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

const DECIMAL = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
/** "20.00" → 2000; "20.5" → 2050; "20" → 2000. Throws on anything else (no floats). */
export function decimalToCents(value: string | number): number {
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  const m = DECIMAL.exec(text);
  if (!m) throw new MercadoPagoError('invalid-response', null, 'amount');
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

// ── response schemas (only what we use; unknown fields are ignored) ──────────────────────────

const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return decimalToCents(v);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'amount' });
    return z.NEVER;
  }
});

const paymentSchema = z.object({
  id: z.string().regex(/^[\w-]{1,64}$/),
  amount: money,
  paid_amount: money.optional().nullable(),
  status: z.string().max(40),
  status_detail: z.string().max(60).optional().nullable(),
  date_of_expiration: z.string().max(40).optional().nullable(),
  payment_method: z
    .object({
      id: z.string().max(40),
      type: z.string().max(40).optional().nullable(),
      qr_code: z.string().max(2048).optional().nullable(),
      qr_code_base64: z.string().max(200_000).optional().nullable(),
      ticket_url: z.url().max(2048).optional().nullable(),
    })
    .optional()
    .nullable(),
});

export const mpOrderSchema = z.object({
  id: z.string().regex(/^[\w-]{1,64}$/),
  status: z.string().max(40),
  status_detail: z.string().max(60).optional().nullable(),
  external_reference: z.string().max(64).optional().nullable(),
  total_amount: money,
  user_id: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  integration_data: z
    .object({ application_id: z.union([z.string(), z.number()]).transform(String).optional() })
    .optional()
    .nullable(),
  last_updated_date: z.string().max(40).optional().nullable(),
  transactions: z
    .object({
      payments: z.array(paymentSchema).max(5).optional().nullable(),
      refunds: z
        .array(z.object({ id: z.string().max(64), status: z.string().max(40).optional() }))
        .max(10)
        .optional()
        .nullable(),
    })
    .optional()
    .nullable(),
});

export type MpOrder = z.infer<typeof mpOrderSchema>;
export type MpPayment = z.infer<typeof paymentSchema>;

/** The single Pix payment inside an MP order (we never create more than one). */
export function pixPaymentOf(o: MpOrder): MpPayment | null {
  return o.transactions?.payments?.[0] ?? null;
}

// ── status mapping (our PaymentStatus is forward-only; 02 §3) ───────────────────────────────

export type MappedStatus =
  | 'PENDING'
  | 'IN_PROCESS'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'CHARGED_BACK'
  | 'IN_MEDIATION';

/** Orders API status (+ detail) → our state. Unknown values → null (logged, no transition). */
export function mapOrderStatus(
  status: string,
  detail: string | null | undefined,
): MappedStatus | null {
  const d = (detail ?? '').toLowerCase();
  switch (status.toLowerCase()) {
    case 'action_required':
    case 'created':
      return 'PENDING';
    case 'processing':
      return 'IN_PROCESS';
    case 'processed':
      return d === 'refunded' ? 'REFUNDED' : 'APPROVED';
    case 'refunded':
      return 'REFUNDED';
    case 'failed':
      return 'REJECTED';
    case 'canceled':
    case 'cancelled':
    case 'expired':
      return 'CANCELLED';
    case 'charged_back':
      return d === 'in_process' ? 'IN_MEDIATION' : 'CHARGED_BACK';
    default:
      return null;
  }
}

// ── transport ───────────────────────────────────────────────────────────────────────────────

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = (...args) => fetch(...args);

/** Test hook: route calls to a mock without touching globals. */
export function setMercadoPagoFetch(f: FetchLike | null): void {
  fetchImpl = f ?? ((...args) => fetch(...args));
}

const TIMEOUT_MS = 10_000;
const RETRIES = 2;

function config() {
  const env = getEnv();
  if (!env.MP_ACCESS_TOKEN || !env.MP_COLLECTOR_ID) {
    throw new MercadoPagoError('not-configured', null);
  }
  return { env, token: env.MP_ACCESS_TOKEN, base: env.MP_API_BASE.replace(/\/$/, '') };
}

export function isMercadoPagoConfigured(): boolean {
  const env = getEnv();
  return !!(env.MP_ACCESS_TOKEN && env.MP_COLLECTOR_ID);
}

async function call(
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; idempotencyKey?: string } = {},
): Promise<unknown> {
  const { token, base } = config();
  let lastError: MercadoPagoError | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(opts.idempotencyKey ? { 'x-idempotency-key': opts.idempotencyKey } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (err) {
      lastError = new MercadoPagoError('unavailable', null);
      logger.warn(
        {
          op: `${method} ${path.split('/').slice(0, 3).join('/')}`,
          attempt,
          err: err instanceof Error ? err.name : 'unknown',
        },
        'mercadopago request failed',
      );
      continue;
    }
    if (res.status >= 500 || res.status === 429) {
      lastError = new MercadoPagoError('unavailable', res.status);
      await res.body?.cancel().catch(() => {});
      continue;
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      throw new MercadoPagoError('invalid-response', res.status);
    }
    if (!res.ok) {
      const code =
        json && typeof json === 'object' && 'errors' in json && Array.isArray(json.errors)
          ? String((json.errors[0] as { code?: unknown } | undefined)?.code ?? '').slice(0, 60)
          : null;
      throw new MercadoPagoError('rejected', res.status, code || null);
    }
    return json;
  }
  throw lastError ?? new MercadoPagoError('unavailable', null);
}

function parseOrder(json: unknown): MpOrder {
  const parsed = mpOrderSchema.safeParse(json);
  if (!parsed.success) {
    logger.error(
      { issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) },
      'mercadopago order did not validate',
    );
    throw new MercadoPagoError('invalid-response', null);
  }
  return parsed.data;
}

// ── operations ──────────────────────────────────────────────────────────────────────────────

/** Sandbox requests must use MP's test payer address (Orders API docs). */
const TEST_PAYER_EMAIL = 'test@testuser.com';

export type CreatedPix = {
  order: MpOrder;
  payment: MpPayment;
  qrCode: string;
  qrCodeBase64: string;
  ticketUrl: string | null;
};

export async function createPixOrder(input: {
  orderId: string;
  amountCents: number;
  payerEmail: string;
  expiresInMinutes: number;
  idempotencyKey: string;
}): Promise<CreatedPix> {
  const { env } = config();
  const amount = centsToDecimal(input.amountCents);
  const live = env.NODE_ENV === 'production' && !isLocalOrigin(env);
  const json = await call('POST', '/v1/orders', {
    idempotencyKey: input.idempotencyKey,
    body: {
      type: 'online',
      processing_mode: 'automatic',
      external_reference: input.orderId,
      total_amount: amount,
      payer: { email: live ? input.payerEmail : TEST_PAYER_EMAIL },
      transactions: {
        payments: [
          {
            amount,
            payment_method: { id: 'pix', type: 'bank_transfer' },
            expiration_time: `PT${input.expiresInMinutes}M`,
          },
        ],
      },
    },
  });
  const order = parseOrder(json);
  const payment = pixPaymentOf(order);
  const pm = payment?.payment_method;
  if (!payment || !pm?.qr_code || !pm.qr_code_base64) {
    throw new MercadoPagoError('invalid-response', null, 'no-qr');
  }
  return {
    order,
    payment,
    qrCode: pm.qr_code,
    qrCodeBase64: pm.qr_code_base64,
    ticketUrl: pm.ticket_url ?? null,
  };
}

export async function getMpOrder(mpOrderId: string): Promise<MpOrder> {
  if (!/^[\w-]{1,64}$/.test(mpOrderId)) throw new MercadoPagoError('rejected', 400, 'id');
  return parseOrder(await call('GET', `/v1/orders/${encodeURIComponent(mpOrderId)}`));
}

export async function cancelMpOrder(mpOrderId: string, idempotencyKey: string): Promise<MpOrder> {
  return parseOrder(
    await call('POST', `/v1/orders/${encodeURIComponent(mpOrderId)}/cancel`, { idempotencyKey }),
  );
}

/** Total refund of the order's Pix payment (exception tool only — 04 §8). */
export async function refundMpOrder(
  mpOrderId: string,
  mpPaymentId: string,
  idempotencyKey: string,
): Promise<MpOrder> {
  return parseOrder(
    await call('POST', `/v1/orders/${encodeURIComponent(mpOrderId)}/refund`, {
      idempotencyKey,
      body: { transactions: [{ id: mpPaymentId }] },
    }),
  );
}
