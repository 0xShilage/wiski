/**
 * Review moderation (Phase 3): passkey-gated, compare-and-set on the status the moderator saw,
 * reports resolved in the same transaction, REMOVE for the STREAMER only, every action audited;
 * the queue and the brigading signals.
 */
import { describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import type { ModerationQueue } from '@/lib/reviews/types';
import { signedIn } from '../support/http';
import {
  actor,
  agedUser,
  makeReview,
  moderateReview,
  queue,
  report,
  watchedItem,
  type Actor,
} from '../support/reviews';

async function staff(role: 'MODERATOR' | 'STREAMER'): Promise<Actor> {
  return actor(60, { role });
}

/** A visible review with `n` open reports from accounts 3 days old (no auto-hide). */
async function reported(n: number) {
  const item = await watchedItem();
  const review = await makeReview(item.id);
  for (let i = 0; i < n; i++)
    await report(await actor(3), review.id, { reason: 'OFFENSIVE', note: `nota ${i}` });
  return review;
}

async function held() {
  const item = await watchedItem();
  const review = await makeReview(item.id);
  for (let i = 0; i < 3; i++) await report(await actor(10), review.id);
  return review;
}

const statusOf = async (id: string) => db().review.findUniqueOrThrow({ where: { id } });
const reportsOf = (reviewId: string) => db().reviewReport.findMany({ where: { reviewId } });

describe('moderation actions', () => {
  it('need a passkey verified in the last 10 minutes', async () => {
    const review = await reported(1);
    const mod = await staff('MODERATOR');
    const stale = await signedIn(mod.user, new Date(), {
      mfaAt: new Date(Date.now() - 11 * 60_000),
    });
    const r = await moderateReview({ user: mod.user, auth: stale }, review.id, {
      action: 'HIDE',
      expectedStatus: 'VISIBLE',
    });
    expect(r.res.status).toBe(401);
    expect(['PASSKEY_REQUIRED', 'PASSKEY_ENROLL_REQUIRED']).toContain(r.json.code);
    expect((await statusOf(review.id)).status).toBe('VISIBLE');
  });

  it('HIDE: hidden from everyone, open reports ACTIONED, audited', async () => {
    const review = await reported(2);
    const mod = await staff('MODERATOR');
    const r = await moderateReview(mod, review.id, { action: 'HIDE', expectedStatus: 'VISIBLE' });
    expect(r.json).toEqual({ status: 'HIDDEN', resolvedReports: 2 });
    expect(await statusOf(review.id)).toMatchObject({
      status: 'HIDDEN',
      openReportCount: 0,
      heldReason: null,
    });
    const reps = await reportsOf(review.id);
    expect(
      reps.every((p) => p.status === 'ACTIONED' && p.resolvedById === mod.user.id && p.resolvedAt),
    ).toBe(true);
    const log = await db().auditLog.findFirstOrThrow({
      where: { action: 'moderation.review', targetId: review.id },
    });
    expect(log).toMatchObject({
      actorId: mod.user.id,
      actorRole: 'MODERATOR',
      targetType: 'review',
    });
    expect(log.metadata).toEqual({ action: 'HIDE', from: 'VISIBLE', to: 'HIDDEN', reports: 2 });
    expect(JSON.stringify(log.metadata)).not.toContain('nota'); // never the report notes or text
  });

  it('RESTORE an auto-hidden review: visible again, reports DISMISSED, reason cleared', async () => {
    const review = await held();
    expect((await statusOf(review.id)).status).toBe('AUTO_HIDDEN');
    const r = await moderateReview(await staff('MODERATOR'), review.id, {
      action: 'RESTORE',
      expectedStatus: 'AUTO_HIDDEN',
    });
    expect(r.json).toEqual({ status: 'VISIBLE', resolvedReports: 3 });
    expect(await statusOf(review.id)).toMatchObject({
      status: 'VISIBLE',
      heldReason: null,
      openReportCount: 0,
    });
    expect((await reportsOf(review.id)).every((p) => p.status === 'DISMISSED')).toBe(true);
    // a restored review can be reported afresh
    expect((await report(await actor(10), review.id)).res.status).toBe(200);
  });

  it('DISMISS keeps a visible review and closes its reports; nothing to dismiss → 409', async () => {
    const review = await reported(1);
    const mod = await staff('MODERATOR');
    const r = await moderateReview(mod, review.id, {
      action: 'DISMISS',
      expectedStatus: 'VISIBLE',
    });
    expect(r.json).toEqual({ status: 'VISIBLE', resolvedReports: 1 });
    const again = await moderateReview(mod, review.id, {
      action: 'DISMISS',
      expectedStatus: 'VISIBLE',
    });
    expect([again.res.status, again.json.code]).toEqual([409, 'INVALID_TRANSITION']);
  });

  it('REMOVE is for the STREAMER only, and is final', async () => {
    const review = await reported(1);
    const mod = await moderateReview(await staff('MODERATOR'), review.id, {
      action: 'REMOVE',
      expectedStatus: 'VISIBLE',
    });
    expect([mod.res.status, mod.json.code]).toEqual([403, 'STREAMER_ONLY']);
    const s = await staff('STREAMER');
    const ok = await moderateReview(s, review.id, { action: 'REMOVE', expectedStatus: 'VISIBLE' });
    expect(ok.json).toEqual({ status: 'REMOVED', resolvedReports: 1 });
    for (const action of ['RESTORE', 'HIDE', 'REMOVE'] as const) {
      const r = await moderateReview(s, review.id, { action, expectedStatus: 'HIDDEN' });
      expect(r.res.status).toBe(409);
    }
    // REMOVED can't even be named as the expected status
    const r = await moderateReview(s, review.id, { action: 'RESTORE', expectedStatus: 'REMOVED' });
    expect(r.res.status).toBe(422);
  });

  it('a stale view answers 409 REVIEW_CHANGED; invalid transitions 409; unknown review 404', async () => {
    const review = await reported(1);
    const mod = await staff('MODERATOR');
    await moderateReview(mod, review.id, { action: 'HIDE', expectedStatus: 'VISIBLE' });
    const stale = await moderateReview(mod, review.id, {
      action: 'HIDE',
      expectedStatus: 'VISIBLE',
    });
    expect([stale.res.status, stale.json.code]).toEqual([409, 'REVIEW_CHANGED']);
    const bad = await moderateReview(mod, review.id, {
      action: 'RESTORE',
      expectedStatus: 'VISIBLE',
    });
    expect([bad.res.status, bad.json.code]).toEqual([409, 'INVALID_TRANSITION']);
    const none = await moderateReview(mod, '00000000-0000-7000-8000-000000000000', {
      action: 'HIDE',
      expectedStatus: 'VISIBLE',
    });
    expect(none.res.status).toBe(404);
    const extra = await moderateReview(mod, review.id, {
      action: 'HIDE',
      expectedStatus: 'HIDDEN',
      note: 'x',
    });
    expect(extra.res.status).toBe(422);
  });

  it('two moderators acting at once → one wins, one audit row', async () => {
    const review = await reported(2);
    const [a, b] = await Promise.all([staff('MODERATOR'), staff('MODERATOR')]);
    const results = await Promise.all([
      moderateReview(a, review.id, { action: 'HIDE', expectedStatus: 'VISIBLE' }),
      moderateReview(b, review.id, { action: 'DISMISS', expectedStatus: 'VISIBLE' }),
    ]);
    expect(results.map((r) => r.res.status).sort()).toEqual([200, 409]);
    expect(
      await db().auditLog.count({ where: { action: 'moderation.review', targetId: review.id } }),
    ).toBe(1);
  });
});

describe('moderation queue', () => {
  it('held reviews first, then reported ones, with their reports — never an e-mail', async () => {
    const r1 = await reported(1);
    const r2 = await held();
    const res = await queue(await staff('MODERATOR'));
    expect(res.res.status).toBe(200);
    const q = res.json as unknown as ModerationQueue;
    const ids = q.entries.map((e) => e.review.id);
    expect(ids).toContain(r1.id);
    expect(ids.indexOf(r2.id)).toBeLessThan(ids.indexOf(r1.id));
    const e1 = q.entries.find((e) => e.review.id === r1.id)!;
    expect(e1.openReports).toHaveLength(1);
    expect(e1.openReports[0]).toMatchObject({ reason: 'OFFENSIVE', note: 'nota 0' });
    expect(e1.openReports[0]!.reporter.accountDays).toBe(3);
    expect(e1.review.authorAccountDays).toBe(30);
    expect(q.total).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(q)).not.toContain('@example.com');
  });

  it('recently hidden reviews are listed so they can be restored', async () => {
    const review = await reported(1);
    const mod = await staff('MODERATOR');
    await moderateReview(mod, review.id, { action: 'HIDE', expectedStatus: 'VISIBLE' });
    const q = (await queue(mod)).json as unknown as ModerationQueue;
    expect(q.hidden.map((e) => e.review.id)).toContain(review.id);
    expect(q.entries.map((e) => e.review.id)).not.toContain(review.id);
  });

  it('flags like bursts from new accounts and report bursts by one account', async () => {
    const item = await watchedItem();
    const review = await makeReview(item.id);
    const fresh = await Promise.all(Array.from({ length: 10 }, () => agedUser(1)));
    await db().reviewLike.createMany({
      data: fresh.map((u) => ({ userId: u.id, reviewId: review.id })),
    });

    const spammer = await actor(10);
    const others = await Promise.all(Array.from({ length: 5 }, () => makeReview(item.id)));
    for (const o of others) await report(spammer, o.id);

    const q = (await queue(await staff('MODERATOR'))).json as unknown as ModerationQueue;
    expect(q.anomalies).toContainEqual(
      expect.objectContaining({
        kind: 'LIKE_BURST',
        reviewId: review.id,
        likes24h: 10,
        fromNewAccounts: 10,
      }),
    );
    expect(q.anomalies).toContainEqual(
      expect.objectContaining({
        kind: 'REPORT_BURST',
        username: spammer.user.username,
        reports24h: 5,
      }),
    );
  });
});
