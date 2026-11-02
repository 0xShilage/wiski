import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { linkCreateInput } from '@/server/admin/input';
import { createLink, listLinks } from '@/server/links/links';

/** GET /api/v1/admin/links — every link of the Links page, hidden ones too. */
export const GET = route<'streamer'>(
  { methods: ['GET'], access: 'streamer', rateLimit: RL.admin },
  async () => ({ links: await listLinks() }),
);

/** POST /api/v1/admin/links — add a link at the end (at most 30). */
export const POST = route<'streamer', typeof linkCreateInput>(
  { methods: ['POST'], access: 'streamer', rateLimit: RL.adminWrite, body: linkCreateInput },
  async ({ user, requestId, body }) =>
    Response.json(await createLink({ actor: user, requestId }, body), { status: 201 }),
);
