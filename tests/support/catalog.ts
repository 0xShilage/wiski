import type { ItemKind, ItemStatus } from '@/generated/prisma/enums';
import { db } from '@/server/db';
import { makeUser } from './db';

let seq = 0;
let creatorId: string | undefined;

async function creator(): Promise<string> {
  creatorId ??= (await makeUser({ role: 'MODERATOR' })).id;
  return creatorId;
}

/** Test-only: a catalog row created directly (bypassing the dashboard services). */
export async function makeItem(
  over: {
    kind?: ItemKind;
    status?: ItemStatus;
    slot?: number | null;
    title?: string;
    runtimeMinutes?: number;
    seasonCount?: number | null;
  } = {},
) {
  seq++;
  const kind = over.kind ?? 'MOVIE';
  const status = over.status ?? 'DRAFT';
  const live = ['ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED'].includes(status);
  const now = new Date();
  return db().catalogItem.create({
    data: {
      kind,
      status,
      slug: `item-${Date.now().toString(36)}-${seq}`,
      slot: over.slot === undefined ? null : over.slot,
      title: over.title ?? `Filme de teste ${seq}`,
      runtimeMinutes: over.runtimeMinutes ?? (kind === 'MOVIE' ? 115 : 480),
      synopsis: 'Sinopse de teste.',
      genres: [],
      cast: [],
      ...(kind === 'SERIES'
        ? { seasonCount: over.seasonCount ?? 2, seasonsLabel: 'Temporadas 1–2' }
        : {}),
      createdById: await creator(),
      ...(live || status === 'ARCHIVED' ? { publishedAt: now } : {}),
      ...(status === 'WATCHED' ? { watchedAt: now } : {}),
      ...(status === 'ARCHIVED' ? { archivedAt: now } : {}),
    },
  });
}

/** Remove every catalog row (and dependants) so slot/limit tests start from an empty catalog. */
export async function clearCatalog(): Promise<void> {
  await db().$transaction([
    db().watchEvent.deleteMany({}),
    db().review.deleteMany({}),
    db().refund.deleteMany({}),
    db().payment.deleteMany({}),
    db().legalAcceptance.deleteMany({ where: { orderId: { not: null } } }),
    db().emailOutbox.deleteMany({}),
    db().voucherRedemption.deleteMany({}),
    db().queueJumpSlot.deleteMany({}),
    db().order.deleteMany({}),
    db().campaign.deleteMany({}),
    db().catalogRevision.deleteMany({}),
    db().franchiseEntry.deleteMany({}),
    db().catalogItem.deleteMany({}),
    db().mediaAsset.deleteMany({}),
  ]);
}

let assetSeq = 0;
/** Test-only: a MediaAsset row with fake (but well-formed) variants. */
export async function makeAsset(role: 'POSTER' | 'BACKDROP' | 'LOGO') {
  assetSeq++;
  const hash = new Uint8Array(32);
  crypto.getRandomValues(hash);
  const hex = Buffer.from(hash).toString('hex').slice(0, 32);
  const [w, h] = role === 'POSTER' ? [960, 1440] : role === 'BACKDROP' ? [1920, 1080] : [960, 240];
  return db().mediaAsset.create({
    data: {
      sha256: hash,
      role,
      width: w,
      height: h,
      variants: [
        { w, h, format: 'avif', path: `/media/${hex}-${w}.avif`, bytes: 1000 + assetSeq },
        { w, h, format: 'webp', path: `/media/${hex}-${w}.webp`, bytes: 1000 + assetSeq },
      ],
      uploadedById: await creator(),
    },
  });
}

/** Test-only: an OPEN campaign for a live SERIES item (goal in cents, deadline in days). */
export async function makeCampaign(
  over: { goalCents?: number; slot?: number; days?: number; title?: string } = {},
) {
  const item = await makeItem({
    kind: 'SERIES',
    status: 'ACTIVE',
    slot: over.slot ?? 1,
    ...(over.title ? { title: over.title } : {}),
  });
  const now = new Date();
  const goalCents = over.goalCents ?? 30_000;
  const deadline = now.getTime() + (over.days ?? 30) * 86_400_000;
  const campaign = await db().campaign.create({
    data: {
      itemId: item.id,
      goalCents,
      remainingCents: goalCents,
      deadlineAt: new Date(deadline),
      openedAt: new Date(Math.min(now.getTime() - 60_000, deadline - 30 * 86_400_000)),
      openedById: await creator(),
    },
  });
  return { item, campaign };
}
