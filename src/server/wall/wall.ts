import 'server-only';
import type { ItemKind } from '@/generated/prisma/client';
import { type Picture, pictureFrom } from '@/lib/media';
import { streamSafeName } from '@/lib/stream-safe';
import { db } from '../db';
import { publicSponsor, sponsorSelect } from '../live/sponsor';

/**
 * Mural de apoiadores (2026-11-09): a thank-you per sponsored title, with the names of the
 * sponsors who ticked "Quero aparecer no mural" (opt-in, off by default; a moderator can take one
 * off). Only paid orders that still count (not refunded or cancelled), only the public name
 * (@username or the name a guest typed), never an anonymous one, and names that pass the same
 * filter as the stream (no links, no swear words). Newest support first.
 */
export type WallEntry = {
  itemId: string;
  title: string;
  kind: ItemKind;
  slug: string;
  poster: Picture | null;
  names: string[];
  /** a sponsored movie (one sponsor) or a campaign (contributions) */
  campaign: boolean;
  lastAt: string;
};

const COUNTED = ['PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED'] as const;

export async function supportersWall(limit = 120): Promise<WallEntry[]> {
  const orders = await db().order.findMany({
    where: { wallOptIn: true, showSponsorName: true, status: { in: [...COUNTED] } },
    orderBy: { paidAt: 'desc' },
    take: 2000,
    select: {
      kind: true,
      paidAt: true,
      ...sponsorSelect,
      item: {
        select: {
          id: true,
          title: true,
          kind: true,
          slug: true,
          poster: { select: { width: true, height: true, variants: true } },
        },
      },
    },
  });
  const byItem = new Map<string, WallEntry>();
  for (const o of orders) {
    const name = streamSafeName(publicSponsor(o));
    if (!name) continue;
    let e = byItem.get(o.item.id);
    if (!e) {
      if (byItem.size >= limit) continue;
      e = {
        itemId: o.item.id,
        title: o.item.title,
        kind: o.item.kind,
        slug: o.item.slug,
        poster: pictureFrom(o.item.poster),
        names: [],
        campaign: o.kind === 'CONTRIBUTION',
        lastAt: (o.paidAt ?? new Date(0)).toISOString(),
      };
      byItem.set(o.item.id, e);
    }
    if (!e.names.includes(name)) e.names.push(name);
  }
  return [...byItem.values()];
}
