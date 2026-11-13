import { randomBytes, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { User } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { makeItem } from './catalog';
import { makeUser } from './db';
import { call, req, signedIn } from './http';
import { testPublicCode } from './orders';
import type { RoleName } from '@/lib/roles';

/** Direct-DB fixtures for the live schedule (Phase 4): paid movies, funded campaigns, sessions. */

let slot = 0;
export function resetSlots() {
  slot = 0;
}

async function freeMovieSlot(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    slot = (slot % 50) + 1;
    const taken = await db().catalogItem.count({
      where: { kind: 'MOVIE', slot, status: { in: ['ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED'] } },
    });
    if (!taken) return slot;
  }
  throw new Error('no free movie slot (call clearCatalog in beforeEach)');
}

export async function paidMovie(
  o: {
    runtime?: number;
    tier?: 'topo' | 'prioridade' | null;
    user?: User | null;
    paidAt?: Date;
    guestName?: string | null;
    message?: string | null;
    title?: string;
  } = {},
) {
  const runtime = o.runtime ?? 100;
  const item = await makeItem({
    kind: 'MOVIE',
    status: 'SPONSORED',
    slot: await freeMovieSlot(),
    runtimeMinutes: runtime,
    ...(o.title ? { title: o.title } : {}),
  });
  const rs = await db().priceRuleSet.findFirstOrThrow({ where: { status: 'ACTIVE' } });
  const user = o.user ?? null;
  const email = user ? user.email : `convidado-${randomUUID().slice(0, 8)}@example.com`;
  const extra = o.tier ? 1600 : 0;
  const order = await db().order.create({
    data: {
      publicCode: testPublicCode(),
      kind: 'MOVIE',
      itemId: item.id,
      userId: user?.id ?? null,
      contactEmail: email,
      buyerKey: user ? `u:${user.id}` : `e:${randomBytes(32).toString('hex')}`,
      accessTokenHash: randomBytes(32),
      runtimeMinutes: runtime,
      ruleSetId: rs.id,
      rescheduleCount: 0,
      queueJumpTierId: o.tier ?? null,
      breakdown: [],
      subtotalCents: 2000,
      queueJumpCents: extra,
      totalCents: 2000 + extra,
      status: 'PAID',
      paidAt: o.paidAt ?? new Date(),
      clientRequestId: randomUUID(),
      ...(o.guestName !== undefined && o.guestName !== null
        ? { guestDisplayName: o.guestName, displayNameStatus: 'PENDING' as const }
        : {}),
      ...(o.message ? { sponsorMessage: o.message, messageStatus: 'PENDING' as const } : {}),
    },
  });
  return { item, order };
}

export async function fundedCampaign() {
  for (let s = 1; s <= 20; s++) {
    const taken = await db().catalogItem.count({
      where: { kind: 'SERIES', slot: s, status: { in: ['ACTIVE', 'FUNDED', 'WATCHED'] } },
    });
    if (taken) continue;
    const item = await makeItem({ kind: 'SERIES', status: 'FUNDED', slot: s });
    const opener = await makeUser({ role: 'STREAMER' });
    const now = new Date();
    const campaign = await db().campaign.create({
      data: {
        itemId: item.id,
        goalCents: 10_000,
        raisedCents: 10_000,
        remainingCents: 0,
        supporterCount: 3,
        deadlineAt: new Date(now.getTime() + 30 * 86_400_000),
        status: 'FUNDED',
        openedAt: new Date(now.getTime() - 86_400_000),
        openedById: opener.id,
        fundedAt: now,
      },
    });
    return { item, campaign };
  }
  throw new Error('no free series slot');
}

export async function makeSession(
  o: { inHours?: number; capacity?: number; status?: 'PLANNED' | 'LIVE' } = {},
) {
  const startsAt = new Date(Date.now() + (o.inHours ?? 72) * 3_600_000);
  return db().streamSession.create({
    data: {
      startsAt,
      capacityMinutes: o.capacity ?? 300,
      ...(o.status === 'LIVE' ? { status: 'LIVE', startedAt: new Date() } : {}),
    },
  });
}

// ── calling route handlers as someone ──

export type Who = { user: User; auth: Awaited<ReturnType<typeof signedIn>> };

export async function as(
  role: RoleName,
  o: { authTime?: Date; mfaAt?: Date | null } = {},
): Promise<Who> {
  const user = await makeUser({ role });
  return {
    user,
    auth: await signedIn(
      user,
      o.authTime ?? new Date(),
      o.mfaAt === undefined ? {} : { mfaAt: o.mfaAt },
    ),
  };
}

type Handler = Parameters<typeof call>[0];

export async function hit(
  handler: Handler,
  method: string,
  path: string,
  o: {
    who?: Who | null;
    body?: unknown;
    params?: Record<string, string>;
    headers?: Record<string, string>;
    ip?: string;
  } = {},
): Promise<{ res: Response; json: Record<string, unknown> }> {
  const request: NextRequest = req(method, path, {
    cookies: o.who?.auth.cookies ?? {},
    headers: { ...(o.who?.auth.headers ?? {}), ...o.headers },
    ...(o.body !== undefined ? { body: o.body } : {}),
    ...(o.ip ? { ip: o.ip } : {}),
  });
  const res = await call(handler, request, o.params ?? {});
  const text = res.status === 204 ? '' : await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  return { res, json };
}
