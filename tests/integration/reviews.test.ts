/**
 * Reviews, likes and reports (Phase 3): business rules, visibility, sanitising, the XSS corpus,
 * concurrency on the trigger-maintained counters, and rate limits (05 §9).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { plainText } from '@/server/text/sanitize';
import { ownReview } from '@/server/reviews/read';
import { GET as latestRoute } from '@/app/api/v1/reviews/route';
import { GET as profileRoute } from '@/app/api/v1/users/[username]/route';
import { GET as profileReviewsRoute } from '@/app/api/v1/users/[username]/reviews/route';
import { makeItem } from '../support/catalog';
import { call, freshIp, req } from '../support/http';
import {
  actor,
  deleteReview,
  editReview,
  like,
  listReviews,
  liveWatched,
  makeReview,
  postReview,
  report,
  reviewBody,
  watchedItem,
} from '../support/reviews';
import { XSS_CORPUS } from '../support/xss-corpus';

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string | URL) =>
    String(url).startsWith('https://challenges.cloudflare.com/')
      ? Response.json({ success: true })
      : Response.json({ message: 'unexpected outbound call' }, { status: 599 }),
  );
});

const code = (j: Record<string, unknown>) => j.code;
type Rev = {
  id: string;
  body: string;
  rating: number;
  status?: string;
  heldReason?: string | null;
};

describe('writing a review', () => {
  it('happy path: stored as sanitised plain text, listed with the summary', async () => {
    const item = await watchedItem();
    const a = await actor();
    const rlo = String.fromCodePoint(0x202e);
    const { res, json } = await postReview(
      a,
      item.id,
      reviewBody({
        rating: 5,
        body: `  Que filme!${rlo}\n\n\n\nRecomendo.  `,
        containsSpoilers: true,
      }),
    );
    expect(res.status).toBe(201);
    const review = json.review as Rev & { containsSpoilers: boolean; mine: boolean };
    expect(review).toMatchObject({
      rating: 5,
      body: 'Que filme!\n\nRecomendo.',
      status: 'VISIBLE',
    });
    expect(review.containsSpoilers).toBe(true);

    const list = await listReviews(null, item.id);
    expect(list.res.status).toBe(200);
    const reviews = list.json.reviews as Rev[];
    expect(reviews.map((r) => r.id)).toEqual([review.id]);
    expect(list.json.summary).toEqual({ count: 1, average10: 50, distribution: [0, 0, 0, 0, 1] });
    expect(JSON.stringify(list.json)).not.toContain('@example.com');
    expect(reviews[0]).not.toHaveProperty('likedByMe'); // anonymous viewer
  });

  it('works on a title still in its slot (WATCHED) too', async () => {
    const item = await liveWatched();
    const { res } = await postReview(await actor(), item.id);
    expect(res.status).toBe(201);
    await db().review.deleteMany({ where: { itemId: item.id } });
    await db().watchEvent.deleteMany({ where: { itemId: item.id } });
    await db().catalogItem.update({
      where: { id: item.id },
      data: { status: 'ARCHIVED', slot: null, archivedAt: new Date() },
    });
  });

  it('needs a login, a watched title, a username and an active account', async () => {
    const item = await watchedItem();
    expect((await postReview(null, item.id)).res.status).toBe(401);

    const live = await makeItem({ kind: 'MOVIE', status: 'DRAFT' });
    expect((await postReview(await actor(), live.id)).res.status).toBe(404);
    expect(
      (await postReview(await actor(), '00000000-0000-7000-8000-000000000000')).res.status,
    ).toBe(404);
    expect((await postReview(await actor(), 'nao-e-uuid')).res.status).toBe(404);

    const noName = await postReview(await actor(30, { username: null }), item.id);
    expect([noName.res.status, code(noName.json)]).toEqual([409, 'ONBOARDING_REQUIRED']);
    const suspended = await postReview(await actor(30, { status: 'SUSPENDED' }), item.id);
    expect([suspended.res.status, code(suspended.json)]).toEqual([403, 'ACCOUNT_SUSPENDED']);
  });

  it('an unwatched title has no reviews to read either', async () => {
    const draft = await makeItem({ kind: 'MOVIE', status: 'DRAFT' });
    expect((await listReviews(null, draft.id)).res.status).toBe(404);
  });

  it('one review per person per title', async () => {
    const item = await watchedItem();
    const a = await actor();
    expect((await postReview(a, item.id)).res.status).toBe(201);
    const again = await postReview(a, item.id);
    expect([again.res.status, code(again.json)]).toEqual([409, 'REVIEW_EXISTS']);
  });

  it('4 parallel posts by one person → exactly one review', async () => {
    const item = await watchedItem();
    const a = await actor();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => postReview(a, item.id, reviewBody(), freshIp())),
    );
    expect(results.filter((r) => r.res.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.res.status === 409)).toHaveLength(3);
    expect(await db().review.count({ where: { itemId: item.id } })).toBe(1);
  });

  it('strict body, whole stars 1–5, length after sanitising', async () => {
    const item = await watchedItem();
    // a fresh person per attempt: rejected attempts count towards the 5/h limit too
    for (const bad of [
      reviewBody({ rating: 0 }),
      reviewBody({ rating: 6 }),
      reviewBody({ rating: 3.5 }),
      reviewBody({ likeCount: 99 }),
      reviewBody({ status: 'VISIBLE' }),
      { rating: 4, body: 'x' },
      reviewBody({ body: 'x'.repeat(8001) }),
    ]) {
      const r = await postReview(await actor(), item.id, bad);
      expect(r.res.status, JSON.stringify(bad).slice(0, 60)).toBe(422);
    }
    const blank = await postReview(
      await actor(),
      item.id,
      reviewBody({ body: `   ${String.fromCodePoint(0x200b)}  \n ` }),
    );
    expect(blank.res.status).toBe(422);
    const long = await postReview(await actor(), item.id, reviewBody({ body: 'a'.repeat(2001) }));
    expect(long.res.status).toBe(422);
    // 2000 astral characters are 2000 code points (Postgres char_length), not 4000 UTF-16 units
    const emoji = await postReview(await actor(), item.id, reviewBody({ body: '🎬'.repeat(2000) }));
    expect(emoji.res.status).toBe(201);
  });

  it('needs a Turnstile token', async () => {
    const item = await watchedItem();
    const a = await actor();
    vi.stubGlobal('fetch', async () => Response.json({ success: false }));
    const r = await postReview(a, item.id);
    expect([r.res.status, code(r.json)]).toEqual([403, 'TURNSTILE_FAILED']);
  });

  it('more than 2 links → held for moderation (author sees it, nobody else)', async () => {
    const item = await watchedItem();
    const a = await actor();
    const two = await postReview(
      a,
      item.id,
      reviewBody({ body: 'veja https://a.com e www.b.org' }),
    );
    expect((two.json.review as Rev).status).toBe('VISIBLE');

    const b = await actor();
    const three = await postReview(
      b,
      item.id,
      reviewBody({ body: 'a.com, b.net e https://c.org' }),
    );
    expect(three.res.status).toBe(201);
    expect(three.json.review).toMatchObject({ status: 'AUTO_HIDDEN', heldReason: 'LINKS' });
    const list = (await listReviews(null, item.id)).json.reviews as Rev[];
    expect(list.map((r) => r.id)).toEqual([(two.json.review as Rev).id]);
    expect(await ownReview(item.id, b.user.id)).toMatchObject({
      status: 'AUTO_HIDDEN',
      heldReason: 'LINKS',
    });
  });
});

describe('XSS payload corpus', () => {
  it('every payload is stored and served back as the sanitised plain text, nothing else', async () => {
    const item = await watchedItem();
    const ids = new Map<string, string>();
    for (const payload of XSS_CORPUS) {
      const { res, json } = await postReview(await actor(), item.id, reviewBody({ body: payload }));
      if (plainText(payload, { multiline: true }).length === 0) {
        expect(res.status).toBe(422);
        continue;
      }
      expect(res.status, payload).toBe(201);
      ids.set((json.review as Rev).id, plainText(payload, { multiline: true }));
    }
    const stored = await db().review.findMany({
      where: { itemId: item.id },
      select: { id: true, body: true },
    });
    for (const r of stored) expect(r.body).toBe(ids.get(r.id));

    const served: Rev[] = [];
    let cursor: string | null = null;
    do {
      const page: { json: Record<string, unknown> } = await listReviews(
        null,
        item.id,
        cursor ? `?cursor=${cursor}` : '',
      );
      served.push(...(page.json.reviews as Rev[]));
      cursor = page.json.nextCursor as string | null;
    } while (cursor);
    expect(served).toHaveLength(ids.size);
    for (const r of served) expect(r.body).toBe(ids.get(r.id));
  });

  it('report notes go through the same sanitiser', async () => {
    const item = await watchedItem();
    const review = await makeReview(item.id);
    const a = await actor();
    const note = `<img src=x onerror=alert(1)>${String.fromCodePoint(0x202e)}abc`;
    expect((await report(a, review.id, { reason: 'OTHER', note })).res.status).toBe(200);
    const row = await db().reviewReport.findFirstOrThrow({ where: { reviewId: review.id } });
    expect(row.note).toBe('<img src=x onerror=alert(1)>abc');
  });
});

describe('editing and deleting', () => {
  it('the author edits (marked "editado"); others get 404', async () => {
    const item = await watchedItem();
    const a = await actor();
    const id = ((await postReview(a, item.id)).json.review as Rev).id;

    const same = await editReview(a, id, { rating: 4 });
    expect((same.json.review as { editedAt: string | null }).editedAt).toBeNull(); // nothing changed

    const r = await editReview(a, id, { rating: 2, body: 'Mudei de ideia.' });
    expect(r.res.status).toBe(200);
    expect(r.json.review).toMatchObject({ rating: 2, body: 'Mudei de ideia.' });
    expect((r.json.review as { editedAt: string | null }).editedAt).not.toBeNull();

    expect((await editReview(await actor(), id, { rating: 1 })).res.status).toBe(404);
    expect((await editReview(a, id, {})).res.status).toBe(422);
    expect((await editReview(a, id, { likeCount: 5 })).res.status).toBe(422);
  });

  it('a review with the moderation is locked; adding links holds it', async () => {
    const item = await watchedItem();
    const a = await actor();
    const id = ((await postReview(a, item.id)).json.review as Rev).id;
    const held = await editReview(a, id, { body: 'x.com y.com z.com' });
    expect(held.json.review).toMatchObject({ status: 'AUTO_HIDDEN', heldReason: 'LINKS' });
    const locked = await editReview(a, id, { body: 'sem links agora' });
    expect([locked.res.status, code(locked.json)]).toEqual([409, 'REVIEW_LOCKED']);
  });

  it('the author deletes (likes and reports go too); a REMOVED review stays', async () => {
    const item = await watchedItem();
    const a = await actor();
    const id = ((await postReview(a, item.id)).json.review as Rev).id;
    await like(await actor(), id);
    expect((await deleteReview(await actor(), id)).res.status).toBe(404);
    expect((await deleteReview(a, id)).res.status).toBe(204);
    expect(await db().reviewLike.count({ where: { reviewId: id } })).toBe(0);

    const b = await actor();
    const removed = await makeReview(item.id, b.user);
    await db().review.update({ where: { id: removed.id }, data: { status: 'REMOVED' } });
    const r = await deleteReview(b, removed.id);
    expect([r.res.status, code(r.json)]).toEqual([409, 'REVIEW_LOCKED']);
    // …so the slot stays taken: no second review on the same title
    expect((await postReview(b, item.id)).res.status).toBe(409);
  });
});

describe('listing', () => {
  it('newest first or most liked first, keyset pages, viewer flags', async () => {
    const item = await watchedItem();
    const base = Date.now() - 3_600_000;
    const rows = [];
    for (let i = 0; i < 23; i++) {
      rows.push(
        await makeReview(item.id, undefined, {
          createdAt: new Date(base + i * 1000),
          rating: (i % 5) + 1,
        }),
      );
    }
    // likes: review 3 → 3 likes, review 7 → 1 like (the trigger counts them)
    const likers = await Promise.all([actor(), actor(), actor()]);
    for (const l of likers) await like(l, rows[3]!.id);
    await like(likers[0]!, rows[7]!.id);

    const recent: string[] = [];
    let cursor: string | null = null;
    do {
      const p: { json: Record<string, unknown> } = await listReviews(
        null,
        item.id,
        cursor ? `?cursor=${cursor}` : '',
      );
      recent.push(...(p.json.reviews as Rev[]).map((r) => r.id));
      cursor = p.json.nextCursor as string | null;
    } while (cursor);
    expect(recent).toEqual(rows.map((r) => r.id).reverse());

    const top = await listReviews(likers[0]!, item.id, '?sort=top');
    const topIds = top.json.reviews as (Rev & { likedByMe: boolean; likeCount: number })[];
    expect(topIds[0]).toMatchObject({ id: rows[3]!.id, likeCount: 3, likedByMe: true });
    expect(topIds[1]).toMatchObject({ id: rows[7]!.id, likeCount: 1, likedByMe: true });
    expect(topIds[2]!.likedByMe).toBe(false);

    const topAll: string[] = [];
    cursor = null;
    do {
      const p: { json: Record<string, unknown> } = await listReviews(
        null,
        item.id,
        `?sort=top${cursor ? `&cursor=${cursor}` : ''}`,
      );
      topAll.push(...(p.json.reviews as Rev[]).map((r) => r.id));
      cursor = p.json.nextCursor as string | null;
    } while (cursor);
    expect(new Set(topAll).size).toBe(23);

    expect((await listReviews(null, item.id, '?cursor=bm9wZQ')).res.status).toBe(422);
    expect((await listReviews(null, item.id, '?sort=random')).res.status).toBe(422);
    expect((await listReviews(null, item.id, '?sort=top&sort=recent')).res.status).toBe(422);
  });

  it('hides non-visible reviews and authors whose account was erased', async () => {
    const item = await watchedItem();
    const visible = await makeReview(item.id);
    await makeReview(item.id, undefined, { status: 'HIDDEN' });
    const gone = await actor(30, { status: 'DELETED' });
    await makeReview(item.id, gone.user);
    const list = (await listReviews(null, item.id)).json;
    expect((list.reviews as Rev[]).map((r) => r.id)).toEqual([visible.id]);
    expect((list.summary as { count: number }).count).toBe(1);
  });

  it('latest reviews across titles and public profiles never show an e-mail', async () => {
    const item = await watchedItem();
    const a = await actor();
    await postReview(a, item.id);
    const latest = await call(latestRoute, req('GET', '/api/v1/reviews'));
    expect(latest.status).toBe(200);
    const text = await latest.text();
    expect(text).not.toContain('@example.com');

    const name = a.user.username!;
    const prof = await call(profileRoute, req('GET', `/api/v1/users/${name}`), { username: name });
    const pj = (await prof.json()) as Record<string, unknown>;
    expect(pj).toMatchObject({ username: name, reviewCount: 1 });
    expect(Object.keys(pj).sort()).toEqual(['avatarKey', 'joined', 'reviewCount', 'username']);
    const upper = await call(profileRoute, req('GET', `/api/v1/users/${name.toUpperCase()}`), {
      username: name.toUpperCase(),
    });
    expect(upper.status).toBe(200);

    const pr = await call(profileReviewsRoute, req('GET', `/api/v1/users/${name}/reviews`), {
      username: name,
    });
    expect(((await pr.json()) as { reviews: unknown[] }).reviews).toHaveLength(1);

    const del = await actor(30, { status: 'DELETED' });
    const r404 = await call(profileRoute, req('GET', `/api/v1/users/${del.user.username}`), {
      username: del.user.username!,
    });
    expect(r404.status).toBe(404);
    for (const bad of ['a', 'x'.repeat(65), 'ana-maria', '..%2f']) {
      const r = await call(profileRoute, req('GET', `/api/v1/users/x`), { username: bad });
      expect(r.status).toBe(404);
    }
  });
});

describe('likes', () => {
  it('idempotent like/unlike, never your own, only visible reviews, active accounts', async () => {
    const item = await watchedItem();
    const author = await actor();
    const review = await makeReview(item.id, author.user);
    const a = await actor();

    expect((await like(a, review.id)).json).toEqual({ liked: true, likeCount: 1 });
    expect((await like(a, review.id)).json).toEqual({ liked: true, likeCount: 1 });
    expect((await like(a, review.id, false)).json).toEqual({ liked: false, likeCount: 0 });
    expect((await like(a, review.id, false)).json).toEqual({ liked: false, likeCount: 0 });

    const own = await like(author, review.id);
    expect([own.res.status, code(own.json)]).toEqual([422, 'OWN_REVIEW']);
    const susp = await like(await actor(30, { status: 'SUSPENDED' }), review.id);
    expect([susp.res.status, code(susp.json)]).toEqual([403, 'ACCOUNT_SUSPENDED']);

    const hidden = await makeReview(item.id, undefined, { status: 'HIDDEN' });
    expect((await like(a, hidden.id)).res.status).toBe(404);
    expect((await like(a, '00000000-0000-7000-8000-000000000000')).res.status).toBe(404);
  });

  it('25 people liking at once → likeCount 25 (trigger-maintained, no lost update)', async () => {
    const item = await watchedItem();
    const review = await makeReview(item.id);
    const people = await Promise.all(Array.from({ length: 25 }, () => actor()));
    const results = await Promise.all(people.map((p) => like(p, review.id)));
    expect(results.every((r) => r.res.status === 200)).toBe(true);
    const row = await db().review.findUniqueOrThrow({ where: { id: review.id } });
    expect(row.likeCount).toBe(25);
    expect(await db().reviewLike.count({ where: { reviewId: review.id } })).toBe(25);
  });

  it('one person hammering like/unlike in parallel keeps the counter equal to the rows', async () => {
    const item = await watchedItem();
    const review = await makeReview(item.id);
    const a = await actor();
    await Promise.all(Array.from({ length: 30 }, (_, i) => like(a, review.id, i % 2 === 0)));
    const row = await db().review.findUniqueOrThrow({ where: { id: review.id } });
    expect(row.likeCount).toBe(await db().reviewLike.count({ where: { reviewId: review.id } }));
    expect(row.likeCount).toBeLessThanOrEqual(1);
  });
});

describe('reports', () => {
  it('needs an account ≥ 24 h old; not your own; one per person (repeats answer the same)', async () => {
    const item = await watchedItem();
    const author = await actor();
    const review = await makeReview(item.id, author.user);

    const young = await report(await actor(0), review.id);
    expect([young.res.status, code(young.json)]).toEqual([403, 'ACCOUNT_TOO_NEW']);
    const own = await report(author, review.id);
    expect([own.res.status, code(own.json)]).toEqual([422, 'OWN_REVIEW']);

    const a = await actor(2);
    expect((await report(a, review.id)).json).toEqual({ received: true });
    expect((await report(a, review.id, { reason: 'OFFENSIVE' })).json).toEqual({ received: true });
    expect(await db().reviewReport.count({ where: { reviewId: review.id } })).toBe(1);
    expect(
      (await db().review.findUniqueOrThrow({ where: { id: review.id } })).openReportCount,
    ).toBe(1);

    expect((await report(a, review.id, { reason: 'NOPE' })).res.status).toBe(422);
    expect(
      (await report(await actor(2), review.id, { reason: 'OTHER', note: 'x'.repeat(501) })).res
        .status,
    ).toBe(422);
  });

  it('3 reports from accounts ≥ 7 days old hide the review until a moderator looks', async () => {
    const item = await watchedItem();
    const review = await makeReview(item.id);
    for (let i = 0; i < 2; i++) await report(await actor(10), review.id);
    expect((await db().review.findUniqueOrThrow({ where: { id: review.id } })).status).toBe(
      'VISIBLE',
    );
    await report(await actor(10), review.id, { reason: 'HARASSMENT' });
    const row = await db().review.findUniqueOrThrow({ where: { id: review.id } });
    expect(row).toMatchObject({ status: 'AUTO_HIDDEN', heldReason: 'REPORTS', openReportCount: 3 });
    expect(
      await db().auditLog.count({ where: { action: 'review.autohide', targetId: review.id } }),
    ).toBe(1);
    // gone from the public list; can't be reported or liked any more
    expect(
      ((await listReviews(null, item.id)).json.reviews as Rev[]).map((r) => r.id),
    ).not.toContain(review.id);
    expect((await report(await actor(10), review.id)).res.status).toBe(404);
  });

  it('reports from young accounts (1–6 days) queue up but never auto-hide', async () => {
    const item = await watchedItem();
    const review = await makeReview(item.id);
    for (let i = 0; i < 5; i++) await report(await actor(3), review.id);
    const row = await db().review.findUniqueOrThrow({ where: { id: review.id } });
    expect(row).toMatchObject({ status: 'VISIBLE', openReportCount: 5 });
  });

  it('6 reports at once → hidden exactly once (the counter trigger serialises them)', async () => {
    const item = await watchedItem();
    const review = await makeReview(item.id);
    const people = await Promise.all(Array.from({ length: 6 }, () => actor(10)));
    const results = await Promise.all(people.map((p) => report(p, review.id)));
    expect(results.every((r) => r.res.status === 200)).toBe(true);
    const row = await db().review.findUniqueOrThrow({ where: { id: review.id } });
    expect(row).toMatchObject({ status: 'AUTO_HIDDEN', heldReason: 'REPORTS', openReportCount: 6 });
    expect(
      await db().auditLog.count({ where: { action: 'review.autohide', targetId: review.id } }),
    ).toBe(1);
  });
});

describe('rate limits (05 §9)', () => {
  it('create review: 5 per hour per person', async () => {
    const a = await actor();
    const items = await Promise.all(Array.from({ length: 6 }, () => watchedItem()));
    const statuses = [];
    for (const item of items)
      statuses.push((await postReview(a, item.id, reviewBody(), freshIp())).res.status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('create review: 10 per hour per IP', async () => {
    const item = await watchedItem();
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 11; i++)
      statuses.push((await postReview(await actor(), item.id, reviewBody(), ip)).res.status);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('like/unlike: 120 per hour per person', async () => {
    const item = await watchedItem();
    const review = await makeReview(item.id);
    const a = await actor();
    let last = 0;
    for (let i = 0; i < 121; i++)
      last = (await like(a, review.id, i % 2 === 0, freshIp())).res.status;
    expect(last).toBe(429);
  });

  it('report: 10 per hour per person, 20 per hour per IP', async () => {
    const item = await watchedItem();
    const review = await makeReview(item.id);
    const a = await actor(10);
    const mine = [];
    for (let i = 0; i < 11; i++)
      mine.push((await report(a, review.id, { reason: 'SPAM' }, freshIp())).res.status);
    expect(mine.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(mine[10]).toBe(429);

    const ip = freshIp();
    const other = await makeReview(item.id);
    const fromIp = [];
    for (let i = 0; i < 21; i++)
      fromIp.push((await report(await actor(10), other.id, { reason: 'SPAM' }, ip)).res.status);
    expect(fromIp[20]).toBe(429);
  });
});
