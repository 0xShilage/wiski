import 'server-only';
import type { Order } from '@/generated/prisma/client';
import { pictureFrom } from '@/lib/media';
import type { OrderTicket } from '@/lib/checkout/types';
import { db } from '../db';
import { publicQueue } from '../live/public';

const TICKET_STATUSES = new Set<Order['status']>(['PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED']);

/**
 * The cinema ticket on a paid order's page (2026-11-10): the title's poster, the sponsor's public
 * name as everybody sees it on the site (null = anonymous), and the "seat" = the place in the Fila
 * tab (1 = next), for a series/franchise the place of its campaign once the goal is reached.
 * Only for orders that count (paid and not refunded); watched ones get `watched` instead of a seat.
 */
export async function ticketOf(
  order: Pick<
    Order,
    | 'id'
    | 'status'
    | 'kind'
    | 'itemId'
    | 'campaignId'
    | 'userId'
    | 'showSponsorName'
    | 'guestDisplayName'
    | 'displayNameStatus'
  >,
): Promise<OrderTicket | null> {
  if (!TICKET_STATUSES.has(order.status)) return null;
  const watched = order.status === 'COMPLETED';
  const [item, user, queue] = await Promise.all([
    db().catalogItem.findUnique({
      where: { id: order.itemId },
      select: { poster: { select: { width: true, height: true, variants: true } } },
    }),
    order.userId && order.showSponsorName
      ? db().user.findUnique({
          where: { id: order.userId },
          select: { username: true, status: true },
        })
      : null,
    watched ? [] : publicQueue(),
  ]);
  const name = !order.showSponsorName
    ? null
    : order.userId
      ? user?.username && user.status !== 'DELETED'
        ? `@${user.username}`
        : null
      : order.guestDisplayName && order.displayNameStatus !== 'REJECTED'
        ? order.guestDisplayName
        : null;
  const key = order.kind === 'MOVIE' ? `o:${order.id}` : `c:${order.campaignId ?? ''}`;
  const at = queue.findIndex((e) => e.key === key);
  return {
    poster: pictureFrom(item?.poster),
    name,
    seat: at >= 0 ? at + 1 : null,
    watched,
  };
}
