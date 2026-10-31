import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { suggestionQuery } from '@/server/admin/input';
import { listSuggestions } from '@/server/suggestions/suggestions';

/** GET /api/v1/admin/suggestions?status=&before= — viewer suggestions (moderators and streamer). */
export const GET = route<'moderator', undefined, typeof suggestionQuery>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin, query: suggestionQuery },
  async ({ query }) => listSuggestions({ status: query.status, before: query.before }),
);
