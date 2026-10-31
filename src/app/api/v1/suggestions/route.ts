import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { suggestionInput } from '@/server/admin/input';
import { submitSuggestion } from '@/server/suggestions/suggestions';

/** POST /api/v1/suggestions — a signed-in viewer suggests a title (5/day per account). */
export const POST = route<'user', typeof suggestionInput>(
  { methods: ['POST'], access: 'user', rateLimit: RL.suggestion, body: suggestionInput },
  async ({ user, body }) =>
    Response.json(
      await submitSuggestion(user, {
        kind: body.kind,
        title: body.title,
        year: body.year ?? null,
        note: body.note ?? null,
      }),
      { status: 201 },
    ),
);
