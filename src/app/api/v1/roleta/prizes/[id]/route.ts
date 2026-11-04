import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { roletaTwitchInput } from '@/server/admin/input';
import { setTwitchLogin } from '@/server/roleta/roleta';

/** PATCH /api/v1/roleta/prizes/[id] — the winner's Twitch login (own prizes, while waiting). */
export const PATCH = route<'user', typeof roletaTwitchInput, undefined, { id: string }>(
  { methods: ['PATCH'], access: 'user', rateLimit: RL.roletaClaim, body: roletaTwitchInput },
  async ({ user, body, params }) => setTwitchLogin(user, uuidParam(params.id), body.twitchLogin),
);
