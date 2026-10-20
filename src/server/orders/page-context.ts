import 'server-only';
import { cookies } from 'next/headers';
import type { CheckoutContext } from '@/components/checkout/types';
import { getCurrentSession } from '../auth/current';
import { getEnv } from '../env';
import { currentLegal } from '../legal/legal';
import { isMercadoPagoConfigured } from '../payments/mercadopago';
import { orderIdsFromCookie } from './cookie';

/** What the checkout sheets need from the server (no secrets: the site key is public). */
export async function checkoutContext(): Promise<CheckoutContext> {
  const ctx = await getCurrentSession();
  const legal = currentLegal();
  return {
    viewer: ctx?.user.username ? { username: ctx.user.username } : null,
    signedIn: !!ctx,
    turnstileSiteKey: getEnv().TURNSTILE_SITE_KEY,
    legal: {
      terms: legal.TERMS.version,
      privacy: legal.PRIVACY.version,
      refund: legal.REFUND.version,
    },
    payable: isMercadoPagoConfigured(),
  };
}

/** Order ids held in the guest's `__Host-wf_order` cookie (Server Components). */
export async function orderIdsFromRequestCookies(): Promise<string[]> {
  return orderIdsFromCookie({ cookies: await cookies() });
}
