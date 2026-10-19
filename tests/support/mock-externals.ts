/**
 * One local HTTP server standing in for the three external services Phase 2 talks to, built from
 * their documented request/response shapes (13 §0: none of them is reachable from the workspace):
 *
 *   • Mercado Pago Orders API — POST /v1/orders, GET /v1/orders/:id, POST …/cancel, …/refund
 *   • Cloudflare Turnstile siteverify — POST /turnstile/v0/siteverify
 *   • Resend — POST /emails
 *
 * plus a control API under /__mock/* (approve a Pix, fail the next calls, read sent e-mails) used
 * by the e2e stack, and the same controls as methods for in-process integration tests.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type MockOrder = {
  id: string;
  type: 'online';
  processing_mode: 'automatic';
  external_reference: string;
  total_amount: string;
  total_paid_amount: string | null;
  user_id: string;
  integration_data: { application_id: string };
  country_code: 'BRA';
  status: string;
  status_detail: string;
  created_date: string;
  last_updated_date: string;
  payer: { email: string };
  transactions: {
    payments: {
      id: string;
      amount: string;
      paid_amount: string | null;
      status: string;
      status_detail: string;
      date_of_expiration: string;
      payment_method: {
        id: 'pix';
        type: 'bank_transfer';
        qr_code: string;
        qr_code_base64: string;
        ticket_url: string;
      };
    }[];
    refunds?: { id: string; transaction_id: string; amount: string; status: string }[];
  };
};

export type MockRequest = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};

export type SentEmail = { from: string; to: string[]; subject: string; text: string; html: string };

/** A 1×1 PNG — enough for <img> rendering checks. */
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ALNUM = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const mpId = (prefix: string) =>
  prefix + [...randomBytes(26)].map((b) => ALNUM[b % ALNUM.length]).join('');

export type MockOptions = {
  port?: number;
  /** expected bearer token; requests with another token get 401 */
  token: string;
  collectorId: string;
  applicationId: string;
};

export class MockExternals {
  readonly orders = new Map<string, MockOrder>();
  readonly requests: MockRequest[] = [];
  readonly emails: SentEmail[] = [];
  private readonly idem = new Map<string, { bodyHash: string; orderId: string }>();
  private failures: { count: number; status: number; path: RegExp } | null = null;
  private server: Server | null = null;
  url = '';

  constructor(private readonly opts: MockOptions) {}

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((err: unknown) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: String(err) }));
      });
    });
    await new Promise<void>((r) => this.server!.listen(this.opts.port ?? 0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }

  async stop(): Promise<void> {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  reset(): void {
    this.orders.clear();
    this.requests.length = 0;
    this.emails.length = 0;
    this.idem.clear();
    this.failures = null;
  }

  /** The next `count` requests whose path matches get `status` (default: every MP call). */
  failNext(count: number, status = 503, path = /^\/v1\//): void {
    this.failures = { count, status, path };
  }

  orderFor(externalReference: string): MockOrder | undefined {
    return [...this.orders.values()].find((o) => o.external_reference === externalReference);
  }

  /** The payer paid the Pix. */
  approve(mpOrderId: string, at = new Date()): MockOrder {
    return this.mutate(
      mpOrderId,
      (o) => {
        o.status = 'processed';
        o.status_detail = 'accredited';
        o.total_paid_amount = o.total_amount;
        const p = o.transactions.payments[0]!;
        p.status = 'processed';
        p.status_detail = 'accredited';
        p.paid_amount = p.amount;
      },
      at,
    );
  }

  mutate(mpOrderId: string, fn: (o: MockOrder) => void, at = new Date()): MockOrder {
    const o = this.orders.get(mpOrderId);
    if (!o) throw new Error(`mock: no order ${mpOrderId}`);
    fn(o);
    o.last_updated_date = at.toISOString();
    return o;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://mock');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw; // form bodies (siteverify)
      }
    }
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')]),
    );
    const path = url.pathname;
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (path.startsWith('/__mock/')) return this.control(req.method ?? 'GET', path, body, send);
    this.requests.push({ method: req.method ?? 'GET', path, headers, body });

    if (this.failures && this.failures.count > 0 && this.failures.path.test(path)) {
      this.failures.count--;
      return send(this.failures.status, { message: 'mock failure' });
    }

    // ── Turnstile siteverify (token "e2e-ok:<action>" passes) ──
    if (path === '/turnstile/v0/siteverify' && req.method === 'POST') {
      const form = new URLSearchParams(typeof body === 'string' ? body : '');
      const token = form.get('response') ?? '';
      const ok = token.startsWith('e2e-ok:');
      return send(200, {
        success: ok,
        ...(ok
          ? {
              hostname: 'localhost',
              action: token.slice('e2e-ok:'.length),
              challenge_ts: new Date().toISOString(),
            }
          : { 'error-codes': ['invalid-input-response'] }),
      });
    }

    // ── Resend ──
    if (path === '/emails' && req.method === 'POST') {
      if (!/^Bearer re_/.test(headers.authorization ?? '')) return send(401, { message: 'auth' });
      const b = body as SentEmail & { to: string | string[] };
      this.emails.push({ ...b, to: Array.isArray(b.to) ? b.to : [b.to] });
      return send(200, { id: `em_${randomBytes(8).toString('hex')}` });
    }

    // ── Mercado Pago ──
    if (headers.authorization !== `Bearer ${this.opts.token}`) {
      return send(401, { errors: [{ code: 'unauthorized', message: 'invalid token' }] });
    }
    if (path === '/v1/orders' && req.method === 'POST')
      return this.createOrder(headers, body, raw, send);
    const m = /^\/v1\/orders\/([\w-]+)(\/cancel|\/refund)?$/.exec(path);
    if (!m) return send(404, { errors: [{ code: 'not_found' }] });
    const order = this.orders.get(m[1]!);
    if (!order) return send(404, { errors: [{ code: 'order_not_found' }] });
    if (!m[2] && req.method === 'GET') return send(200, order);
    if (req.method !== 'POST') return send(405, { errors: [{ code: 'method' }] });
    if (!headers['x-idempotency-key'])
      return send(400, { errors: [{ code: 'idempotency_key_required' }] });
    if (m[2] === '/cancel') {
      if (order.status === 'canceled') return send(200, order);
      if (order.status !== 'action_required') {
        return send(409, { errors: [{ code: 'order_cannot_be_canceled' }] });
      }
      this.mutate(order.id, (o) => {
        o.status = 'canceled';
        o.status_detail = 'canceled';
        o.transactions.payments[0]!.status = 'canceled';
        o.transactions.payments[0]!.status_detail = 'canceled';
      });
      return send(200, order);
    }
    // refund (total)
    if (order.status !== 'processed' || order.status_detail !== 'accredited') {
      if (order.status_detail === 'refunded') return send(200, order);
      return send(409, { errors: [{ code: 'order_cannot_be_refunded' }] });
    }
    const pay = order.transactions.payments[0]!;
    const tx = (body as { transactions?: { id?: string }[] } | null)?.transactions;
    if (!tx || tx.length !== 1 || tx[0]?.id !== pay.id) {
      return send(400, { errors: [{ code: 'invalid_transactions' }] });
    }
    this.mutate(order.id, (o) => {
      o.status_detail = 'refunded';
      o.transactions.refunds = [
        { id: mpId('REF'), transaction_id: pay.id, amount: pay.amount, status: 'processed' },
      ];
    });
    return send(201, order);
  }

  private createOrder(
    headers: Record<string, string>,
    body: unknown,
    raw: string,
    send: (s: number, p: unknown) => void,
  ) {
    const key = headers['x-idempotency-key'];
    if (!key || key.length > 128)
      return send(400, { errors: [{ code: 'idempotency_key_required' }] });
    const bodyHash = createHash('sha256').update(raw).digest('hex');
    const seen = this.idem.get(key);
    if (seen) {
      if (seen.bodyHash !== bodyHash) {
        return send(409, { errors: [{ code: 'idempotency_key_already_used' }] });
      }
      return send(201, this.orders.get(seen.orderId));
    }
    const b = body as {
      type?: string;
      processing_mode?: string;
      external_reference?: string;
      total_amount?: string;
      payer?: { email?: string };
      transactions?: {
        payments?: {
          amount?: string;
          payment_method?: { id?: string; type?: string };
          expiration_time?: string;
        }[];
      };
    } | null;
    const p = b?.transactions?.payments;
    const exp = /^PT(\d+)M$/.exec(p?.[0]?.expiration_time ?? '');
    const problems = [
      b?.type !== 'online' && 'type',
      b?.processing_mode !== 'automatic' && 'processing_mode',
      !b?.external_reference && 'external_reference',
      !/^\d+\.\d{2}$/.test(b?.total_amount ?? '') && 'total_amount',
      !b?.payer?.email && 'payer.email',
      (!p || p.length !== 1) && 'transactions.payments',
      p?.[0]?.amount !== b?.total_amount && 'amount',
      (p?.[0]?.payment_method?.id !== 'pix' || p?.[0]?.payment_method?.type !== 'bank_transfer') &&
        'payment_method',
      (!exp || Number(exp[1]) < 30 || Number(exp[1]) > 43_200) && 'expiration_time',
    ].filter(Boolean);
    if (problems.length) {
      return send(400, {
        errors: problems.map((x) => ({ code: 'invalid_parameter', details: x })),
      });
    }
    const now = new Date();
    const id = mpId('ORD');
    const order: MockOrder = {
      id,
      type: 'online',
      processing_mode: 'automatic',
      external_reference: b!.external_reference!,
      total_amount: b!.total_amount!,
      total_paid_amount: null,
      user_id: this.opts.collectorId,
      integration_data: { application_id: this.opts.applicationId },
      country_code: 'BRA',
      status: 'action_required',
      status_detail: 'waiting_transfer',
      created_date: now.toISOString(),
      last_updated_date: now.toISOString(),
      payer: { email: b!.payer!.email! },
      transactions: {
        payments: [
          {
            id: mpId('PAY'),
            amount: b!.total_amount!,
            paid_amount: null,
            status: 'action_required',
            status_detail: 'waiting_transfer',
            date_of_expiration: new Date(now.getTime() + Number(exp![1]) * 60_000).toISOString(),
            payment_method: {
              id: 'pix',
              type: 'bank_transfer',
              qr_code: `00020101021226990014br.gov.bcb.pix2577mock/${id}5204000053039865406${b!.total_amount}5802BR6304ABCD`,
              qr_code_base64: PNG_1PX,
              ticket_url: `https://www.mercadopago.com.br/sandbox/payments/${id}/ticket`,
            },
          },
        ],
      },
    };
    this.orders.set(id, order);
    this.idem.set(key, { bodyHash, orderId: id });
    return send(201, order);
  }

  private control(
    method: string,
    path: string,
    body: unknown,
    send: (s: number, p: unknown) => void,
  ) {
    if (path === '/__mock/reset' && method === 'POST') {
      this.reset();
      return send(200, { ok: true });
    }
    if (path === '/__mock/emails' && method === 'GET') return send(200, this.emails);
    if (path === '/__mock/requests' && method === 'GET') return send(200, this.requests);
    const byRef = /^\/__mock\/orders\/by-ref\/([\w-]+)$/.exec(path);
    if (byRef && method === 'GET') {
      const o = this.orderFor(byRef[1]!);
      return o ? send(200, o) : send(404, {});
    }
    const act = /^\/__mock\/orders\/([\w-]+)\/(approve|expire)$/.exec(path);
    if (act && method === 'POST') {
      if (!this.orders.has(act[1]!)) return send(404, {});
      if (act[2] === 'approve') return send(200, this.approve(act[1]!));
      return send(
        200,
        this.mutate(act[1]!, (o) => {
          o.status = 'canceled';
          o.status_detail = 'expired';
        }),
      );
    }
    if (path === '/__mock/fail' && method === 'POST') {
      const b = body as { count?: number; status?: number } | null;
      this.failNext(b?.count ?? 1, b?.status ?? 503);
      return send(200, { ok: true });
    }
    return send(404, {});
  }
}
