import { z } from 'zod';
import { draftFromSuggestion } from '@/server/catalog/publishing';
import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

const body = z.object({}).strict();

/**
 * POST /api/v1/admin/suggestions/[id]/draft — "Criar rascunho" (2026-11-15): a catalog draft
 * filled from Wikidata (or the title already in the catalog), and the suggestion accepted.
 */
export const POST = route<'moderator', typeof body, undefined, { id: string }>(
  { methods: ['POST'], access: 'moderator', rateLimit: [RL.adminWrite, RL.wikidata], body },
  async ({ user, requestId, params }) => ({
    result: await draftFromSuggestion({ actor: user, requestId }, uuidParam(params.id)),
  }),
);
