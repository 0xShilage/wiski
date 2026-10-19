import 'server-only';
import type { CatalogItem, Prisma, Role } from '@/generated/prisma/client';
import type { ItemKind, MediaRole } from '@/generated/prisma/enums';
import { LIVE_STATUSES } from '@/lib/catalog/kinds';
import { LIVE_LIMIT, MOVIE_MAX_RUNTIME } from '@/lib/catalog/pricing';
import { slugify } from '@/lib/catalog/slug';
import { audit } from '../audit/audit';
import { db } from '../db';
import { PG, pgErrorCode } from '../db-errors';
import { HttpError, type ProblemField, Problems } from '../http/problem';
import type { ItemFieldsInput } from './input';
import { type CatalogSnapshot, changedFields, snapshotOf, snapshotSchema } from './snapshot';

/**
 * Catalog services for the moderator dashboard (11 §4, §8). Every write runs in one READ COMMITTED
 * transaction with its audit row; content changes bump `version` (optimistic concurrency, 409 on a
 * stale version) and store a CatalogRevision with the full snapshot (one-click revert).
 * Live limits and slot uniqueness are enforced by the database (R1 reviewed SQL) and mapped here.
 */
export type Actor = { id: string; role: Role };
type Ctx = { actor: Actor; requestId: string | null };
type Tx = Prisma.TransactionClient;

const live = [...LIVE_STATUSES];

export const CatalogProblems = {
  versionConflict: (current: number) =>
    new HttpError(
      409,
      'VERSION_CONFLICT',
      'Outra pessoa salvou este título enquanto você editava. Recarregue para ver a versão atual.',
      { members: { currentVersion: String(current) } },
    ),
  full: (kind: ItemKind) =>
    new HttpError(
      409,
      'CATALOG_FULL',
      `O limite de ${LIVE_LIMIT[kind]} ${kind === 'MOVIE' ? 'filmes' : kind === 'SERIES' ? 'séries' : 'franquias'} no ar foi atingido. Substitua um título antes.`,
    ),
  slotTaken: () => new HttpError(409, 'SLOT_TAKEN', 'Esta vaga já está ocupada.'),
  invalidState: (detail: string) => new HttpError(409, 'INVALID_STATE', detail),
  incomplete: (errors: ProblemField[]) =>
    new HttpError(422, 'INCOMPLETE', 'Preencha os campos obrigatórios antes de publicar.', {
      errors,
    }),
};

/** Map reviewed-SQL errors to problems (anything else is re-thrown → 500). */
export function mapDbError(err: unknown, kind: ItemKind): never {
  const code = pgErrorCode(err);
  if (code === PG.catalogLiveLimit) throw CatalogProblems.full(kind);
  if (code === PG.exclusionViolation) throw CatalogProblems.slotTaken();
  throw err;
}

async function tx<T>(kind: ItemKind, fn: (t: Tx) => Promise<T>): Promise<T> {
  try {
    return await db().$transaction(fn, { isolationLevel: 'ReadCommitted', timeout: 10_000 });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    return mapDbError(err, kind);
  }
}

// ── validation helpers ──────────────────────────────────────────────────────────

const MEDIA_ROLE: Record<'posterId' | 'backdropId' | 'logoId', MediaRole> = {
  posterId: 'POSTER',
  backdropId: 'BACKDROP',
  logoId: 'LOGO',
};

async function checkKindFields(t: Tx, kind: ItemKind, f: ItemFieldsInput): Promise<void> {
  const errors: ProblemField[] = [];
  if (kind !== 'SERIES') {
    for (const k of ['seasonsLabel', 'seasonCount', 'episodeCount'] as const) {
      if (f[k] !== undefined && f[k] !== null) errors.push({ path: k, message: 'Só para séries.' });
    }
  }
  if (kind !== 'FRANCHISE' && f.franchiseEntries?.length) {
    errors.push({ path: 'franchiseEntries', message: 'Só para franquias.' });
  }
  if (kind === 'MOVIE' && f.runtimeMinutes !== undefined && f.runtimeMinutes > MOVIE_MAX_RUNTIME) {
    errors.push({ path: 'runtimeMinutes', message: `Máximo de ${MOVIE_MAX_RUNTIME} minutos.` });
  }
  if (f.slot !== undefined && f.slot !== null && f.slot > LIVE_LIMIT[kind]) {
    errors.push({ path: 'slot', message: `Vagas de 1 a ${LIVE_LIMIT[kind]}.` });
  }
  for (const key of ['posterId', 'backdropId', 'logoId'] as const) {
    const id = f[key];
    if (!id) continue;
    const asset = await t.mediaAsset.findUnique({ where: { id }, select: { role: true } });
    if (!asset || asset.role !== MEDIA_ROLE[key]) {
      errors.push({ path: key, message: 'Imagem inválida para este campo.' });
    }
  }
  if (errors.length) throw Problems.validation(errors);
}

/** Data for CatalogItem from the (already sanitised) fields; franchise runtime = Σ films. */
function itemData(f: ItemFieldsInput) {
  const { trailer, franchiseEntries, ...rest } = f;
  // Drop undefined keys (exactOptionalPropertyTypes): absent = unchanged.
  const data = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Prisma.CatalogItemUncheckedUpdateInput;
  if (trailer !== undefined) data.trailerYoutubeId = trailer;
  if (franchiseEntries?.length) {
    data.runtimeMinutes = franchiseEntries.reduce((s, e) => s + e.runtimeMinutes, 0);
  }
  return data;
}

async function replaceEntries(t: Tx, itemId: string, entries: ItemFieldsInput['franchiseEntries']) {
  if (entries === undefined) return;
  await t.franchiseEntry.deleteMany({ where: { franchiseId: itemId } });
  if (entries.length) {
    await t.franchiseEntry.createMany({
      data: entries.map((e, i) => ({
        franchiseId: itemId,
        position: i + 1,
        title: e.title,
        year: e.year ?? null,
        runtimeMinutes: e.runtimeMinutes,
      })),
    });
  }
}

async function snapshotFor(
  t: Tx,
  itemId: string,
): Promise<{ item: CatalogItem; snap: CatalogSnapshot }> {
  const item = await t.catalogItem.findUniqueOrThrow({ where: { id: itemId } });
  const entries = await t.franchiseEntry.findMany({ where: { franchiseId: itemId } });
  return { item, snap: snapshotOf(item, entries) };
}

async function uniqueSlug(t: Tx, title: string): Promise<string> {
  const base = slugify(title);
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await t.catalogItem.findUnique({ where: { slug: candidate }, select: { id: true } }))) {
      return candidate;
    }
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Bump the version only if nobody else saved in between (compare-and-set). */
async function bumpVersion(t: Tx, item: Pick<CatalogItem, 'id' | 'version'>, expected: number) {
  const res = await t.catalogItem.updateMany({
    where: { id: item.id, version: expected },
    data: { version: { increment: 1 } },
  });
  if (res.count !== 1) throw CatalogProblems.versionConflict(item.version);
  return expected + 1;
}

// ── commands ────────────────────────────────────────────────────────────────────

export async function createItem(
  ctx: Ctx,
  input: ItemFieldsInput & { kind: ItemKind; title: string; runtimeMinutes: number },
) {
  const { kind, ...fields } = input;
  return tx(kind, async (t) => {
    await checkKindFields(t, kind, fields);
    const data = itemData(fields);
    const item = await t.catalogItem.create({
      data: {
        ...(data as Prisma.CatalogItemUncheckedCreateInput),
        kind,
        title: input.title,
        runtimeMinutes: (data.runtimeMinutes as number | undefined) ?? input.runtimeMinutes,
        synopsis: fields.synopsis ?? '',
        genres: fields.genres ?? [],
        cast: fields.cast ?? [],
        slug: await uniqueSlug(t, input.title),
        createdById: ctx.actor.id,
        version: 1,
      },
    });
    await replaceEntries(t, item.id, fields.franchiseEntries);
    const { snap } = await snapshotFor(t, item.id);
    await t.catalogRevision.create({
      data: { itemId: item.id, version: 1, snapshot: snap, note: 'create', editorId: ctx.actor.id },
    });
    await audit(
      {
        action: 'catalog.create',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'CatalogItem',
        targetId: item.id,
        metadata: { kind, version: 1 },
      },
      t,
    );
    return item;
  });
}

export async function saveItem(
  ctx: Ctx,
  id: string,
  expectedVersion: number,
  fields: ItemFieldsInput,
  note = 'save',
) {
  const current = await db().catalogItem.findUnique({ where: { id } });
  if (!current) throw Problems.notFound();
  if (current.status === 'ARCHIVED') {
    throw CatalogProblems.invalidState('Títulos arquivados não podem ser editados.');
  }
  return tx(current.kind, async (t) => {
    await checkKindFields(t, current.kind, fields);
    const before = await snapshotFor(t, id);
    const version = await bumpVersion(t, current, expectedVersion);
    if (fields.slot !== undefined && before.item.status !== 'DRAFT') {
      // Live slots move only through the slot board (reorder) — keep them out of content saves.
      delete fields.slot;
    }
    await t.catalogItem.update({ where: { id }, data: itemData(fields) });
    await replaceEntries(t, id, fields.franchiseEntries);
    const after = await snapshotFor(t, id);
    await t.catalogRevision.create({
      data: { itemId: id, version, snapshot: after.snap, note, editorId: ctx.actor.id },
    });
    const fieldsChanged = changedFields(before.snap, after.snap) as never[];
    if (note.startsWith('revert:')) {
      await audit(
        {
          action: 'catalog.revert',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'CatalogItem',
          targetId: id,
          metadata: { kind: current.kind, toVersion: Number(note.slice(7)), version },
        },
        t,
      );
    } else {
      await audit(
        {
          action: 'catalog.save',
          actor: ctx.actor,
          requestId: ctx.requestId,
          targetType: 'CatalogItem',
          targetId: id,
          metadata: { kind: current.kind, version, fields: fieldsChanged },
        },
        t,
      );
    }
    return t.catalogItem.findUniqueOrThrow({ where: { id } });
  });
}

/** Revert = apply the snapshot of `toVersion` as a new save (history is never rewritten). */
export async function revertItem(ctx: Ctx, id: string, expectedVersion: number, toVersion: number) {
  const rev = await db().catalogRevision.findUnique({
    where: { itemId_version: { itemId: id, version: toVersion } },
  });
  if (!rev) throw Problems.notFound();
  const snap = snapshotSchema.parse(rev.snapshot);
  const { v: _v, trailerYoutubeId, franchiseEntries, ...rest } = snap;
  const item = await db().catalogItem.findUniqueOrThrow({ where: { id }, select: { kind: true } });
  return saveItem(
    ctx,
    id,
    expectedVersion,
    {
      ...rest,
      trailer: trailerYoutubeId,
      ...(item.kind === 'FRANCHISE'
        ? {
            franchiseEntries: franchiseEntries.map(({ title, year, runtimeMinutes }) => ({
              title,
              year,
              runtimeMinutes,
            })),
          }
        : {}),
    },
    `revert:${toVersion}`,
  );
}

/** What a public page needs before an item can go live (11 §4). */
export function missingForPublish(item: CatalogItem, entries: number): ProblemField[] {
  const miss: ProblemField[] = [];
  const need = (ok: unknown, path: string, message: string) => {
    if (!ok) miss.push({ path, message });
  };
  need(item.synopsis.trim(), 'synopsis', 'Escreva a sinopse.');
  need(item.ageRating, 'ageRating', 'Escolha a classificação indicativa.');
  need(item.year, 'year', 'Informe o ano.');
  need(item.genres.length, 'genres', 'Adicione pelo menos um gênero.');
  need(item.posterId, 'posterId', 'Envie o pôster (2:3).');
  need(item.backdropId, 'backdropId', 'Envie a imagem de fundo (16:9).');
  if (item.kind === 'SERIES') {
    need(item.seasonCount, 'seasonCount', 'Informe quantas temporadas estão incluídas.');
    need(item.seasonsLabel, 'seasonsLabel', 'Descreva as temporadas (ex.: "Temporadas 1–3").');
  }
  if (item.kind === 'FRANCHISE')
    need(entries >= 2, 'franchiseEntries', 'Liste pelo menos 2 filmes.');
  return miss;
}

async function freeSlot(t: Tx, kind: ItemKind, wanted: number | null | undefined): Promise<number> {
  const taken = new Set(
    (
      await t.catalogItem.findMany({
        where: { kind, status: { in: live }, slot: { not: null } },
        select: { slot: true },
      })
    ).map((r) => r.slot as number),
  );
  if (taken.size >= LIVE_LIMIT[kind]) throw CatalogProblems.full(kind);
  if (wanted) {
    if (wanted > LIVE_LIMIT[kind])
      throw Problems.validation([{ path: 'slot', message: 'Vaga inválida.' }]);
    if (taken.has(wanted)) throw CatalogProblems.slotTaken();
    return wanted;
  }
  for (let s = 1; s <= LIVE_LIMIT[kind]; s++) if (!taken.has(s)) return s;
  throw CatalogProblems.full(kind);
}

/** Put a complete item live in `slot` (inside the caller's transaction). */
async function goLive(t: Tx, item: CatalogItem, slot: number | null | undefined, now: Date) {
  const entries = await t.franchiseEntry.count({ where: { franchiseId: item.id } });
  const miss = missingForPublish(item, entries);
  if (miss.length) throw CatalogProblems.incomplete(miss);
  const finalSlot = await freeSlot(t, item.kind, slot ?? item.slot);
  const res = await t.catalogItem.updateMany({
    where: { id: item.id, status: 'DRAFT', version: item.version },
    data: { status: 'ACTIVE', slot: finalSlot, publishedAt: item.publishedAt ?? now },
  });
  if (res.count !== 1) throw CatalogProblems.versionConflict(item.version);
  return finalSlot;
}

/** Moderators publish MOVIES directly; campaigns are opened by the streamer (campaigns.ts). */
export async function publishMovie(
  ctx: Ctx,
  id: string,
  expectedVersion: number,
  slot: number | undefined,
  now = new Date(),
) {
  const item = await db().catalogItem.findUnique({ where: { id } });
  if (!item) throw Problems.notFound();
  if (item.kind !== 'MOVIE') {
    throw CatalogProblems.invalidState(
      'Séries e franquias entram no ar quando o streamer abre a campanha.',
    );
  }
  if (item.status !== 'DRAFT') throw CatalogProblems.invalidState('Este filme já está no ar.');
  if (item.version !== expectedVersion) throw CatalogProblems.versionConflict(item.version);
  return tx('MOVIE', async (t) => {
    const finalSlot = await goLive(t, item, slot, now);
    await audit(
      {
        action: 'catalog.publish',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'CatalogItem',
        targetId: id,
        metadata: { kind: 'MOVIE', slot: finalSlot, version: item.version },
      },
      t,
    );
    return t.catalogItem.findUniqueOrThrow({ where: { id } });
  });
}

export { goLive as goLiveInTx, freeSlot as freeSlotInTx, tx as catalogTx };

/** Reorder live items of one kind (the slot board). A permutation commits atomically. */
export async function reorderSlots(
  ctx: Ctx,
  kind: ItemKind,
  slots: readonly { id: string; slot: number }[],
) {
  const ids = slots.map((s) => s.id);
  if (new Set(ids).size !== ids.length || new Set(slots.map((s) => s.slot)).size !== slots.length) {
    throw Problems.validation([{ path: 'slots', message: 'Itens ou vagas repetidos.' }]);
  }
  if (slots.some((s) => s.slot > LIVE_LIMIT[kind])) {
    throw Problems.validation([{ path: 'slots', message: `Vagas de 1 a ${LIVE_LIMIT[kind]}.` }]);
  }
  return tx(kind, async (t) => {
    const rows = await t.catalogItem.findMany({
      where: { id: { in: ids }, kind, status: { in: live } },
      select: { id: true, slot: true },
    });
    if (rows.length !== ids.length) {
      throw Problems.validation([{ path: 'slots', message: 'Itens inválidos ou fora do ar.' }]);
    }
    const before = new Map(rows.map((r) => [r.id, r.slot]));
    let moved = 0;
    for (const s of slots) {
      if (before.get(s.id) === s.slot) continue;
      moved++;
      await t.catalogItem.update({ where: { id: s.id }, data: { slot: s.slot } });
    }
    await audit(
      {
        action: 'catalog.slots',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'CatalogItem',
        targetId: null,
        metadata: { kind, moved },
      },
      t,
    );
    return { moved };
  });
}

/**
 * "Substituir": archive a live item and free its slot; optionally a draft of the same kind takes
 * the slot (movies go live at once; series/franchises keep it as their planned slot until the
 * streamer opens the campaign). Sold or reserved movies and campaigns holding money can't be
 * replaced.
 */
export async function replaceItem(
  ctx: Ctx,
  id: string,
  replacementId: string | null,
  now = new Date(),
) {
  const item = await db().catalogItem.findUnique({ where: { id }, include: { campaign: true } });
  if (!item) throw Problems.notFound();
  if (!live.includes(item.status as (typeof live)[number])) {
    throw CatalogProblems.invalidState('Só títulos no ar podem ser substituídos.');
  }
  if (item.status === 'SPONSORED') {
    throw CatalogProblems.invalidState(
      'Este filme já foi patrocinado: marque como assistido antes.',
    );
  }
  if (item.reservedUntil && item.reservedUntil > now) {
    throw CatalogProblems.invalidState(
      'Há um Pix pendente para este filme. Aguarde até 35 minutos.',
    );
  }
  const c = item.campaign;
  if (c && c.status !== 'WATCHED' && c.raisedCents + c.reservedCents > 0) {
    throw CatalogProblems.invalidState(
      'Esta campanha já recebeu contribuições e não pode ser substituída.',
    );
  }
  return tx(item.kind, async (t) => {
    const slot = item.slot as number;
    const res = await t.catalogItem.updateMany({
      where: { id, status: item.status, version: item.version },
      data: { status: 'ARCHIVED', slot: null, archivedAt: now },
    });
    if (res.count !== 1) throw CatalogProblems.versionConflict(item.version);
    if (replacementId) {
      const draft = await t.catalogItem.findUnique({ where: { id: replacementId } });
      if (!draft || draft.kind !== item.kind || draft.status !== 'DRAFT') {
        throw Problems.validation([
          { path: 'replacementId', message: 'Escolha um rascunho do mesmo tipo.' },
        ]);
      }
      if (item.kind === 'MOVIE') {
        await goLive(t, draft, slot, now);
      } else {
        await t.catalogItem.update({ where: { id: draft.id }, data: { slot } });
      }
    }
    await audit(
      {
        action: 'catalog.replace',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'CatalogItem',
        targetId: id,
        metadata: { kind: item.kind, slot, replacementId },
      },
      t,
    );
    return { slot };
  });
}

/** Mark as watched on stream → reviews unlock; the slot stays until a moderator replaces it. */
export async function markWatched(ctx: Ctx, id: string, now = new Date()) {
  const item = await db().catalogItem.findUnique({ where: { id }, include: { campaign: true } });
  if (!item) throw Problems.notFound();
  const allowed =
    item.kind === 'MOVIE' ? ['ACTIVE', 'SPONSORED'] : item.campaign ? ['ACTIVE', 'FUNDED'] : [];
  if (!allowed.includes(item.status)) {
    throw CatalogProblems.invalidState('Este título não pode ser marcado como assistido agora.');
  }
  if (item.reservedUntil && item.reservedUntil > now) {
    throw CatalogProblems.invalidState('Há um Pix pendente para este filme.');
  }
  return tx(item.kind, async (t) => {
    const res = await t.catalogItem.updateMany({
      where: { id, status: item.status, version: item.version },
      data: { status: 'WATCHED', watchedAt: now },
    });
    if (res.count !== 1) throw CatalogProblems.versionConflict(item.version);
    if (item.campaign) {
      await t.campaign.update({
        where: { id: item.campaign.id },
        data: { status: 'WATCHED', version: { increment: 1 } },
      });
    }
    await t.watchEvent.create({ data: { itemId: id, watchedAt: now } });
    await audit(
      {
        action: 'catalog.watched',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'CatalogItem',
        targetId: id,
        metadata: { kind: item.kind },
      },
      t,
    );
    return t.catalogItem.findUniqueOrThrow({ where: { id } });
  });
}

/** Delete a draft that never went live (no orders, no campaign). */
export async function deleteDraft(ctx: Ctx, id: string) {
  const item = await db().catalogItem.findUnique({
    where: { id },
    include: { _count: { select: { orders: true } }, campaign: { select: { id: true } } },
  });
  if (!item) throw Problems.notFound();
  if (item.status !== 'DRAFT' || item.publishedAt || item._count.orders || item.campaign) {
    throw CatalogProblems.invalidState(
      'Só rascunhos que nunca foram publicados podem ser excluídos.',
    );
  }
  return tx(item.kind, async (t) => {
    await t.catalogItem.delete({ where: { id } });
    await audit(
      {
        action: 'catalog.delete',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'CatalogItem',
        targetId: id,
        metadata: { kind: item.kind },
      },
      t,
    );
  });
}
