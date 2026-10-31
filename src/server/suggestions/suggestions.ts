import 'server-only';
import type { ItemKind, Role, SuggestionStatus, User } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { HttpError, Problems } from '../http/problem';
import { codePointLength, plainText } from '../text/sanitize';

/**
 * Viewer suggestions (Phase 6): a signed-in viewer suggests a title for the live; only moderators
 * and the streamer see them (Admin › Sugestões) and mark each one accepted or dismissed. Nothing
 * is public, so nothing needs moderation. Reviewed suggestions are deleted after 12 months (LGPD);
 * erasing an account deletes its suggestions at once.
 */
export const SUGGESTION_TITLE_MAX = 120;
export const SUGGESTION_NOTE_MAX = 280;
/** Waiting suggestions per viewer (on top of the rate limit). */
export const SUGGESTION_OPEN_MAX = 10;
export const SUGGESTION_RETENTION_MS = 365 * 86_400_000;

type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export const SuggestionProblems = {
  onboarding: () =>
    new HttpError(409, 'ONBOARDING_REQUIRED', 'Escolha seu nome de usuário antes de sugerir.'),
  suspended: () =>
    new HttpError(403, 'ACCOUNT_SUSPENDED', 'Sua conta está suspensa e não pode enviar sugestões.'),
  duplicate: () =>
    new HttpError(
      409,
      'SUGGESTION_DUPLICATE',
      'Você já sugeriu este título. Ele está esperando a moderação.',
    ),
  tooMany: () =>
    new HttpError(
      409,
      'SUGGESTION_LIMIT',
      `Você tem ${SUGGESTION_OPEN_MAX} sugestões esperando. Aguarde a moderação ver algumas.`,
    ),
  changed: () =>
    new HttpError(409, 'SUGGESTION_CHANGED', 'Outra pessoa já decidiu esta sugestão. Recarregue.'),
};

/** "O Senhor dos Anéis: A Sociedade do Anel" → "o senhor dos aneis a sociedade do anel". */
export function titleKeyOf(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, SUGGESTION_TITLE_MAX)
    .trim();
}

function clean(raw: string | null | undefined, path: string, max: number, required: boolean) {
  const v = raw === null || raw === undefined ? '' : plainText(raw, { multiline: path === 'note' });
  if (!v) {
    if (required) throw Problems.validation([{ path, message: 'Preencha este campo.' }]);
    return null;
  }
  if (codePointLength(v) > max)
    throw Problems.validation([{ path, message: `Use no máximo ${max} caracteres.` }]);
  return v;
}

export type MySuggestion = {
  id: string;
  kind: ItemKind;
  title: string;
  year: number | null;
  status: SuggestionStatus;
  createdAt: string;
};

export async function mySuggestions(userId: string): Promise<MySuggestion[]> {
  const rows = await db().suggestion.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, kind: true, title: true, year: true, status: true, createdAt: true },
  });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function submitSuggestion(
  user: Pick<User, 'id' | 'username' | 'status'>,
  input: { kind: ItemKind; title: string; year?: number | null | undefined; note?: string | null },
): Promise<{ mine: MySuggestion[] }> {
  if (!user.username) throw SuggestionProblems.onboarding();
  if (user.status !== 'ACTIVE') throw SuggestionProblems.suspended();
  const title = clean(input.title, 'title', SUGGESTION_TITLE_MAX, true)!;
  const titleKey = titleKeyOf(title);
  if (!titleKey) {
    throw Problems.validation([{ path: 'title', message: 'Escreva o nome do título.' }]);
  }
  const note = clean(input.note, 'note', SUGGESTION_NOTE_MAX, false);
  const open = await db().suggestion.count({ where: { userId: user.id, status: 'NEW' } });
  if (open >= SUGGESTION_OPEN_MAX) throw SuggestionProblems.tooMany();
  try {
    await db().suggestion.create({
      data: {
        userId: user.id,
        kind: input.kind,
        title,
        titleKey,
        year: input.year ?? null,
        note,
      },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002' || pgErrorCode(err) === PG.uniqueViolation) {
      throw SuggestionProblems.duplicate();
    }
    throw err;
  }
  return { mine: await mySuggestions(user.id) };
}

// ── staff (moderators and the streamer) ──

export type StaffSuggestion = {
  id: string;
  kind: ItemKind;
  title: string;
  year: number | null;
  note: string | null;
  status: SuggestionStatus;
  createdAt: string;
  reviewedAt: string | null;
  author: string | null;
  reviewer: string | null;
  /** other viewers waiting with the same title */
  alsoSuggested: number;
};

export async function listSuggestions(q: {
  status?: SuggestionStatus | undefined;
  before?: string | undefined;
}): Promise<{ suggestions: StaffSuggestion[]; next: string | null; waiting: number }> {
  const status = q.status ?? 'NEW';
  const rows = await db().suggestion.findMany({
    where: { status, ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 31,
    include: {
      user: { select: { username: true } },
      reviewedBy: { select: { username: true } },
    },
  });
  const more = rows.length > 30;
  const shown = rows.slice(0, 30);
  const keys = [...new Set(shown.map((r) => r.titleKey))];
  const groups = keys.length
    ? await db().suggestion.groupBy({
        by: ['titleKey'],
        where: { titleKey: { in: keys }, status: 'NEW' },
        _count: { _all: true },
      })
    : [];
  const waitingByKey = new Map(groups.map((g) => [g.titleKey, g._count._all]));
  return {
    suggestions: shown.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      year: r.year,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      author: r.user.username,
      reviewer: r.reviewedBy?.username ?? null,
      alsoSuggested: Math.max(
        0,
        (waitingByKey.get(r.titleKey) ?? 0) - (r.status === 'NEW' ? 1 : 0),
      ),
    })),
    next: more ? shown.at(-1)!.createdAt.toISOString() : null,
    waiting: await db().suggestion.count({ where: { status: 'NEW' } }),
  };
}

/**
 * Accept, dismiss or reopen — compare-and-set on the status the moderator saw, so two moderators
 * deciding at once can't overwrite each other silently.
 */
export async function setSuggestionStatus(
  ctx: Ctx,
  id: string,
  input: { status: SuggestionStatus; expectedStatus: SuggestionStatus },
  now = new Date(),
): Promise<void> {
  if (input.status === input.expectedStatus) return;
  await db()
    .$transaction(async (t) => {
      const res = await t.suggestion.updateMany({
        where: { id, status: input.expectedStatus },
        data:
          input.status === 'NEW'
            ? { status: 'NEW', reviewedAt: null, reviewedById: null }
            : { status: input.status, reviewedAt: now, reviewedById: ctx.actor.id },
      });
      if (res.count !== 1) {
        const exists = await t.suggestion.count({ where: { id } });
        throw exists ? SuggestionProblems.changed() : Problems.notFound();
      }
      await audit(
        {
          action: 'suggestion.status',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'Suggestion',
          targetId: id,
          metadata: { from: input.expectedStatus, to: input.status },
        },
        t,
      );
    })
    .catch((err: unknown) => {
      // reopening while the same viewer already waits with the same title
      if ((err as { code?: string })?.code === 'P2002' || pgErrorCode(err) === PG.uniqueViolation)
        throw SuggestionProblems.changed();
      throw err;
    });
}

/** Worker: LGPD retention — decided suggestions go after 12 months; waiting ones stay. */
export async function purgeSuggestions(now = new Date()): Promise<number> {
  const res = await db().suggestion.deleteMany({
    where: {
      status: { not: 'NEW' },
      reviewedAt: { lt: new Date(now.getTime() - SUGGESTION_RETENTION_MS) },
    },
  });
  return res.count;
}
