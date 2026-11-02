import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { releaseCreateInput } from '@/server/admin/input';
import { createRelease, linkableSeries, listReleases } from '@/server/releases/releases';

/** GET /api/v1/admin/releases — upcoming season releases + the series they can link to. */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => ({ releases: await listReleases(), series: await linkableSeries() }),
);

/** POST /api/v1/admin/releases — add a release (series from the catalog or just a name). */
export const POST = route<'moderator', typeof releaseCreateInput>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite, body: releaseCreateInput },
  async ({ user, requestId, body }) =>
    Response.json(await createRelease({ actor: user, requestId }, body), { status: 201 }),
);
