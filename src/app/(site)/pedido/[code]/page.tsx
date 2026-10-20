import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrderAccess } from '@/components/orders/OrderAccess';
import { OrderView } from '@/components/orders/OrderView';
import { getCurrentSession } from '@/server/auth/current';
import { getEnv } from '@/server/env';
import { orderIdsFromRequestCookies } from '@/server/orders/page-context';
import { buyerView, canAccessOrder, findOrderByCode, publicCodeOk } from '@/server/orders/read';

export const metadata: Metadata = {
  title: 'Pedido',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { params: Promise<{ code: string }> };

/**
 * /pedido/[code] — the buyer's order page (03 §5.3). Owner or guest with the order cookie;
 * everyone else (staff included — they use /admin/pedidos) sees the same "can't open" page (the token exchange happens client-side,
 * because the fragment never reaches the server).
 */
export default async function PedidoPage({ params }: Props) {
  const { code } = await params;
  if (!publicCodeOk(code)) notFound();
  const [ctx, cookieIds, order] = await Promise.all([
    getCurrentSession(),
    orderIdsFromRequestCookies(),
    findOrderByCode(code),
  ]);
  const user = ctx?.user ?? null;
  if (!order || !canAccessOrder(order, { user, cookieIds })) {
    return <OrderAccess code={code} signedIn={!!ctx} />;
  }
  const inCookie = cookieIds.includes(order.id);
  return (
    <OrderView
      initial={await buyerView(order, { withPix: true })}
      recipientName={getEnv().PIX_RECIPIENT_NAME ?? null}
      signedIn={!!ctx}
      isBuyer // canAccessOrder admits only the owner or the cookie holder
      canClaim={inCookie && !!user && order.userId === null}
    />
  );
}
