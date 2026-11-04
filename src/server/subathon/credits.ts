import 'server-only';
import { secondsFor } from '@/lib/subathon';
import { db } from '../db';
import { publicSponsor, sponsorSelect } from '../live/sponsor';
import { logger } from '../log';
import { applyEntry, openSubathon, ratesOf } from './timer';

/**
 * Site payments on the subathon timer (2026-11-03). Every order paid while a subathon is open —
 * movie sponsorships, contributions and "Já pago" — adds its total (R$ → seconds by the
 * subathon's rule); an order that later leaves the paid states (refunded, charged back, undone)
 * takes back exactly the time it added. Nothing here changes an order: it only reads them.
 *
 * Runs as a worker job every few seconds (and right after a payment is confirmed), so a crash
 * between "paid" and "credited" can't lose time; the ledger's unique externalId
 * ("order:<id>" / "refund:<id>") makes every run idempotent.
 */
const PAID_LIKE = ['PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED'] as const;
const BATCH = 100;

function orderLabel(kind: 'MOVIE' | 'CONTRIBUTION', who: string | null): string {
  return `${kind === 'MOVIE' ? 'Patrocínio' : 'Contribuição'} de ${who ?? 'Anônimo'}`;
}

/** Credit paid orders not yet on the open subathon; debit credited ones that were refunded. */
export async function syncSiteCredits(
  now = new Date(),
): Promise<{ credited: number; debited: number }> {
  const s = await openSubathon();
  if (!s) return { credited: 0, debited: 0 };
  const rates = ratesOf(s);
  let credited = 0;
  let debited = 0;

  if (rates.count.site) {
    const orders = await db().order.findMany({
      where: { status: { in: [...PAID_LIKE] }, paidAt: { gte: s.createdAt, lte: now } },
      orderBy: { paidAt: 'asc' },
      take: 500,
      select: { id: true, kind: true, totalCents: true, ...sponsorSelect },
    });
    if (orders.length) {
      const done = new Set(
        (
          await db().subathonEntry.findMany({
            where: { subathonId: s.id, orderId: { in: orders.map((o) => o.id) }, kind: 'ORDER' },
            select: { orderId: true },
          })
        ).map((e) => e.orderId),
      );
      for (const o of orders.filter((x) => !done.has(x.id)).slice(0, BATCH)) {
        const out = await applyEntry(
          {
            kind: 'ORDER',
            externalId: `order:${o.id}`,
            valueCents: o.totalCents,
            seconds: secondsFor(o.totalCents, s.secondsPerReal),
            label: orderLabel(o.kind, publicSponsor(o)),
            orderId: o.id,
          },
          now,
          { subathonId: s.id },
        );
        if (out.result === 'closed') return { credited, debited };
        if (out.result === 'applied') credited++;
      }
    }
  }

  // credited orders that are no longer paid (refund, chargeback, "Desfazer registro")
  const credits = await db().subathonEntry.findMany({
    where: { subathonId: s.id, kind: 'ORDER', appliedSeconds: { gt: 0 } },
    select: { orderId: true, appliedSeconds: true, label: true },
  });
  if (credits.length) {
    const ids = credits.map((c) => c.orderId).filter((x): x is string => !!x);
    const [gone, refunded] = await Promise.all([
      db().order.findMany({
        where: {
          id: { in: ids },
          OR: [
            { status: { notIn: [...PAID_LIKE] } },
            { payment: { status: { in: ['REFUNDED', 'CHARGED_BACK'] } } },
          ],
        },
        select: { id: true },
      }),
      db().subathonEntry.findMany({
        where: { subathonId: s.id, kind: 'REFUND', orderId: { in: ids } },
        select: { orderId: true },
      }),
    ]);
    const already = new Set(refunded.map((r) => r.orderId));
    const byOrder = new Map(credits.map((c) => [c.orderId, c]));
    for (const g of gone.filter((x) => !already.has(x.id)).slice(0, BATCH)) {
      const c = byOrder.get(g.id)!;
      const out = await applyEntry(
        {
          kind: 'REFUND',
          externalId: `refund:${g.id}`,
          valueCents: null,
          seconds: -c.appliedSeconds,
          label: c.label ? `Estorno: ${c.label}`.slice(0, 80) : 'Estorno',
          orderId: g.id,
        },
        now,
        { subathonId: s.id },
      );
      if (out.result === 'closed') break;
      if (out.result === 'applied') debited++;
    }
  }
  if (credited || debited) logger.info({ credited, debited }, 'subathon site credits');
  return { credited, debited };
}
