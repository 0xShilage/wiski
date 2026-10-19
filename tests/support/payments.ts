/**
 * Phase 2 integration harness: the mock externals (Mercado Pago, Turnstile, Resend) on a local
 * port, the env pointing at them, and helpers to check out and to deliver signed notifications.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { clearDevOutbox } from '@/server/email/transport';
import { resetEnvCache } from '@/server/env';
import { setMercadoPagoFetch } from '@/server/payments/mercadopago';
import { resetRuleSetCache } from '@/server/pricing/rulesets';
import { resetLegalCache } from '@/server/legal/legal';
import { LEGAL_TEXTS } from '@/content/legal/documents';
import { redis } from '@/server/redis';
import { fakeMpToken } from './fake-payment-env';
import { MockExternals } from './mock-externals';

export const COLLECTOR = '3733347216';
export const APPLICATION = '5754049850745190';
export const WEBHOOK_SECRET = ['integration', 'webhook', 'signing', 'key', 'fake'].join('-');

export const LEGAL = {
  terms: LEGAL_TEXTS.TERMS.version,
  privacy: LEGAL_TEXTS.PRIVACY.version,
  refund: LEGAL_TEXTS.REFUND.version,
};

/** Install the mock + env for this test file. Returns the live mock (reset before each test). */
export function installPaymentsMock(opts: { resend?: boolean } = {}): MockExternals {
  const mock = new MockExternals({
    token: fakeMpToken(COLLECTOR),
    collectorId: COLLECTOR,
    applicationId: APPLICATION,
  });
  const saved: Record<string, string | undefined> = {};
  beforeAll(async () => {
    const url = await mock.start();
    const env: Record<string, string> = {
      ['MP_' + 'ACCESS_TOKEN']: fakeMpToken(COLLECTOR),
      MP_COLLECTOR_ID: COLLECTOR,
      MP_APPLICATION_ID: APPLICATION,
      ['MP_' + 'WEBHOOK_SECRET']: WEBHOOK_SECRET,
      MP_API_BASE: url,
      TURNSTILE_VERIFY_URL: `${url}/turnstile/v0/siteverify`,
      // a real (non-test) Turnstile secret, so hostname/action are checked against the mock
      TURNSTILE_SECRET_KEY: '0x4AAAAAAAintegration-secret',
      TURNSTILE_SITE_KEY: '0x4AAAAAAAintegration-site',
      RESEND_API_BASE: url,
      PIX_RECIPIENT_NAME: 'Nome Fictício',
      ...(opts.resend
        ? { ['RESEND_' + 'API_KEY']: ['re', 'integration', 'notreal0123'].join('_') }
        : {}),
    };
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    resetEnvCache();
    setMercadoPagoFetch(null);
  });
  beforeEach(async () => {
    mock.reset();
    clearDevOutbox();
    resetRuleSetCache();
    resetLegalCache();
    // fresh limiter / idempotency / replay state per test
    await redis().flushdb();
  });
  afterAll(async () => {
    await mock.stop();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnvCache();
  });
  return mock;
}

export const TURNSTILE_OK = 'e2e-ok:checkout';

/** Headers a browser checkout sends (Turnstile token + Idempotency-Key). */
export function checkoutHeaders(key: string = randomUUID()): Record<string, string> {
  return { 'x-turnstile-token': TURNSTILE_OK, 'idempotency-key': key };
}

/** A notification exactly as Mercado Pago signs it (05 §6). */
export function signedWebhook(
  mpOrderId: string,
  opts: { secret?: string; requestId?: string; ts?: number; lowercaseId?: boolean } = {},
) {
  const requestId = opts.requestId ?? randomUUID();
  const ts = String(opts.ts ?? Date.now());
  const id = opts.lowercaseId === false ? mpOrderId : mpOrderId.toLowerCase();
  const v1 = createHmac('sha256', opts.secret ?? WEBHOOK_SECRET)
    .update(`id:${id};request-id:${requestId};ts:${ts};`)
    .digest('hex');
  return {
    url: `/api/webhooks/mercadopago?data.id=${mpOrderId}&type=order`,
    headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    body: { action: 'order.processed', type: 'order', data: { id: mpOrderId } },
    requestId,
  };
}
