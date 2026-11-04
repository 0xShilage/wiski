/**
 * Phase 4 reviewed SQL (prisma/migrations/*_phase4_constraints): every CHECK and the one-live-
 * session index, hit directly through the app role.
 */
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { pgErrorCode, PG } from '@/server/db-errors';
import { clearCatalog } from '../support/catalog';
import { makeUser } from '../support/db';
import { fundedCampaign, makeSession, paidMovie, resetSlots } from '../support/live';

async function rejects(p: Promise<unknown>, sqlstate: string = PG.checkViolation) {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err, 'expected the database to refuse').not.toBeNull();
  const code = pgErrorCode(err) ?? (err as { code?: string }).code;
  if (sqlstate === PG.uniqueViolation) expect(['23505', 'P2002']).toContain(code);
  else expect(code).toBe(sqlstate);
}

beforeEach(async () => {
  await clearCatalog();
  await db().streamSession.deleteMany({});
  resetSlots();
});

describe('StreamSession', () => {
  it('capacity 15–1440, note ≤ 140, lifecycle timestamps, now-playing only while live', async () => {
    const s = await makeSession();
    const u = (data: object) => db().streamSession.update({ where: { id: s.id }, data });
    await rejects(u({ capacityMinutes: 10 }));
    await rejects(u({ capacityMinutes: 2000 }));
    await rejects(u({ publicNote: 'x'.repeat(141) }));
    await rejects(u({ status: 'LIVE' })); // no startedAt
    await rejects(u({ status: 'DONE', startedAt: new Date() })); // no endsAt
    await rejects(u({ status: 'CANCELLED' })); // no cancelledAt
    await rejects(u({ bookedMinutes: 301 })); // ss_capacity (Phase 1)
    const { item } = await paidMovie();
    await rejects(u({ nowItemId: item.id }));
    await u({ status: 'LIVE', startedAt: new Date(), nowItemId: item.id });
  });

  it('at most one LIVE session', async () => {
    await makeSession({ status: 'LIVE' });
    await rejects(makeSession({ status: 'LIVE' }), PG.uniqueViolation);
  });
});

describe('what is on the schedule', () => {
  it('a movie order carries a session only while scheduled / watching / completed', async () => {
    const s = await makeSession();
    const { order } = await paidMovie();
    const u = (data: object) => db().order.update({ where: { id: order.id }, data });
    await rejects(u({ sessionId: s.id })); // PAID with a session
    await rejects(u({ status: 'SCHEDULED' })); // scheduled without a session
    await rejects(u({ status: 'SCHEDULED', sessionId: s.id })); // without scheduledAt
    await u({ status: 'SCHEDULED', sessionId: s.id, scheduledAt: new Date() });
    await rejects(u({ status: 'COMPLETED' })); // no completedAt
    await rejects(u({ rescheduleCount: 3 }));
  });

  it('a campaign carries a session only when scheduled or watched', async () => {
    const s = await makeSession();
    const { campaign } = await fundedCampaign();
    const u = (data: object) => db().campaign.update({ where: { id: campaign.id }, data });
    await rejects(u({ sessionId: s.id }));
    await rejects(u({ status: 'SCHEDULED' }));
    await u({ status: 'SCHEDULED', sessionId: s.id, scheduledAt: new Date() });
  });
});

describe('overlays, goals, stats, contact, accounts', () => {
  it('overlay keys: label, prefix, known widgets, 32-byte hash', async () => {
    const base = {
      label: 'OBS',
      keyPrefix: 'abcdef',
      widgets: ['agora'],
      keyHash: randomBytes(32),
    };
    await rejects(db().overlayKey.create({ data: { ...base, widgets: ['chat'] } }));
    await rejects(db().overlayKey.create({ data: { ...base, widgets: [] } }));
    await rejects(db().overlayKey.create({ data: { ...base, label: '' } }));
    await rejects(db().overlayKey.create({ data: { ...base, keyPrefix: 'ab' } }));
    await rejects(db().overlayKey.create({ data: { ...base, keyHash: randomBytes(16) } }));
    await rejects(
      db().overlayKey.create({
        // 2026-11-03: at most 6 (the subathon widget made it six)
        data: {
          ...base,
          widgets: ['agora', 'fila', 'meta', 'meta-total', 'patrocinio', 'subathon', 'agora'],
        },
      }),
    );
    await db().overlayKey.create({ data: base });
    // 2026-11-01: "Meta total", five widgets on one key
    await db().overlayKey.create({
      data: {
        ...base,
        keyPrefix: 'ghijkl',
        keyHash: randomBytes(32),
        widgets: ['agora', 'fila', 'meta', 'meta-total', 'patrocinio'],
      },
    });
    // 2026-11-03: the subathon timer, six widgets on one key
    await db().overlayKey.create({
      data: {
        ...base,
        keyPrefix: 'mnopqr',
        keyHash: randomBytes(32),
        widgets: ['agora', 'fila', 'meta', 'meta-total', 'patrocinio', 'subathon'],
      },
    });
  });

  it('goals: title, target > 0, end after start', async () => {
    const g = {
      title: 'Meta',
      metric: 'SPONSORSHIP_COUNT' as const,
      target: 10,
      startsAt: new Date(),
    };
    await rejects(db().goal.create({ data: { ...g, target: 0 } }));
    await rejects(db().goal.create({ data: { ...g, title: '' } }));
    await rejects(db().goal.create({ data: { ...g, endsAt: new Date(Date.now() - 1000) } }));
  });

  it('stats: metric name, non-negative values', async () => {
    const s = {
      platform: 'TWITCH' as const,
      value: 1n,
      source: 'MANUAL' as const,
      fetchedAt: new Date(),
    };
    await rejects(db().platformStat.create({ data: { ...s, metric: 'Seguidores!' } }));
    await rejects(db().platformStat.create({ data: { ...s, metric: 'followers_x', value: -1n } }));
  });

  it('contact messages: lengths, lower-case e-mail, purge after creation', async () => {
    const m = {
      name: 'A',
      email: 'a@b.example',
      subject: 'S',
      body: 'B',
      purgeAfter: new Date(Date.now() + 86_400_000),
    };
    await rejects(db().contactMessage.create({ data: { ...m, email: 'A@B.example' } }));
    await rejects(db().contactMessage.create({ data: { ...m, body: 'x'.repeat(4001) } }));
    await rejects(db().contactMessage.create({ data: { ...m, purgeAfter: new Date(0) } }));
  });

  it('accounts: DELETED needs deletedAt; ACTIVE has no suspension date', async () => {
    const u = await makeUser();
    await rejects(db().user.update({ where: { id: u.id }, data: { status: 'DELETED' } }));
    await rejects(db().user.update({ where: { id: u.id }, data: { suspendedUntil: new Date() } }));
  });
});
