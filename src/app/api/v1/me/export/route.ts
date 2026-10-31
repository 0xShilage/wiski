import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { exportMyData } from '@/server/users/lgpd';

/** GET /api/v1/me/export — everything we hold about you, as a JSON download (LGPD art. 18). */
export const GET = route<'user'>(
  { methods: ['GET'], access: 'user', rateLimit: RL.dataExport },
  async ({ user, requestId }) => {
    const data = await exportMyData(user, requestId);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="wiski-meus-dados.json"',
        'cache-control': 'private, no-store',
      },
    });
  },
);
