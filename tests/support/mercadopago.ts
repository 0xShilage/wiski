/**
 * In-memory fake of the parts of the Mercado Pago Payments API the site uses (POST /v1/payments,
 * GET /v1/payments/:id, PUT /v1/payments/:id) plus Cloudflare's Turnstile siteverify, installed as
 * a `fetch` stub. Tests drive payment state with approve()/set() and can inject failures.
 * Responses follow the documented field names; values are obviously fake.
 */
import { vi } from 'vitest';
import { db } from '@/server/db';
import { resetEnvCache } from '@/server/env';
import { resetRuleSetCache } from '@/server/pricing/ruleset';

export const TEST_COLLECTOR = '3733347216';
// Built at runtime so no credential-shaped literal sits in the repository (gitleaks, MP hook).
export const TEST_TOKEN = ['TEST', '0'.repeat(16), 'fake', 'fakefakefakefake', TEST_COLLECTOR].join(
  '-',
);
export const FAKE_SIGNING_KEY = ['fake', 'signing', 'key', 'for', 'tests', '0123456789'].join('-');

export const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
export const PIX_CODE = `00020126580014br.gov.bcb.pix0136${'f'.repeat(36)}5204000053039865802BR6304ABCD`;

export type FakePayment = {
  id: number;
  status: string;
  status_detail: string;
  transaction_amount: number;
  currency_id: string;
  payment_method_id: string;
  external_reference: string;
  collector_id: number;
  live_mode: boolean;
  date_created: string;
  date_approved: string | null;
  date_last_updated: string;
  date_of_expiration: string;
  point_of_interaction: { transaction_data: { qr_code: string; qr_code_base64: string } };
};

type Fail = { status?: number; timeout?: boolean; times: number };

export class FakeMp {
  payments = new Map<number, FakePayment>();
  calls: { method: string; path: string; body?: unknown; headers: Record<string, string> }[] = [];
  private nextId = 1_000_000_000 + Math.floor(Math.random() * 1_000_000);
  private byIdempotency = new Map<string, number>();
  failCreate: Fail | null = null;
  failGet: Fail | null = null;
  failCancel: Fail | null = null;
  failRefund: Fail | null = null;
  refunds: { id: number; paymentId: number; key: string }[] = [];
  /** mutate the next created payment (e.g. wrong amount) */
  tamperCreate: ((p: FakePayment) => void) | null = null;
  turnstile = true;

  private fail(f: Fail | null): Response | 'timeout' | null {
    if (!f || f.times <= 0) return null;
    f.times--;
    if (f.timeout) return 'timeout';
    return Response.json({ message: 'fake failure' }, { status: f.status ?? 500 });
  }

  handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname === 'challenges.cloudflare.com') {
      return Response.json({ success: this.turnstile });
    }
    if (url.hostname !== 'api.mercadopago.com') {
      return Response.json(
        { message: `unexpected outbound call ${url.hostname}` },
        { status: 599 },
      );
    }
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path: url.pathname, body, headers });
    if (headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      return Response.json({ message: 'unauthorized' }, { status: 401 });
    }
    const timeout = (): never => {
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      throw e;
    };
    if (method === 'POST' && url.pathname === '/v1/payments') {
      const f = this.fail(this.failCreate);
      if (f === 'timeout') return timeout();
      if (f) return f;
      const key = headers['x-idempotency-key'] ?? '';
      const existing = this.byIdempotency.get(key);
      if (existing) return Response.json(this.payments.get(existing));
      const now = new Date().toISOString();
      const p: FakePayment = {
        id: this.nextId++,
        status: 'pending',
        status_detail: 'pending_waiting_transfer',
        transaction_amount: body.transaction_amount,
        currency_id: 'BRL',
        payment_method_id: body.payment_method_id,
        external_reference: body.external_reference,
        collector_id: Number(TEST_COLLECTOR),
        live_mode: false,
        date_created: now,
        date_approved: null,
        date_last_updated: now,
        date_of_expiration: body.date_of_expiration,
        point_of_interaction: { transaction_data: { qr_code: PIX_CODE, qr_code_base64: PNG_1PX } },
      };
      this.tamperCreate?.(p);
      this.tamperCreate = null;
      this.payments.set(p.id, p);
      this.byIdempotency.set(key, p.id);
      return Response.json(p, { status: 201 });
    }
    const r = /^\/v1\/payments\/(\d+)\/refunds$/.exec(url.pathname);
    if (r && method === 'POST') {
      const f = this.fail(this.failRefund);
      if (f === 'timeout') return timeout();
      if (f) return f;
      const p = this.payments.get(Number(r[1]));
      if (!p) return Response.json({ message: 'not found' }, { status: 404 });
      const key = headers['x-idempotency-key'] ?? '';
      const prior = this.refunds.find((x) => x.key === key && x.paymentId === p.id);
      if (!prior && p.status !== 'approved') {
        return Response.json({ message: 'cannot refund' }, { status: 400 });
      }
      const refund = prior ?? { id: this.nextId++, paymentId: p.id, key };
      if (!prior) {
        this.refunds.push(refund);
        this.set(p.id, { status: 'refunded', status_detail: 'refunded' });
      }
      return Response.json(
        { id: refund.id, payment_id: p.id, amount: p.transaction_amount, status: 'approved' },
        { status: 201 },
      );
    }
    const m = /^\/v1\/payments\/(\d+)$/.exec(url.pathname);
    if (m) {
      const p = this.payments.get(Number(m[1]));
      if (method === 'GET') {
        const f = this.fail(this.failGet);
        if (f === 'timeout') return timeout();
        if (f) return f;
        return p ? Response.json(p) : Response.json({ message: 'not found' }, { status: 404 });
      }
      if (method === 'PUT') {
        const f = this.fail(this.failCancel);
        if (f === 'timeout') return timeout();
        if (f) return f;
        if (!p) return Response.json({ message: 'not found' }, { status: 404 });
        if (body?.status === 'cancelled') {
          if (p.status !== 'pending') {
            return Response.json({ message: 'cannot cancel' }, { status: 400 });
          }
          p.status = 'cancelled';
          p.status_detail = 'by_collector';
          p.date_last_updated = new Date().toISOString();
        }
        return Response.json(p);
      }
    }
    return Response.json({ message: 'not found' }, { status: 404 });
  };

  /** The fake payment created for an order (by external_reference). */
  forOrder(orderId: string): FakePayment {
    const p = [...this.payments.values()].find((x) => x.external_reference === orderId);
    if (!p) throw new Error(`no fake payment for order ${orderId}`);
    return p;
  }

  set(id: number, patch: Partial<FakePayment>, at = new Date()): FakePayment {
    const p = this.payments.get(id);
    if (!p) throw new Error(`no fake payment ${id}`);
    Object.assign(p, { date_last_updated: at.toISOString() }, patch);
    return p;
  }

  approve(id: number, at = new Date()): FakePayment {
    return this.set(
      id,
      { status: 'approved', status_detail: 'accredited', date_approved: at.toISOString() },
      at,
    );
  }
}

/**
 * Install the fake for the current test (vitest unstubs globals and env before each test, so
 * call this in beforeEach), with Mercado Pago credentials in the environment.
 */
export function installFakeMp(fake = new FakeMp()): FakeMp {
  vi.stubEnv('MP_ACCESS_TOKEN', TEST_TOKEN);
  vi.stubEnv('MP_COLLECTOR_ID', TEST_COLLECTOR);
  vi.stubEnv('MP_WEBHOOK_SECRET', FAKE_SIGNING_KEY);
  resetEnvCache();
  resetRuleSetCache();
  vi.stubGlobal('fetch', fake.handle);
  return fake;
}

/** Current legal texts (provisional test versions) so checkout is open. */
export async function ensureLegal(): Promise<{ terms: string; privacy: string; refund: string }> {
  for (const type of ['TERMS', 'PRIVACY', 'REFUND'] as const) {
    const cur = await db().legalDocument.findFirst({ where: { type, isCurrent: true } });
    if (!cur) {
      await db().legalDocument.create({
        data: {
          type,
          version: 'teste-1',
          sha256: new Uint8Array(32),
          publishedAt: new Date(),
          isCurrent: true,
        },
      });
    }
  }
  const docs = await db().legalDocument.findMany({ where: { isCurrent: true } });
  const v = (t: string) => docs.find((d) => d.type === t)!.version;
  return { terms: v('TERMS'), privacy: v('PRIVACY'), refund: v('REFUND') };
}
