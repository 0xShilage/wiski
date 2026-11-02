import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { suggestionStatusInput } from '@/server/admin/input';
import { setSuggestionStatus } from '@/server/suggestions/suggestions';

/** PATCH /api/v1/admin/suggestions/[id] — accept, dismiss or reopen (compare-and-set). */
export const PATCH = route<'moderator', typeof suggestionStatusInput, undefined, { id: string }>(
  {
    methods: ['PATCH'],
    access: 'moderator',
    rateLimit: RL.adminWrite,
    body: suggestionStatusInput,
  },
  async ({ user, requestId, body, params }) => {
    await setSuggestionStatus({ actor: user, requestId }, uuidParam(params.id), body);
    return { ok: true };
  },
);
