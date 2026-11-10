import type { User } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { GET as listRoute, POST as createRoute } from '@/app/api/v1/items/[id]/reviews/route';
import { DELETE as deleteRoute, PATCH as editRoute } from '@/app/api/v1/reviews/[id]/route';
import { DELETE as unlikeRoute, PUT as likeRoute } from '@/app/api/v1/reviews/[id]/like/route';
import { POST as reportRoute } from '@/app/api/v1/reviews/[id]/reports/route';
import { POST as moderateRoute } from '@/app/api/v1/admin/moderation/reviews/[id]/route';
import { GET as queueRoute } from '@/app/api/v1/admin/moderation/queue/route';
import { makeItem } from './catalog';
import { makeUser } from './db';
import { call, req, signedIn } from './http';

const DAY = 86_400_000;

/**
 * An item watched on stream → reviews open. ARCHIVED (watched, slot already replaced) needs no
 * slot, so tests don't fight over the 50/20/10 live slots; `liveWatched` covers WATCHED itself.
 */
export async function watchedItem(kind: 'MOVIE' | 'SERIES' | 'FRANCHISE' | 'ANIME' = 'MOVIE') {
  const item = await makeItem({ kind, status: 'ARCHIVED' });
  const watchedAt = new Date(Date.now() - 60_000);
  await db().watchEvent.create({ data: { itemId: item.id, watchedAt } });
  return db().catalogItem.update({ where: { id: item.id }, data: { watchedAt } });
}

/** A WATCHED item still in its slot (first free movie slot). */
export async function liveWatched() {
  for (let slot = 1; slot <= 50; slot++) {
    const taken = await db().catalogItem.count({
      where: { kind: 'MOVIE', slot, status: { in: ['ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED'] } },
    });
    if (taken) continue;
    const item = await makeItem({ kind: 'MOVIE', status: 'WATCHED', slot });
    await db().watchEvent.create({ data: { itemId: item.id, watchedAt: new Date() } });
    return item;
  }
  throw new Error('no free movie slot');
}

/** A user whose account is `days` old (report/auto-hide rules look at the account age). */
export async function agedUser(
  days: number,
  over: Parameters<typeof makeUser>[0] = {},
): Promise<User> {
  const u = await makeUser(over);
  return db().user.update({
    where: { id: u.id },
    data: { createdAt: new Date(Date.now() - days * DAY) },
  });
}

type Auth = Awaited<ReturnType<typeof signedIn>>;
export type Actor = { user: User; auth: Auth };

export async function actor(days = 30, over: Parameters<typeof makeUser>[0] = {}): Promise<Actor> {
  const user = await agedUser(days, over);
  return { user, auth: await signedIn(user) };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>);
}

const as = (a: Actor | null, extra: Record<string, string> = {}) => ({
  cookies: a?.auth.cookies ?? {},
  headers: { ...(a?.auth.headers ?? {}), ...extra },
});

export function reviewBody(over: Record<string, unknown> = {}) {
  return {
    rating: 4,
    body: 'Gostei muito do filme, a trilha é ótima.',
    containsSpoilers: false,
    ...over,
  };
}

export async function postReview(
  a: Actor | null,
  itemId: string,
  body: unknown = reviewBody(),
  ip?: string,
) {
  const res = await call(
    createRoute,
    req('POST', `/api/v1/items/${itemId}/reviews`, {
      body,
      ...as(a, { 'x-turnstile-token': 'tok' }),
      ...(ip ? { ip } : {}),
    }),
    { id: itemId },
  );
  return { res, json: await json(res) };
}

export async function listReviews(a: Actor | null, itemId: string, query = '') {
  const res = await call(listRoute, req('GET', `/api/v1/items/${itemId}/reviews${query}`, as(a)), {
    id: itemId,
  });
  return { res, json: await json(res) };
}

export async function editReview(a: Actor, id: string, body: unknown) {
  const res = await call(editRoute, req('PATCH', `/api/v1/reviews/${id}`, { body, ...as(a) }), {
    id,
  });
  return { res, json: await json(res) };
}

export async function deleteReview(a: Actor, id: string) {
  const res = await call(deleteRoute, req('DELETE', `/api/v1/reviews/${id}`, as(a)), { id });
  return { res, json: await json(res) };
}

export async function like(a: Actor, id: string, on = true, ip?: string) {
  const res = await call(
    on ? likeRoute : unlikeRoute,
    req(on ? 'PUT' : 'DELETE', `/api/v1/reviews/${id}/like`, { ...as(a), ...(ip ? { ip } : {}) }),
    { id },
  );
  return { res, json: await json(res) };
}

export async function report(
  a: Actor,
  id: string,
  body: unknown = { reason: 'SPAM' },
  ip?: string,
) {
  const res = await call(
    reportRoute,
    req('POST', `/api/v1/reviews/${id}/reports`, { body, ...as(a), ...(ip ? { ip } : {}) }),
    { id },
  );
  return { res, json: await json(res) };
}

export async function moderateReview(a: Actor, id: string, body: unknown) {
  const res = await call(
    moderateRoute,
    req('POST', `/api/v1/admin/moderation/reviews/${id}`, { body, ...as(a) }),
    { id },
  );
  return { res, json: await json(res) };
}

export async function queue(a: Actor) {
  const res = await call(queueRoute, req('GET', '/api/v1/admin/moderation/queue', as(a)));
  return { res, json: await json(res) };
}

/** A review written straight into the DB (fixtures for lists, likes and reports). */
export async function makeReview(
  itemId: string,
  author?: User,
  over: { rating?: number; body?: string; createdAt?: Date; status?: 'VISIBLE' | 'HIDDEN' } = {},
) {
  const user = author ?? (await agedUser(30));
  return db().review.create({
    data: {
      userId: user.id,
      itemId,
      rating: over.rating ?? 5,
      body: over.body ?? 'Uma avaliação qualquer.',
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
      ...(over.status ? { status: over.status } : {}),
    },
  });
}
