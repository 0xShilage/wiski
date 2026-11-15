import { quickAddInput } from '@/server/catalog/input';
import { quickAdd } from '@/server/catalog/publishing';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/admin/catalog/quick-add — one title → a draft filled from Wikidata
 * ("Adicionar vários" calls it once per line, 2026-11-15). 409 when it is already in the catalog.
 */
export const POST = route(
  {
    methods: ['POST'],
    access: 'moderator',
    rateLimit: [RL.adminWrite, RL.wikidata],
    body: quickAddInput,
  },
  async ({ user, requestId, body }) => {
    const result = await quickAdd({ actor: user, requestId }, body, { source: 'bulk' });
    return Response.json({ result }, { status: 201 });
  },
);
