import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { queue, sessionsWithEntries } from '@/server/live/schedule';

/** GET /api/v1/admin/live — the agenda: sessions from 3 days ago on, plus the unscheduled queue. */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => {
    const from = new Date(Date.now() - 3 * 86_400_000);
    const [sessions, waiting] = await Promise.all([sessionsWithEntries({ from, take: 40 }), queue()]);
    return { sessions, queue: waiting };
  },
);
