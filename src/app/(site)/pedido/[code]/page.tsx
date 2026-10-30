import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OrderView } from '@/components/checkout/OrderView';
import { getCurrentSession } from '@/server/auth/current';
import { PUBLIC_CODE } from '@/server/checkout/buyer';

export const metadata: Metadata = {
  title: 'Pedido',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { params: Promise<{ code: string }> };

/**
 * /pedido/[code] — order page (03 §4, 11 §8). The data is loaded client-side from
 * /api/v1/orders/[code] with the session or the order cookie; the order-link token lives only in
 * the URL fragment and is exchanged by the page itself.
 */
export default async function Page({ params }: Props) {
  const { code } = await params;
  if (!PUBLIC_CODE.test(code)) notFound();
  const ctx = await getCurrentSession();
  return (
    <div className="wf-page">
      <OrderView code={code} signedIn={Boolean(ctx)} />
    </div>
  );
}
