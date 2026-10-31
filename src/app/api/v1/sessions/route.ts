import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { publicSchedule } from '@/server/live/public';

/** GET /api/v1/sessions — upcoming lives and what's on them ("Próximos na live"). */
export const GET = route<'public'>(
  { methods: ['GET'], access: 'public', rateLimit: RL.publicRead },
  async () => ({ sessions: await publicSchedule() }),
);
