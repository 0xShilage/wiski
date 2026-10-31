import 'server-only';
import type { Role, SocialLink } from '@/generated/prisma/client';
import {
  cleanLinkUrl,
  displayHost,
  LINK_LABEL_MAX,
  LINK_MAX,
  LINK_NOTE_MAX,
  platformOf,
} from '@/lib/links';
import { audit } from '../audit/audit';
import { db } from '../db';
import { pgErrorCode, PG } from '../db-errors';
import { HttpError, Problems } from '../http/problem';
import { codePointLength, plainText } from '../text/sanitize';

/**
 * The Links page (Phase 6): the streamer's link-in-bio list. STREAMER edits it in the dashboard;
 * `/links` shows the visible ones in order. Positions are 1…n without gaps (unique, deferred).
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export const LinkProblems = {
  full: () =>
    new HttpError(409, 'LINKS_FULL', `A página já tem ${LINK_MAX} links. Apague um antes.`),
  changed: () =>
    new HttpError(
      409,
      'LINKS_CHANGED',
      'A lista mudou em outra aba. Recarregue a página e tente de novo.',
    ),
};

export type LinkView = {
  id: string;
  label: string;
  note: string | null;
  url: string;
  visible: boolean;
  position: number;
  platform: string | null;
  host: string;
};

function view(l: SocialLink): LinkView {
  return {
    id: l.id,
    label: l.label,
    note: l.note,
    url: l.url,
    visible: l.visible,
    position: l.position,
    platform: platformOf(l.url),
    host: displayHost(l.url),
  };
}

/** Public page: visible links only. */
export async function publicLinks(): Promise<LinkView[]> {
  const rows = await db().socialLink.findMany({
    where: { visible: true },
    orderBy: { position: 'asc' },
  });
  return rows.map(view);
}

/** Dashboard: every link, hidden ones too. */
export async function listLinks(): Promise<LinkView[]> {
  const rows = await db().socialLink.findMany({ orderBy: { position: 'asc' } });
  return rows.map(view);
}

function text(raw: string, path: string, max: number): string {
  const v = plainText(raw);
  if (!v) throw Problems.validation([{ path, message: 'Preencha este campo.' }]);
  if (codePointLength(v) > max)
    throw Problems.validation([{ path, message: `Use no máximo ${max} caracteres.` }]);
  return v;
}

function optionalText(raw: string | null | undefined, path: string, max: number) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const v = plainText(raw);
  if (!v) return null;
  if (codePointLength(v) > max)
    throw Problems.validation([{ path, message: `Use no máximo ${max} caracteres.` }]);
  return v;
}

function url(raw: string): string {
  const u = cleanLinkUrl(raw);
  if (!u) {
    throw Problems.validation([
      {
        path: 'url',
        message: 'Use um endereço https:// completo, como https://twitch.tv/seu_canal.',
      },
    ]);
  }
  return u;
}

/** Position races (two tabs adding at once) surface as the deferred unique at COMMIT. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (pgErrorCode(err) === PG.uniqueViolation) throw LinkProblems.changed();
    if (pgErrorCode(err) === PG.checkViolation) throw LinkProblems.full();
    throw err;
  }
}

export async function createLink(
  ctx: Ctx,
  input: {
    label: string;
    note?: string | null | undefined;
    url: string;
    visible?: boolean | undefined;
  },
): Promise<LinkView> {
  const data = {
    label: text(input.label, 'label', LINK_LABEL_MAX),
    note: optionalText(input.note, 'note', LINK_NOTE_MAX) ?? null,
    url: url(input.url),
    visible: input.visible ?? true,
  };
  return guarded(() =>
    db().$transaction(async (t) => {
      const count = await t.socialLink.count();
      if (count >= LINK_MAX) throw LinkProblems.full();
      const row = await t.socialLink.create({ data: { ...data, position: count + 1 } });
      await audit(
        {
          action: 'link.create',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'SocialLink',
          targetId: row.id,
          metadata: { visible: row.visible },
        },
        t,
      );
      return view(row);
    }),
  );
}

export async function updateLink(
  ctx: Ctx,
  id: string,
  input: {
    label?: string | undefined;
    note?: string | null | undefined;
    url?: string | undefined;
    visible?: boolean | undefined;
  },
): Promise<LinkView> {
  const data: { label?: string; note?: string | null; url?: string; visible?: boolean } = {};
  if (input.label !== undefined) data.label = text(input.label, 'label', LINK_LABEL_MAX);
  const note = optionalText(input.note, 'note', LINK_NOTE_MAX);
  if (note !== undefined) data.note = note;
  if (input.url !== undefined) data.url = url(input.url);
  if (input.visible !== undefined) data.visible = input.visible;
  const fields = Object.keys(data) as ('label' | 'note' | 'url' | 'visible')[];
  if (!fields.length) throw Problems.validation([{ path: '', message: 'Nada para mudar.' }]);
  return db().$transaction(async (t) => {
    const res = await t.socialLink.updateMany({ where: { id }, data });
    if (res.count !== 1) throw Problems.notFound();
    await audit(
      {
        action: 'link.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'SocialLink',
        targetId: id,
        metadata: { fields },
      },
      t,
    );
    return view(await t.socialLink.findUniqueOrThrow({ where: { id } }));
  });
}

/** Delete, then close the gap (positions stay 1…n). */
export async function deleteLink(ctx: Ctx, id: string): Promise<void> {
  await guarded(() =>
    db().$transaction(async (t) => {
      const gone = await t.socialLink.findUnique({ where: { id } });
      if (!gone) throw Problems.notFound();
      await t.socialLink.delete({ where: { id } });
      await t.socialLink.updateMany({
        where: { position: { gt: gone.position } },
        data: { position: { decrement: 1 } },
      });
      await audit(
        {
          action: 'link.delete',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'SocialLink',
          targetId: id,
          metadata: {},
        },
        t,
      );
    }),
  );
}

/** New order: `ids` must be exactly the current links (any other set → 409, reload). */
export async function reorderLinks(ctx: Ctx, ids: string[]): Promise<LinkView[]> {
  return guarded(() =>
    db().$transaction(async (t) => {
      const rows = await t.socialLink.findMany({ select: { id: true } });
      const current = new Set(rows.map((r) => r.id));
      if (
        ids.length !== current.size ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !current.has(id))
      ) {
        throw LinkProblems.changed();
      }
      // the unique on position is deferred: the permutation is checked once, at COMMIT
      for (const [i, id] of ids.entries()) {
        await t.socialLink.update({ where: { id }, data: { position: i + 1 } });
      }
      await audit(
        {
          action: 'link.reorder',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'SocialLink',
          targetId: null,
          metadata: { count: ids.length },
        },
        t,
      );
      const out = await t.socialLink.findMany({ orderBy: { position: 'asc' } });
      return out.map(view);
    }),
  );
}
