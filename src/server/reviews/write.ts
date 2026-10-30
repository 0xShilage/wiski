import 'server-only';
import type { z } from 'zod';
import type { User } from '@/generated/prisma/client';
import { REPORT_NOTE_MAX, REVIEW_BODY_MAX, type OwnReview } from '@/lib/reviews/types';
import type { RouteContext } from '../http/route';
import { HttpError, Problems } from '../http/problem';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { codePointLength, countLinks, plainText } from '../text/sanitize';
import type { createReviewInput, editReviewInput, reportInput } from './input';
import { PUBLIC_REVIEW, reviewSelect, reviewableItem, toOwnReview } from './read';

/**
 * Review writes (03 §5.4, 05 §8, Q15). Text is sanitised to plain text and length-checked after
 * sanitising; more than 2 links hold a review for moderation. Likes and reports are counted by
 * database triggers (Phase 3 reviewed SQL), so this code never adjusts a counter by hand.
 */

const DAY = 86_400_000;
/** 05 §8: reporting needs an account ≥ 24 h old; auto-hide counts reporters ≥ 7 days old. */
export const REPORT_MIN_ACCOUNT_AGE_MS = DAY;
export const AUTO_HIDE_ACCOUNT_AGE_MS = 7 * DAY;
export const AUTO_HIDE_REPORTS = 3;
export const MAX_LINKS = 2;

export const ReviewProblems = {
  onboarding: () =>
    new HttpError(409, 'ONBOARDING_REQUIRED', 'Escolha seu nome de usuário antes de avaliar.'),
  suspended: () =>
    new HttpError(
      403,
      'ACCOUNT_SUSPENDED',
      'Sua conta está suspensa: você ainda pode ler, mas não pode avaliar, curtir ou denunciar.',
    ),
  exists: () =>
    new HttpError(409, 'REVIEW_EXISTS', 'Você já avaliou este título. Edite a sua avaliação.'),
  locked: () =>
    new HttpError(
      409,
      'REVIEW_LOCKED',
      'Esta avaliação está com a moderação e não pode ser alterada agora.',
    ),
  own: () => new HttpError(422, 'OWN_REVIEW', 'Esta avaliação é sua.'),
  tooNew: () =>
    new HttpError(
      403,
      'ACCOUNT_TOO_NEW',
      'Contas criadas há menos de 24 horas ainda não podem denunciar.',
    ),
  text: (path: string, message: string) => Problems.validation([{ path, message }]),
};

type Audit = RouteContext<'user', undefined, undefined, unknown>['audit'];

function requireActive(user: Pick<User, 'status' | 'username'>, needsUsername = true): void {
  if (needsUsername && !user.username) throw ReviewProblems.onboarding();
  if (user.status !== 'ACTIVE') throw ReviewProblems.suspended();
}

function cleanBody(raw: string): { body: string; held: boolean } {
  const body = plainText(raw, { multiline: true });
  const len = codePointLength(body);
  if (len < 1) throw ReviewProblems.text('body', 'Escreva o que você achou.');
  if (len > REVIEW_BODY_MAX)
    throw ReviewProblems.text('body', `Use no máximo ${REVIEW_BODY_MAX} caracteres.`);
  return { body, held: countLinks(body) > MAX_LINKS };
}

function isUnique(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002' || pgErrorCode(err) === PG.uniqueViolation;
}

export async function createReview(
  user: User,
  itemId: string,
  input: z.output<typeof createReviewInput>,
): Promise<OwnReview> {
  const item = await reviewableItem(itemId);
  if (!item) throw Problems.notFound();
  requireActive(user);
  const { body, held } = cleanBody(input.body);
  try {
    const row = await db().review.create({
      data: {
        userId: user.id,
        itemId: item.id,
        rating: input.rating,
        body,
        containsSpoilers: input.containsSpoilers,
        ...(held ? { status: 'AUTO_HIDDEN', heldReason: 'LINKS' } : {}),
      },
      select: reviewSelect,
    });
    return toOwnReview(row, user.id);
  } catch (err) {
    if (isUnique(err)) throw ReviewProblems.exists();
    throw err;
  }
}

/** Owner edit: only while VISIBLE (a review with the moderation is locked); sets "editado". */
export async function editReview(
  user: User,
  reviewId: string,
  input: z.output<typeof editReviewInput>,
): Promise<OwnReview> {
  const current = await db().review.findFirst({
    where: { id: reviewId, userId: user.id },
    select: { status: true, body: true, rating: true, containsSpoilers: true },
  });
  if (!current) throw Problems.notFound();
  requireActive(user);
  if (current.status !== 'VISIBLE') throw ReviewProblems.locked();

  const next = {
    rating: input.rating ?? current.rating,
    containsSpoilers: input.containsSpoilers ?? current.containsSpoilers,
    body: current.body,
  };
  let held = false;
  if (input.body !== undefined) {
    const c = cleanBody(input.body);
    next.body = c.body;
    held = c.held;
  }
  const changed =
    next.body !== current.body ||
    next.rating !== current.rating ||
    next.containsSpoilers !== current.containsSpoilers;
  if (changed) {
    const r = await db().review.updateMany({
      where: { id: reviewId, userId: user.id, status: 'VISIBLE' },
      data: {
        ...next,
        editedAt: new Date(),
        ...(held ? { status: 'AUTO_HIDDEN', heldReason: 'LINKS' } : {}),
      },
    });
    if (r.count === 0) throw ReviewProblems.locked();
  }
  const row = await db().review.findUniqueOrThrow({
    where: { id: reviewId },
    select: reviewSelect,
  });
  return toOwnReview(row, user.id);
}

/** Owner delete (likes and reports go with it). A REMOVED review stays — it keeps the slot. */
export async function deleteReview(user: User, reviewId: string): Promise<void> {
  const r = await db().review.deleteMany({
    where: { id: reviewId, userId: user.id, status: { not: 'REMOVED' } },
  });
  if (r.count === 1) return;
  const exists = await db().review.count({ where: { id: reviewId, userId: user.id } });
  throw exists ? ReviewProblems.locked() : Problems.notFound();
}

async function visibleReview(reviewId: string) {
  const review = await db().review.findFirst({
    where: { AND: [PUBLIC_REVIEW, { id: reviewId }] },
    select: { id: true, userId: true },
  });
  if (!review) throw Problems.notFound();
  return review;
}

export async function setLike(
  user: User,
  reviewId: string,
  liked: boolean,
): Promise<{ liked: boolean; likeCount: number }> {
  const review = await visibleReview(reviewId);
  if (review.userId === user.id) throw ReviewProblems.own();
  requireActive(user, false);
  if (liked) {
    // idempotent: ON CONFLICT DO NOTHING; the trigger counts only rows actually inserted
    await db().reviewLike.createMany({
      data: [{ userId: user.id, reviewId }],
      skipDuplicates: true,
    });
  } else {
    await db().reviewLike.deleteMany({ where: { userId: user.id, reviewId } });
  }
  const { likeCount } = await db().review.findUniqueOrThrow({
    where: { id: reviewId },
    select: { likeCount: true },
  });
  return { liked, likeCount };
}

/**
 * Report (one per user per review, idempotent). The report INSERT fires the counter trigger,
 * which row-locks the review until commit, so concurrent reports are counted one after another:
 * the third report from distinct accounts ≥ 7 days old hides the review exactly once.
 */
export async function reportReview(
  user: User,
  reviewId: string,
  input: z.output<typeof reportInput>,
  audit: Audit,
  now = new Date(),
): Promise<{ received: true }> {
  const review = await visibleReview(reviewId);
  if (review.userId === user.id) throw ReviewProblems.own();
  requireActive(user, false);
  if (now.getTime() - user.createdAt.getTime() < REPORT_MIN_ACCOUNT_AGE_MS) {
    throw ReviewProblems.tooNew();
  }
  let note: string | null = null;
  if (input.note !== undefined) {
    note = plainText(input.note, { multiline: true }) || null;
    if (note && codePointLength(note) > REPORT_NOTE_MAX) {
      throw ReviewProblems.text('note', `Use no máximo ${REPORT_NOTE_MAX} caracteres.`);
    }
  }

  try {
    await db().$transaction(async (tx) => {
      await tx.reviewReport.create({
        data: { reviewId, reporterId: user.id, reason: input.reason, note },
      });
      const eligible = await tx.reviewReport.count({
        where: {
          reviewId,
          status: 'OPEN',
          reporter: {
            status: 'ACTIVE',
            createdAt: { lte: new Date(now.getTime() - AUTO_HIDE_ACCOUNT_AGE_MS) },
          },
        },
      });
      if (eligible < AUTO_HIDE_REPORTS) return;
      const hidden = await tx.review.updateMany({
        where: { id: reviewId, status: 'VISIBLE' },
        data: { status: 'AUTO_HIDDEN', heldReason: 'REPORTS' },
      });
      if (hidden.count === 1) {
        await audit(
          {
            action: 'review.autohide',
            targetType: 'review',
            targetId: reviewId,
            metadata: { reports: eligible },
          },
          tx,
        );
      }
    });
  } catch (err) {
    // already reported by this user: same answer, nothing counted twice
    if (!isUnique(err)) throw err;
  }
  return { received: true };
}
