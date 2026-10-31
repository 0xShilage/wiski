import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { mediaKitGoals } from '@/server/goals/goals';
import { listStats } from '@/server/mediakit/stats';

/** GET /api/v1/stats — media kit numbers and the goals marked for it (revenue as % only). */
export const GET = route<'public'>(
  { methods: ['GET'], access: 'public', rateLimit: RL.publicRead },
  async () => {
    const goals = await mediaKitGoals();
    return {
      stats: await listStats(),
      goals: goals.map((g) => ({
        title: g.title,
        metric: g.metric,
        percent: g.percent,
        ...(g.metric === 'SPONSORSHIP_REVENUE_CENTS' ? {} : { current: g.current, target: g.target }),
      })),
    };
  },
);
