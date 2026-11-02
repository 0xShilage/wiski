import 'server-only';
import type { CheckoutProps } from '@/lib/checkout/types';
import { getCurrentSession } from '../auth/current';
import { getEnv } from '../env';
import { activeRuleSet } from '../pricing/ruleset';
import { perkFor } from './orders';
import { CLOSED_COPY, checkoutStatus, currentLegal } from './status';

/** What the checkout forms on the detail pages need (no secrets: the Turnstile site key is public). */
export async function checkoutProps(): Promise<CheckoutProps> {
  const [status, rs, legal, ctx] = await Promise.all([
    checkoutStatus(),
    activeRuleSet(),
    currentLegal(),
    getCurrentSession(),
  ]);
  const user = ctx?.user ?? null;
  const perk = perkFor(user);
  return {
    open: status.open,
    closedCopy: status.open ? null : CLOSED_COPY[status.reason],
    siteKey: getEnv().TURNSTILE_SITE_KEY,
    legal: legal
      ? { terms: legal.TERMS.version, privacy: legal.PRIVACY.version, refund: legal.REFUND.version }
      : null,
    signedIn: user ? { email: user.email } : null,
    perk: perk === 'NONE' ? null : perk === 'VIP' ? 'VIP' : 'MODERATOR',
    tiers:
      rs?.config.queueJump.enabled === true
        ? rs.config.queueJump.tiers.map((t) => ({ id: t.id, label: t.label, bps: t.bps }))
        : [],
    contributionMinCents: rs?.config.contributions.minCents ?? 500,
  };
}
