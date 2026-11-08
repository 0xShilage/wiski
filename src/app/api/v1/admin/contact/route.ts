import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { contactQuery } from '@/server/admin/input';
import { listContact } from '@/server/contact/contact';

/** GET /api/v1/admin/contact?status=&before= — the contact inbox. */
export const GET = route<'moderator', undefined, typeof contactQuery>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin, query: contactQuery },
  async ({ query }) =>
    listContact({
      ...(query.status ? { status: query.status } : {}),
      ...(query.before ? { before: query.before } : {}),
    }),
);
