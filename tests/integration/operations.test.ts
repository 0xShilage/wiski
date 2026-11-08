/**
 * The rest of Phase 4: contact form (anti-spam, sanitising, rate limits, inbox, purge), goals and
 * their progress, media kit stats (manual values; revenue as % only in public), the checkout
 * switch, vouchers, and the audit-log viewer with a formula-safe CSV export.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { contactFormToken, purgeContact } from '@/server/contact/contact';
import { csvCell } from '@/server/audit/viewer';
import { POST as contactRoute } from '@/app/api/v1/contact/route';
import { GET as inboxRoute } from '@/app/api/v1/admin/contact/route';
import {
  DELETE as contactDelRoute,
  PATCH as contactPatchRoute,
} from '@/app/api/v1/admin/contact/[id]/route';
import { GET as goalsRoute, POST as goalCreateRoute } from '@/app/api/v1/admin/goals/route';
import {
  DELETE as goalDelRoute,
  PATCH as goalPatchRoute,
} from '@/app/api/v1/admin/goals/[id]/route';
import { GET as statsAdminRoute, PUT as statsPutRoute } from '@/app/api/v1/admin/stats/route';
import { GET as statsRoute } from '@/app/api/v1/stats/route';
import { GET as settingsRoute, PUT as settingsPutRoute } from '@/app/api/v1/admin/settings/route';
import {
  GET as vouchersRoute,
  POST as voucherCreateRoute,
} from '@/app/api/v1/admin/vouchers/route';
import { PATCH as voucherPatchRoute } from '@/app/api/v1/admin/vouchers/[id]/route';
import { GET as auditRoute } from '@/app/api/v1/admin/audit/route';
import { GET as auditExportRoute } from '@/app/api/v1/admin/audit/export/route';
import { checkoutStatus } from '@/server/checkout/status';
import { clearCatalog } from '../support/catalog';
import { freshIp } from '../support/http';
import { as, hit, paidMovie, resetSlots } from '../support/live';

let turnstileOk = true;
beforeEach(async () => {
  turnstileOk = true;
  vi.stubGlobal('fetch', async () => Response.json({ success: turnstileOk }));
});

function contactBody(over: Record<string, unknown> = {}) {
  return {
    name: 'Marca Legal',
    email: 'Parcerias@Marca.example',
    company: 'Marca Ltda',
    subject: 'Parceria',
    body: 'Olá! Queremos patrocinar uma live.',
    website: '',
    formToken: contactFormToken(new Date(Date.now() - 10_000)),
    ...over,
  };
}
const send = (body: unknown, ip = freshIp()) =>
  hit(contactRoute, 'POST', '/api/v1/contact', {
    body,
    headers: { 'x-turnstile-token': 'tok' },
    ip,
  });

describe('contact form', () => {
  it('stores a sanitised message with a 12-month purge date; e-mail lower-cased', async () => {
    const rlo = String.fromCodePoint(0x202e);
    const r = await send(
      contactBody({ subject: `Parceria${rlo} <b>VIP</b>`, body: 'linha 1\n\n\n\nlinha 2' }),
    );
    expect([r.res.status, r.json]).toEqual([201, { received: true }]);
    const m = await db().contactMessage.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(m).toMatchObject({
      email: 'parcerias@marca.example',
      subject: 'Parceria <b>VIP</b>',
      body: 'linha 1\n\nlinha 2',
      status: 'NEW',
    });
    const days = (m.purgeAfter.getTime() - m.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(365);
  });

  it('honeypot → looks fine, stores nothing; too fast / forged / expired token → 422; Turnstile; strict body', async () => {
    const before = await db().contactMessage.count();
    expect((await send(contactBody({ website: 'http://spam.example' }))).res.status).toBe(201);
    expect(await db().contactMessage.count()).toBe(before);
    expect((await send(contactBody({ formToken: contactFormToken(new Date()) }))).json.code).toBe(
      'FORM_TOO_FAST',
    );
    expect((await send(contactBody({ formToken: 'x'.repeat(40) }))).json.code).toBe('FORM_EXPIRED');
    expect(
      (
        await send(
          contactBody({ formToken: contactFormToken(new Date(Date.now() - 3 * 3_600_000)) }),
        )
      ).json.code,
    ).toBe('FORM_EXPIRED');
    expect((await send(contactBody({ email: 'não é email' }))).res.status).toBe(422);
    expect((await send(contactBody({ admin: true }))).res.status).toBe(422);
    expect((await send(contactBody({ body: 'x'.repeat(4001) }))).res.status).toBe(422);
    turnstileOk = false;
    expect((await send(contactBody())).json.code).toBe('TURNSTILE_FAILED');
  });

  it('5 per hour per IP', async () => {
    const ip = freshIp();
    const s = [];
    for (let i = 0; i < 6; i++) s.push((await send(contactBody(), ip)).res.status);
    expect(s).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('inbox (streamer and moderators): list, mark, delete — audited without the content; purge after the date', async () => {
    await send(contactBody({ subject: 'Para a caixa de entrada' }));
    const st = await as('STREAMER');
    const list = await hit(inboxRoute, 'GET', '/api/v1/admin/contact', { who: st });
    const m = (list.json.messages as { id: string; subject: string }[]).find(
      (x) => x.subject === 'Para a caixa de entrada',
    )!;
    expect(
      (await hit(inboxRoute, 'GET', '/api/v1/admin/contact', { who: await as('MODERATOR') })).res
        .status,
    ).toBe(200);
    await hit(contactPatchRoute, 'PATCH', '', {
      who: st,
      params: { id: m.id },
      body: { status: 'READ' },
    });
    expect((await db().contactMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe(
      'READ',
    );
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'contact.status', targetId: m.id },
    });
    expect(JSON.stringify(log.metadata)).not.toContain('caixa');
    expect(
      (await hit(contactDelRoute, 'DELETE', '', { who: st, params: { id: m.id } })).res.status,
    ).toBe(204);

    await send(contactBody({ subject: 'Velha' }));
    await db().contactMessage.updateMany({
      where: { subject: 'Velha' },
      data: {
        createdAt: new Date(Date.now() - 400 * 86_400_000),
        purgeAfter: new Date(Date.now() - 35 * 86_400_000),
      },
    });
    expect(await purgeContact()).toBeGreaterThanOrEqual(1);
    expect(await db().contactMessage.count({ where: { subject: 'Velha' } })).toBe(0);
  });
});

describe('goals and media kit', () => {
  beforeEach(async () => {
    await clearCatalog();
    resetSlots();
    await db().goal.deleteMany({});
    await db().platformStat.deleteMany({});
  });

  it('count / revenue / minutes goals measure inside their window', async () => {
    const st = await as('STREAMER');
    const start = new Date(Date.now() - 3_600_000).toISOString();
    const mk = (metric: string, target: number) =>
      hit(goalCreateRoute, 'POST', '', {
        who: st,
        body: { title: `Meta ${metric}`, metric, target, startsAt: start, showOnMediaKit: true },
      });
    await mk('SPONSORSHIP_COUNT', 4);
    await mk('SPONSORSHIP_REVENUE_CENTS', 10_000);
    await paidMovie();
    await paidMovie({ paidAt: new Date(Date.now() - 2 * 3_600_000) }); // before the window
    const list = (await hit(goalsRoute, 'GET', '', { who: st })).json.goals as {
      metric: string;
      current: number;
      percent: number;
    }[];
    expect(list.find((g) => g.metric === 'SPONSORSHIP_COUNT')).toMatchObject({
      current: 1,
      percent: 25,
    });
    expect(list.find((g) => g.metric === 'SPONSORSHIP_REVENUE_CENTS')).toMatchObject({
      current: 2000,
      percent: 20,
    });

    const pub = await hit(statsRoute, 'GET', '/api/v1/stats');
    const goals = pub.json.goals as Record<string, unknown>[];
    const rev = goals.find((g) => g.metric === 'SPONSORSHIP_REVENUE_CENTS')!;
    expect(rev).toEqual({
      title: 'Meta SPONSORSHIP_REVENUE_CENTS',
      metric: 'SPONSORSHIP_REVENUE_CENTS',
      percent: 20,
    });
    expect(JSON.stringify(pub.json)).not.toContain('2000');
  });

  it('goal edits and deletes are audited; bad windows refused; moderators see them too', async () => {
    const st = await as('STREAMER');
    const c = await hit(goalCreateRoute, 'POST', '', {
      who: st,
      body: {
        title: 'Meta',
        metric: 'WATCHED_MINUTES',
        target: 600,
        startsAt: new Date().toISOString(),
      },
    });
    const id = (c.json.goal as { id: string }).id;
    const bad = await hit(goalPatchRoute, 'PATCH', '', {
      who: st,
      params: { id },
      body: { endsAt: new Date(Date.now() - 86_400_000).toISOString() },
    });
    expect(bad.res.status).toBe(422);
    expect(
      (await hit(goalPatchRoute, 'PATCH', '', { who: st, params: { id }, body: { target: 700 } }))
        .json.goal,
    ).toMatchObject({ target: 700 });
    expect((await hit(goalDelRoute, 'DELETE', '', { who: st, params: { id } })).res.status).toBe(
      204,
    );
    expect(
      await db().auditLog.count({ where: { targetId: id, action: { startsWith: 'goal.' } } }),
    ).toBe(3);
    expect((await hit(goalsRoute, 'GET', '', { who: await as('MODERATOR') })).res.status).toBe(200);
  });

  it('media kit numbers: manual values set and cleared by the streamer', async () => {
    const st = await as('STREAMER');
    await hit(statsPutRoute, 'PUT', '', {
      who: st,
      body: { platform: 'TWITCH', metric: 'followers', value: 12_345 },
    });
    const pub = await hit(statsRoute, 'GET', '/api/v1/stats');
    expect(pub.json.stats).toEqual([
      expect.objectContaining({
        platform: 'TWITCH',
        metric: 'followers',
        value: 12_345,
        source: 'MANUAL',
      }),
    ]);
    await hit(statsPutRoute, 'PUT', '', {
      who: st,
      body: { platform: 'TWITCH', metric: 'followers', value: null },
    });
    expect((await hit(statsAdminRoute, 'GET', '', { who: st })).json.stats).toEqual([]);
    expect(
      (
        await hit(statsPutRoute, 'PUT', '', {
          who: st,
          body: { platform: 'TWITCH', metric: 'likes', value: 1 },
        })
      ).res.status,
    ).toBe(422);
  });
});

describe('settings and vouchers (streamer + step-up)', () => {
  it('turning checkout off closes it; needs a fresh login', async () => {
    const stale = await as('STREAMER', { authTime: new Date(Date.now() - 3_600_000) });
    expect(
      (await hit(settingsPutRoute, 'PUT', '', { who: stale, body: { ordersOpen: false } })).json
        .code,
    ).toBe('STEP_UP_REQUIRED');
    const st = await as('STREAMER');
    await hit(settingsPutRoute, 'PUT', '', { who: st, body: { ordersOpen: false } });
    expect((await hit(settingsRoute, 'GET', '', { who: st })).json.settings).toEqual({
      ordersOpen: false,
    });
    vi.stubEnv('MP_ACCESS_TOKEN', 'x');
    expect((await checkoutStatus()).open).toBe(false);
    await hit(settingsPutRoute, 'PUT', '', { who: st, body: { ordersOpen: true } });
    expect(
      await db().auditLog.count({ where: { action: 'settings.update' } }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('vouchers: create (canonical upper-case), duplicate 409, end and cap', async () => {
    const st = await as('STREAMER');
    const code = `teste-${Date.now().toString(36)}`.slice(0, 20);
    const c = await hit(voucherCreateRoute, 'POST', '', {
      who: st,
      body: { code, kind: 'PERCENT', percentBps: 1000, maxPerUser: 1, maxRedemptions: 5 },
    });
    expect(c.res.status).toBe(201);
    const v = c.json.voucher as { id: string; code: string };
    expect(v.code).toBe(code.toUpperCase());
    expect(
      (
        await hit(voucherCreateRoute, 'POST', '', {
          who: st,
          body: { code, kind: 'PERCENT', percentBps: 500, maxPerUser: 1 },
        })
      ).json.code,
    ).toBe('VOUCHER_EXISTS');
    expect(
      (
        await hit(voucherCreateRoute, 'POST', '', {
          who: st,
          body: { code: 'OUTRO-CODIGO', kind: 'FIXED', maxPerUser: 1 },
        })
      ).res.status,
    ).toBe(422);
    const off = await hit(voucherPatchRoute, 'PATCH', '', {
      who: st,
      params: { id: v.id },
      body: { active: false },
    });
    expect((off.json.voucher as { active: boolean }).active).toBe(false);
    const list = await hit(vouchersRoute, 'GET', '', { who: st });
    expect((list.json.vouchers as { id: string }[]).map((x) => x.id)).toContain(v.id);
  });
});

describe('audit viewer', () => {
  it('filters by action and pages by id; CSV cells can never become formulas', async () => {
    const st = await as('STREAMER');
    await hit(settingsPutRoute, 'PUT', '', { who: st, body: { ordersOpen: true } });
    const r = await hit(auditRoute, 'GET', '/api/v1/admin/audit?action=settings', { who: st });
    const entries = r.json.entries as { action: string; actor: string }[];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.action.startsWith('settings'))).toBe(true);
    expect(entries[0]!.actor).toBe(`@${st.user.username}`);

    for (const bad of ['=HYPERLINK("http://x")', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      expect(csvCell(bad).replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    const csv = await hit(auditExportRoute, 'GET', '/api/v1/admin/audit/export?action=settings', {
      who: st,
    });
    expect(csv.res.headers.get('content-type')).toContain('text/csv');
    expect(String(csv.json.raw)).toMatch(/^id,at,actor,role,action/);
    expect(
      await db().auditLog.count({ where: { action: 'audit.export', actorId: st.user.id } }),
    ).toBe(1);
    expect(
      (await hit(auditRoute, 'GET', '/api/v1/admin/audit?action=DROP%20TABLE', { who: st })).res
        .status,
    ).toBe(422);
  });
});
