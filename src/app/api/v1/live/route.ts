import { route } from '@/server/http/route';
import { liveStatus } from '@/server/live/public';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/live — is a live "Ao vivo" now, and what is on screen (the site's "AO VIVO" bar). */
export const GET = route<'public'>(
  { methods: ['GET'], access: 'public', rateLimit: RL.publicRead },
  async () => liveStatus(),
);
