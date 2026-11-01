import 'server-only';
import type { Role } from '@/generated/prisma/client';
import { type Picture, pictureFrom } from '@/lib/media';
import { audit } from '../audit/audit';
import { db } from '../db';
import { Problems } from '../http/problem';
import { codePointLength, plainText } from '../text/sanitize';

/**
 * "Próximas temporadas" (2026-11-01): when the next season of a series comes out, shown on the
 * Cronograma and kept by moderators in Admin › Estreias. A series from the catalog lends its
 * poster and page; any other series is just a name. Release days are calendar days (DATE).
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

/** Releases from this many days ago still show on the Cronograma, as "Estreou". */
export const RELEASE_RECENT_DAYS = 7;
export const RELEASE_PUBLIC_MAX = 12;

const PUBLIC_SERIES = ['ACTIVE', 'FUNDED', 'WATCHED'] as const;

const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** Today in São Paulo as a UTC-midnight Date (how Prisma reads a DATE column). */
export function todaySaoPaulo(now = new Date()): Date {
  return new Date(`${dayKey.format(now)}T00:00:00.000Z`);
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type PublicRelease = {
  id: string;
  title: string;
  seasonLabel: string;
  releaseDate: string; // YYYY-MM-DD
  note: string | null;
  released: boolean;
  /** the catalog page, when the series is linked and public */
  href: string | null;
  poster: Picture | null;
};

const mediaSelect = { select: { width: true, height: true, variants: true } } as const;

/** Cronograma: from a week ago on, soonest first. */
export async function publicReleases(now = new Date()): Promise<PublicRelease[]> {
  const today = todaySaoPaulo(now);
  const from = new Date(today.getTime() - RELEASE_RECENT_DAYS * 86_400_000);
  const rows = await db().seasonRelease.findMany({
    where: { releaseDate: { gte: from } },
    orderBy: [{ releaseDate: 'asc' }, { title: 'asc' }],
    take: RELEASE_PUBLIC_MAX,
    include: {
      item: { select: { slug: true, status: true, watchedAt: true, poster: mediaSelect } },
    },
  });
  return rows.map((r) => {
    const visible =
      !!r.item &&
      ((PUBLIC_SERIES as readonly string[]).includes(r.item.status) ||
        (r.item.status === 'ARCHIVED' && r.item.watchedAt !== null));
    return {
      id: r.id,
      title: r.title,
      seasonLabel: r.seasonLabel,
      releaseDate: isoDay(r.releaseDate),
      note: r.note,
      released: r.releaseDate.getTime() <= today.getTime(),
      href: visible ? `/series/${r.item!.slug}` : null,
      poster: visible ? pictureFrom(r.item!.poster) : null,
    };
  });
}

export type AdminRelease = {
  id: string;
  itemId: string | null;
  itemTitle: string | null;
  title: string;
  seasonLabel: string;
  releaseDate: string;
  note: string | null;
  editor: string | null;
  updatedAt: string;
};

/** Dashboard: everything, soonest first; past releases older than 60 days are left out. */
export async function listReleases(now = new Date()): Promise<AdminRelease[]> {
  const from = new Date(todaySaoPaulo(now).getTime() - 60 * 86_400_000);
  const rows = await db().seasonRelease.findMany({
    where: { releaseDate: { gte: from } },
    orderBy: [{ releaseDate: 'asc' }, { title: 'asc' }],
    take: 200,
    include: adminInclude,
  });
  return rows.map(toAdmin);
}

const adminInclude = {
  item: { select: { title: true } },
  editedBy: { select: { username: true } },
} as const;

function toAdmin(r: {
  id: string;
  itemId: string | null;
  title: string;
  seasonLabel: string;
  releaseDate: Date;
  note: string | null;
  updatedAt: Date;
  item: { title: string } | null;
  editedBy: { username: string | null };
}): AdminRelease {
  return {
    id: r.id,
    itemId: r.itemId,
    itemTitle: r.item?.title ?? null,
    title: r.title,
    seasonLabel: r.seasonLabel,
    releaseDate: isoDay(r.releaseDate),
    note: r.note,
    editor: r.editedBy.username,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Series the dashboard can link to (anything but archived-unwatched drafts). */
export async function linkableSeries() {
  return db().catalogItem.findMany({
    where: {
      kind: 'SERIES',
      OR: [{ status: { not: 'ARCHIVED' } }, { watchedAt: { not: null } }],
    },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, status: true },
    take: 300,
  });
}

function text(raw: string | null | undefined, path: string, max: number, required: boolean) {
  const v = raw === null || raw === undefined ? '' : plainText(raw);
  if (!v) {
    if (required) throw Problems.validation([{ path, message: 'Preencha este campo.' }]);
    return null;
  }
  if (codePointLength(v) > max)
    throw Problems.validation([{ path, message: `Use no máximo ${max} caracteres.` }]);
  return v;
}

async function seriesTitle(itemId: string): Promise<string> {
  const item = await db().catalogItem.findUnique({
    where: { id: itemId },
    select: { kind: true, title: true },
  });
  if (!item || item.kind !== 'SERIES') {
    throw Problems.validation([{ path: 'itemId', message: 'Escolha uma série do catálogo.' }]);
  }
  return item.title;
}

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

export type ReleaseInput = {
  itemId?: string | null | undefined;
  title?: string | null | undefined;
  seasonLabel?: string | undefined;
  releaseDate?: string | undefined;
  note?: string | null | undefined;
};

export async function createRelease(ctx: Ctx, input: ReleaseInput): Promise<AdminRelease> {
  const itemId = input.itemId ?? null;
  // a linked series names itself unless the moderator typed something else
  const linkedTitle = itemId ? await seriesTitle(itemId) : null;
  const title = text(input.title, 'title', 120, !itemId) ?? linkedTitle!;
  const data = {
    itemId,
    title,
    seasonLabel: text(input.seasonLabel, 'seasonLabel', 40, true)!,
    releaseDate: day(input.releaseDate!),
    note: text(input.note, 'note', 80, false),
    editedById: ctx.actor.id,
  };
  return db().$transaction(async (t) => {
    const r = await t.seasonRelease.create({ data, include: adminInclude });
    await audit(
      {
        action: 'release.create',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'SeasonRelease',
        targetId: r.id,
        metadata: { linked: !!itemId },
      },
      t,
    );
    return toAdmin(r);
  });
}

export async function updateRelease(ctx: Ctx, id: string, input: ReleaseInput): Promise<void> {
  const data: {
    itemId?: string | null;
    title?: string;
    seasonLabel?: string;
    releaseDate?: Date;
    note?: string | null;
  } = {};
  if (input.itemId !== undefined) {
    if (input.itemId) await seriesTitle(input.itemId);
    data.itemId = input.itemId;
  }
  if (input.title !== undefined) {
    const t =
      text(input.title, 'title', 120, false) ??
      (input.itemId ? await seriesTitle(input.itemId) : null);
    if (!t) throw Problems.validation([{ path: 'title', message: 'Preencha este campo.' }]);
    data.title = t;
  }
  if (input.seasonLabel !== undefined)
    data.seasonLabel = text(input.seasonLabel, 'seasonLabel', 40, true)!;
  if (input.releaseDate !== undefined) data.releaseDate = day(input.releaseDate);
  if (input.note !== undefined) data.note = text(input.note, 'note', 80, false);
  const fields = Object.keys(data) as (keyof typeof data)[];
  if (!fields.length) throw Problems.validation([{ path: '', message: 'Nada para mudar.' }]);
  await db().$transaction(async (t) => {
    const res = await t.seasonRelease.updateMany({
      where: { id },
      data: { ...data, editedById: ctx.actor.id },
    });
    if (res.count !== 1) throw Problems.notFound();
    await audit(
      {
        action: 'release.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'SeasonRelease',
        targetId: id,
        metadata: { fields },
      },
      t,
    );
  });
}

export async function deleteRelease(ctx: Ctx, id: string): Promise<void> {
  await db().$transaction(async (t) => {
    const res = await t.seasonRelease.deleteMany({ where: { id } });
    if (res.count !== 1) throw Problems.notFound();
    await audit(
      {
        action: 'release.delete',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'SeasonRelease',
        targetId: id,
        metadata: {},
      },
      t,
    );
  });
}
