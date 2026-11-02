/**
 * DEVELOPMENT ONLY — simulate "Pix approved" for an order, to see the paid flow locally.
 * Mercado Pago's test credentials create Pix charges that no bank app can pay (09 §D), so the
 * approval path can't be exercised by hand otherwise.
 *
 *   npm run dev:pay -- WF-7K3Q9X
 *
 * It does exactly what the worker does after a real approval (the same sync code, the same
 * checks), with a synthetic Mercado Pago payment built from our own row. Refuses
 * NODE_ENV=production (and a synthetic payment says live_mode=false, which production rejects).
 */
import { existsSync } from 'node:fs';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'development';
if (process.env.NODE_ENV === 'production') {
  console.error('dev-pay: refusing to run with NODE_ENV=production');
  process.exit(1);
}

const code = process.argv[2] ?? '';
if (!/^WF-[0-9A-HJKMNP-TV-Z]{6}$/.test(code)) {
  console.error('usage: npm run dev:pay -- WF-XXXXXX');
  process.exit(1);
}

const { db, disconnectDb } = await import('../src/server/db');
const { getEnv } = await import('../src/server/env');
const { applyPayment } = await import('../src/server/payments/sync');
const { disconnectRedis } = await import('../src/server/redis');

try {
  const env = getEnv();
  if (env.MP_ALLOW_LIVE_IN_DEV) {
    console.error(
      'dev-pay: MP_ALLOW_LIVE_IN_DEV is on — payments are real now. Pay the Pix from your bank app;' +
        ' the worker confirms it within ~2 minutes.',
    );
    process.exit(1);
  }
  const order = await db().order.findUnique({
    where: { publicCode: code },
    include: { payment: true },
  });
  if (!order) {
    console.error(
      `dev-pay: no order ${code} in this database (${new URL(env.DATABASE_URL).pathname.slice(1)}).` +
        ' Copy the code from the order page of the site you are running.',
    );
    process.exit(1);
  }
  if (!order.payment?.providerPaymentId) {
    console.error(
      `dev-pay: ${code} exists (status ${order.status}) but Mercado Pago never created its Pix,` +
        ' so there is nothing to approve. The checkout said "Não foi possível gerar o Pix agora".' +
        ' Look for "mercadopago error" / "pix creation failed" in the npm run dev terminal: the' +
        ' code and message there say why (credentials, collector id, Pix key, payer e-mail).',
    );
    process.exit(1);
  }
  if (order.status !== 'PENDING_PAYMENT') {
    console.error(`dev-pay: ${code} is ${order.status}, not waiting for payment`);
    process.exit(1);
  }
  const now = new Date().toISOString();
  const outcome = await applyPayment(
    { ...order.payment, order },
    {
      id: Number(order.payment.providerPaymentId),
      status: 'approved',
      status_detail: 'accredited',
      transaction_amount: order.payment.amountCents / 100,
      currency_id: 'BRL',
      payment_method_id: 'pix',
      external_reference: order.id,
      collector_id: Number(env.MP_COLLECTOR_ID),
      live_mode: false,
      date_created: order.payment.createdAt.toISOString(),
      date_approved: now,
      date_last_updated: now,
      date_of_expiration: order.payment.expiresAt.toISOString(),
    },
  );
  const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
  console.log(`dev-pay: ${code} → ${after.status} (${outcome})`);
} finally {
  await disconnectDb();
  await disconnectRedis();
}
