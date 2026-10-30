import { formatMonthYear } from '@/lib/format';
import { Problems } from '@/server/http/problem';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { findProfile } from '@/server/reviews/read';

/** GET /api/v1/users/[username] — public profile: username, avatar, joined month, review count. */
export const GET = route<'public', undefined, undefined, { username: string }>(
  { methods: ['GET'], access: 'public', rateLimit: RL.reviewRead },
  async ({ params }) => {
    const p = await findProfile(String(params.username ?? ''));
    if (!p) throw Problems.notFound();
    return {
      username: p.username,
      avatarKey: p.avatarKey,
      joined: formatMonthYear(p.createdAt),
      reviewCount: p.reviewCount,
    };
  },
);
