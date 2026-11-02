import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { usersQuery } from '@/server/admin/input';
import { listUsers } from '@/server/users/admin';

/** GET /api/v1/admin/users?q=&filter=&after= — people (e-mail for the streamer only). */
export const GET = route<'moderator', undefined, typeof usersQuery>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin, query: usersQuery },
  async ({ query, user }) =>
    listUsers(user.role, {
      ...(query.q ? { q: query.q } : {}),
      ...(query.filter ? { filter: query.filter } : {}),
      ...(query.after ? { after: query.after } : {}),
    }),
);
