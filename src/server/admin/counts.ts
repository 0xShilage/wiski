import 'server-only';
import { db } from '../db';
import { orderCounts } from '../checkout/admin';
import { waitingCount } from '../reviews/moderation';

/** Sidebar badges: reviews waiting, orders needing a decision, unread contact messages, new suggestions. */
export async function opsCounts() {
  const [waiting, orders, unread, suggestions] = await Promise.all([
    waitingCount(),
    orderCounts(),
    db().contactMessage.count({ where: { status: 'NEW' } }),
    db().suggestion.count({ where: { status: 'NEW' } }),
  ]);
  return { waiting, attention: orders.attention, texts: orders.texts, unread, suggestions };
}
