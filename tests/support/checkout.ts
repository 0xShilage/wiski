import { randomUUID } from 'node:crypto';
import { db } from '@/server/db';
import { makeItem } from './catalog';
import { call, req, setCookies } from './http';
import { POST as createSponsorship } from '@/app/api/v1/sponsorships/route';
import { POST as createContributionRoute } from '@/app/api/v1/campaigns/[id]/contributions/route';
import { POST as quoteRoute } from '@/app/api/v1/sponsorships/quote/route';
import { GET as getOrderRoute } from '@/app/api/v1/orders/[code]/route';

let slot = 0;

/** A live movie in the next free slot (catalog cleared by the caller between files). */
export async function liveMovie(runtimeMinutes = 115) {
  slot = (slot % 50) + 1;
  for (let i = 0; i < 50; i++) {
    const taken = await db().catalogItem.findFirst({
      where: { kind: 'MOVIE', slot, status: { in: ['ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED'] } },
    });
    if (!taken) break;
    slot = (slot % 50) + 1;
  }
  return makeItem({ kind: 'MOVIE', status: 'ACTIVE', slot, runtimeMinutes });
}

let cslot = 0;
/** A live series with an OPEN campaign. */
export async function openCampaignFor(goalCents = 10_000, days = 30) {
  cslot = (cslot % 10) + 1;
  for (let i = 0; i < 10; i++) {
    const taken = await db().catalogItem.findFirst({
      where: { kind: 'SERIES', slot: cslot, status: { in: ['ACTIVE', 'FUNDED', 'WATCHED'] } },
    });
    if (!taken) break;
    cslot = (cslot % 10) + 1;
  }
  const item = await makeItem({ kind: 'SERIES', status: 'ACTIVE', slot: cslot });
  const opener = await db().user.findFirstOrThrow({ where: { role: { not: 'USER' } } });
  const now = new Date();
  const campaign = await db().campaign.create({
    data: {
      itemId: item.id,
      goalCents,
      remainingCents: goalCents,
      openedAt: now,
      deadlineAt: new Date(now.getTime() + days * 86_400_000),
      openedById: opener.id,
    },
  });
  return { item, campaign };
}

export type Legal = { terms: string; privacy: string; refund: string };

export function movieBody(movieId: string, legal: Legal, over: Record<string, unknown> = {}) {
  return {
    movieId,
    queueJumpTier: null,
    expectedTotalCents: 2000,
    contactEmail: `guest-${randomUUID().slice(0, 8)}@example.com`,
    legal,
    ...over,
  };
}

export function contributionBody(
  amountCents: number,
  legal: Legal,
  over: Record<string, unknown> = {},
) {
  return {
    amountCents,
    contactEmail: `guest-${randomUUID().slice(0, 8)}@example.com`,
    legal,
    ...over,
  };
}

type CallOpts = {
  ip?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string | null>;
  idempotencyKey?: string;
};

function hdrs(o: CallOpts) {
  return {
    'idempotency-key': o.idempotencyKey ?? randomUUID(),
    'x-turnstile-token': 'tok',
    ...o.headers,
  };
}

export async function sponsor(body: unknown, o: CallOpts = {}) {
  const res = await call(
    createSponsorship,
    req('POST', '/api/v1/sponsorships', {
      body,
      headers: hdrs(o),
      ...(o.cookies ? { cookies: o.cookies } : {}),
      ...(o.ip ? { ip: o.ip } : {}),
    }),
  );
  return { res, json: (await res.json()) as Record<string, unknown>, cookies: setCookies(res) };
}

export async function contribute(campaignId: string, body: unknown, o: CallOpts = {}) {
  const res = await call(
    createContributionRoute,
    req('POST', `/api/v1/campaigns/${campaignId}/contributions`, {
      body,
      headers: hdrs(o),
      ...(o.cookies ? { cookies: o.cookies } : {}),
      ...(o.ip ? { ip: o.ip } : {}),
    }),
    { id: campaignId },
  );
  return { res, json: (await res.json()) as Record<string, unknown>, cookies: setCookies(res) };
}

export async function quote(body: unknown, o: CallOpts = {}) {
  const res = await call(
    quoteRoute,
    req('POST', '/api/v1/sponsorships/quote', {
      body,
      ...(o.headers ? { headers: o.headers } : {}),
      ...(o.cookies ? { cookies: o.cookies } : {}),
    }),
  );
  return { res, json: (await res.json()) as Record<string, unknown> };
}

export async function getOrder(code: string, o: CallOpts = {}) {
  const res = await call(
    getOrderRoute,
    req('GET', `/api/v1/orders/${code}`, {
      ...(o.cookies ? { cookies: o.cookies } : {}),
      ...(o.headers ? { headers: o.headers } : {}),
    }),
    { code },
  );
  return { res, json: (await res.json()) as Record<string, unknown> };
}

/** The __Host-wf_order cookie from a checkout response, ready to send back. */
export function orderCookie(cookies: ReturnType<typeof setCookies>): Record<string, string> {
  const c = cookies['__Host-wf_order'];
  if (!c) throw new Error('no order cookie set');
  return { '__Host-wf_order': c.value };
}

export async function orderByCode(code: string) {
  return db().order.findUniqueOrThrow({
    where: { publicCode: code },
    include: { payment: true, item: true, voucherRedemption: true, queueJumpSlot: true },
  });
}
