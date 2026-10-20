/**
 * Operator script (13 D3): create a voucher until the price/voucher screens arrive (Phase 4).
 *
 *   npm run voucher:create -- --fixed 500 --max 1                    (R$ 5,00 off, once — go-live test)
 *   npm run voucher:create -- --percent 1000 --max 50 --days 7       (10 % off, 50 uses, 7 days)
 *   options: --code CODE (8–32 of A-Z 0-9 -; default: random), --per-user N (default 1),
 *            --min-subtotal CENTS, --max-discount CENTS (percent only)
 *
 * Vouchers apply to movie sponsorships only (11 §2.1). The creation is audited (without the code).
 * Reads .env.local / .env like the app.
 */
import { existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { parseArgs } from 'node:util';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}
(process.env as Record<string, string | undefined>).NODE_ENV ??= 'development';

const { values } = parseArgs({
  options: {
    code: { type: 'string' },
    fixed: { type: 'string' },
    percent: { type: 'string' },
    max: { type: 'string' },
    'per-user': { type: 'string' },
    days: { type: 'string' },
    'min-subtotal': { type: 'string' },
    'max-discount': { type: 'string' },
  },
  strict: true,
});

function int(name: string, v: string | undefined, min: number, max: number): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.error(`--${name}: whole number between ${min} and ${max}`);
    process.exit(2);
  }
  return n;
}

const fixed = int('fixed', values.fixed, 1, 200_000);
const percent = int('percent', values.percent, 1, 10_000);
if ((fixed === null) === (percent === null)) {
  console.error('use exactly one of --fixed CENTS or --percent BPS (1000 = 10 %)');
  process.exit(2);
}
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const code = (
  values.code ?? `WISKI-${Array.from({ length: 8 }, () => ALPHABET[randomInt(32)]).join('')}`
).toUpperCase();
if (!/^[A-Z0-9-]{8,32}$/.test(code)) {
  console.error('--code: 8–32 characters from A-Z, 0-9 and -');
  process.exit(2);
}
const days = int('days', values.days, 1, 365);
const endsAt = days ? new Date(Date.now() + days * 86_400_000) : null;

const { db, disconnectDb } = await import('../src/server/db');
const { audit } = await import('../src/server/audit/audit');

try {
  const v = await db().$transaction(async (tx) => {
    const created = await tx.voucher.create({
      data: {
        code,
        kind: fixed !== null ? 'FIXED' : 'PERCENT',
        amountCents: fixed,
        percentBps: percent,
        maxDiscountCents: int('max-discount', values['max-discount'], 1, 200_000),
        minSubtotalCents: int('min-subtotal', values['min-subtotal'], 1, 200_000),
        maxRedemptions: int('max', values.max, 1, 1_000_000),
        maxPerUser: int('per-user', values['per-user'], 1, 100) ?? 1,
        endsAt,
      },
    });
    await audit(
      {
        action: 'voucher.create',
        actor: null,
        targetType: 'Voucher',
        targetId: created.id,
        metadata: {
          kind: created.kind,
          percentBps: created.percentBps,
          amountCents: created.amountCents,
          maxRedemptions: created.maxRedemptions,
          endsAt: created.endsAt?.toISOString() ?? null,
        },
      },
      tx,
    );
    return created;
  });
  console.log(
    `voucher ${v.code}: ${v.kind === 'FIXED' ? `R$ ${(v.amountCents! / 100).toFixed(2)}` : `${v.percentBps! / 100} %`} off` +
      `${v.maxRedemptions ? `, ${v.maxRedemptions} use(s)` : ', unlimited'}` +
      `${v.endsAt ? `, until ${v.endsAt.toISOString()}` : ''}`,
  );
} catch (err) {
  console.error('voucher:create failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
