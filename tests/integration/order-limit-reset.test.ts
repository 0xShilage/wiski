/**
 * "Liberar pedidos" (2026-11-04): the streamer clears the checkout counters of one account. The
 * hourly caps and the coupon cool-down go back to zero; the unpaid-order caps are only reported,
 * never undone; everything is audited without the person's e-mail.
 */
import { describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { hit as consume } from '@/server/ratelimit/sliding-window';
import { redis } from '@/server/redis';
import { POST as unthrottleRoute } from '@/app/api/v1/admin/users/[id]/unthrottle/route';
import { makeUser } from '../support/db';
import { as, hit } from '../support/live';

const HOUR = 3_600_000;
/** RL.orderCreate.perUser */
const PER_USER = 5;

async function spend(key: string, limit: number) {
  for (let i = 0; i < limit; i++)
    expect((await consume(redis(), key, limit, HOUR)).allowed).toBe(true);
  expect((await consume(redis(), key, limit, HOUR)).allowed).toBe(false);
}

describe('clearing the order limits of one account', () => {
  it('zeroes the hourly counter and the coupon cool-down, and audits it', async () => {
    const streamer = await as('STREAMER');
    const fan = await makeUser();
    const userKey = `rl:order-create:u:${fan.id}`;
    const buyerKey = `rl:order-create:b:u:${fan.id}`;
    await spend(userKey, PER_USER);
    await spend(buyerKey, PER_USER);
    await redis().set(`vcool:u:${fan.id}`, '1', 'EX', 900);

    const r = await hit(unthrottleRoute, 'POST', '', { who: streamer, params: { id: fan.id } });
    expect(r.res.status).toBe(200);
    expect(r.json.reset).toMatchObject({ pendingOrders: 0, pendingOnIps: 0 });
    expect((r.json.reset as { cleared: number }).cleared).toBeGreaterThanOrEqual(3);

    // the next order is allowed again, and the cool-down is gone
    expect((await consume(redis(), userKey, PER_USER, HOUR)).allowed).toBe(true);
    expect((await consume(redis(), buyerKey, PER_USER, HOUR)).allowed).toBe(true);
    expect(await redis().exists(`vcool:u:${fan.id}`)).toBe(0);

    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'user.unthrottle', targetId: fan.id },
    });
    expect(log.metadata).toMatchObject({ ips: 0 });
    expect(JSON.stringify(log.metadata)).not.toContain(fan.email);
  });

  it('an account with nothing to clear answers 200 with cleared 0; an unknown account is 404', async () => {
    const streamer = await as('STREAMER');
    const fan = await makeUser();
    const ok = await hit(unthrottleRoute, 'POST', '', { who: streamer, params: { id: fan.id } });
    expect([ok.res.status, (ok.json.reset as { cleared: number }).cleared]).toEqual([200, 0]);
    const gone = await hit(unthrottleRoute, 'POST', '', {
      who: streamer,
      params: { id: '00000000-0000-7000-8000-000000000000' },
    });
    expect(gone.res.status).toBe(404);
  });
});
