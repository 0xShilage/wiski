import { z } from 'zod';
import { route } from '@/server/http/route';
import { acceptLateApproval } from '@/server/orders/admin';
import { RL } from '@/server/ratelimit/rules';

const body = z.object({ outcome: z.literal('accept') }).strict();

/**
 * POST /api/v1/admin/orders/[code]/resolve — accept a Pix paid after it expired (13 D4) while
 * the movie / campaign still has room. STREAMER + step-up + passkey (it moves money state).
 */
export const POST = route<'streamer', typeof body, undefined, { code: string }>(
  { methods: ['POST'], access: 'streamer', stepUp: true, rateLimit: RL.adminWrite, body },
  async ({ user, requestId, params }) => ({
    order: await acceptLateApproval({ actor: user, requestId }, params.code),
  }),
);
