import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { daysOff } from '@/server/live/daysoff';
import { queue, sessionsWithEntries } from '@/server/live/schedule';

/**
 * GET /api/v1/admin/live — the agenda: sessions from 3 days ago on, the unscheduled queue and the
 * days without a live from today on (2026-11-13).
 */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => {
    const from = new Date(Date.now() - 3 * 86_400_000);
    const [sessions, waiting, offs] = await Promise.all([
      sessionsWithEntries({ from, take: 40 }),
      queue(),
      daysOff(),
    ]);
    return { sessions, queue: waiting, daysOff: offs };
  },
);
