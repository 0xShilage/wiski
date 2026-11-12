import { claimBadge, claimInput } from '@/server/badges/badges';
import { HttpError } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * POST /api/v1/badges/[slug]/claim — `{code?}`: claim an open badge (Emblemas, 2026-11-12).
 * Signed-in viewers; the claim word when the badge has one. Claiming twice is fine.
 */
export const POST = route<'user', typeof claimInput, undefined, { slug: string }>(
  { methods: ['POST'], access: 'user', rateLimit: RL.badgeClaim, body: claimInput },
  async ({ user, body, params }) => {
    const slug = String(params.slug ?? '');
    if (!SLUG.test(slug) || slug.length > 60)
      throw new HttpError(404, 'BADGE_NOT_FOUND', 'Emblema não encontrado.');
    return { badge: await claimBadge(user, slug, body.code) };
  },
);
