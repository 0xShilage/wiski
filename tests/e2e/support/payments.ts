/**
 * Phase 2 browser-test helpers: a stand-in for Cloudflare's Turnstile script (served by
 * page.route — the widget calls back with a token the mock siteverify accepts), the mock
 * Mercado Pago control API, and signed notifications sent through nginx like Mercado Pago would.
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import pg from 'pg';
import { stack } from './seed';

/** Replaces https://challenges.cloudflare.com/turnstile/v0/api.js in the browser. */
const FAKE_TURNSTILE = `(() => {
  const widgets = new Map();
  let n = 0;
  const issue = (id) => {
    const w = widgets.get(id);
    if (w) setTimeout(() => w.o.callback('e2e-ok:' + w.o.action), 50);
  };
  window.turnstile = {
    render(el, o) {
      const id = 'w' + ++n;
      const box = document.createElement('p');
      box.className = 'wf-hint';
      box.textContent = 'Verificação de segurança (simulada no teste)';
      el.appendChild(box);
      widgets.set(id, { o, box });
      issue(id);
      return id;
    },
    reset(id) { issue(id); },
    remove(id) { const w = widgets.get(id); if (w) { w.box.remove(); widgets.delete(id); } },
  };
})();`;

export async function fakeTurnstile(context: BrowserContext): Promise<void> {
  await context.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_TURNSTILE }),
  );
}

export type Violation = { directive: string; blocked: string; disposition: string };

/** Collect CSP violations on every document the page loads (survives navigations). */
export async function watchCsp(page: Page): Promise<Violation[]> {
  const seen: Violation[] = [];
  await page.exposeBinding('__wfCsp', (_src, v: Violation) => {
    seen.push(v);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __wfCsp: (v: unknown) => void }).__wfCsp({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        disposition: e.disposition,
      }),
    );
  });
  return seen;
}

async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: stack().adminDatabaseUrl });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const mockUrl = () => (stack() as unknown as { mockUrl: string }).mockUrl;

/** Mercado Pago's id for one of our orders (by public code). */
export async function mpOrderIdFor(publicCode: string): Promise<string> {
  const orderId = await withDb(async (c) => {
    const r = await c.query<{ id: string }>('SELECT id FROM "Order" WHERE "publicCode" = $1', [
      publicCode,
    ]);
    return r.rows[0]!.id;
  });
  const res = await fetch(`${mockUrl()}/__mock/orders/by-ref/${orderId}`);
  const o = (await res.json()) as { id: string };
  return o.id;
}

export async function mockAction(mpOrderId: string, action: 'approve' | 'expire'): Promise<void> {
  const res = await fetch(`${mockUrl()}/__mock/orders/${mpOrderId}/${action}`, { method: 'POST' });
  if (!res.ok) throw new Error(`mock ${action} failed: ${res.status}`);
}

export async function sentEmails(): Promise<{ subject: string; to: string[] }[]> {
  return (await (await fetch(`${mockUrl()}/__mock/emails`)).json()) as {
    subject: string;
    to: string[];
  }[];
}

/** POST a correctly signed `order` notification through nginx (05 §6 manifest). */
export async function notify(request: APIRequestContext, mpOrderId: string): Promise<number> {
  const secret = stack().appEnv['MP_' + 'WEBHOOK_SECRET']!;
  const ts = String(Date.now());
  const requestId = randomUUID();
  const v1 = createHmac('sha256', secret)
    .update(`id:${mpOrderId.toLowerCase()};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  const res = await request.post(
    `/api/webhooks/mercadopago?data.id=${encodeURIComponent(mpOrderId)}&type=order`,
    {
      headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      data: { action: 'order.processed', type: 'order', data: { id: mpOrderId } },
    },
  );
  return res.status();
}

export async function approveAndNotify(request: APIRequestContext, publicCode: string) {
  const mp = await mpOrderIdFor(publicCode);
  await mockAction(mp, 'approve');
  return notify(request, mp);
}
