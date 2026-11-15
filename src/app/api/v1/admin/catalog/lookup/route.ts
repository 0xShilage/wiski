import { lookupQuery } from '@/server/catalog/input';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { searchWikidata, wikidataFill } from '@/server/wikidata/wikidata';

/**
 * GET /api/v1/admin/catalog/lookup?kind=MOVIE&q=matrix — titles on Wikidata (2026-11-15);
 * GET …&id=Q83495 — one title's fields for the editor, plus the Wikipedia summary as a reference.
 */
export const GET = route(
  {
    methods: ['GET'],
    access: 'moderator',
    rateLimit: [RL.admin, RL.wikidata],
    query: lookupQuery,
  },
  async ({ query }) =>
    query.id
      ? { fill: await wikidataFill(query.id, query.kind) }
      : { results: await searchWikidata(query.q ?? '', query.kind) },
);
