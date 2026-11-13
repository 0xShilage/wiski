import 'server-only';
import { getCurrentSession } from '../auth/current';
import { COUNTED_ORDER_STATUSES } from '../community/achievements';
import { db } from '../db';

/** Whether this account has a paid (not refunded) contribution to the campaign. */
export async function hasContributed(userId: string, campaignId: string): Promise<boolean> {
  const n = await db().order.count({
    where: {
      userId,
      campaignId,
      kind: 'CONTRIBUTION',
      status: { in: [...COUNTED_ORDER_STATUSES] },
    },
  });
  return n > 0;
}

/**
 * The key that marks "seu lugar" on a campaign's seat map (2026-11-11): the signed-in viewer's id
 * when they have a paid contribution to this campaign, else null. Nobody else's seat is ever
 * marked, and no name is shown on any seat.
 */
export async function viewerSeatKey(campaignId: string): Promise<string | null> {
  const ctx = await getCurrentSession();
  if (!ctx) return null;
  return (await hasContributed(ctx.user.id, campaignId)) ? ctx.user.id : null;
}

/**
 * The theater seat map's "seu lugar" (2026-11-13): the key above plus the viewer's avatar, which
 * sits on their seat. Null when the viewer has no seat.
 */
export async function viewerSeat(
  campaignId: string,
): Promise<{ key: string; avatarKey: string } | null> {
  const ctx = await getCurrentSession();
  if (!ctx) return null;
  return (await hasContributed(ctx.user.id, campaignId))
    ? { key: ctx.user.id, avatarKey: ctx.user.avatarKey }
    : null;
}
