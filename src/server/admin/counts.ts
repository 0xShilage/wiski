import 'server-only';
import { db } from '../db';
import { orderCounts } from '../checkout/admin';
import { waitingCount } from '../reviews/moderation';
import { pendingRoletaCount } from '../roleta/roleta';

/** Sidebar badges: reviews waiting, orders needing a decision, unread contact messages, new suggestions, Roleta prizes waiting. */
export async function opsCounts() {
  const [waiting, orders, unread, suggestions, roleta] = await Promise.all([
    waitingCount(),
    orderCounts(),
    db().contactMessage.count({ where: { status: 'NEW' } }),
    db().suggestion.count({ where: { status: 'NEW' } }),
    pendingRoletaCount(),
  ]);
  return { waiting, attention: orders.attention, texts: orders.texts, unread, suggestions, roleta };
}
