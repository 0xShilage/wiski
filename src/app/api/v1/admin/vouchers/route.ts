import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { voucherCreateInput } from '@/server/admin/input';
import { createVoucher, listVouchers } from '@/server/admin/vouchers';

/** GET /api/v1/admin/vouchers — vouchers and their use. */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => ({ vouchers: await listVouchers() }),
);

/** POST /api/v1/admin/vouchers — new voucher (movies only, 04 §6); Google step-up. */
export const POST = route<'moderator', typeof voucherCreateInput>(
  {
    methods: ['POST'],
    access: 'moderator',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: voucherCreateInput,
  },
  async ({ user, requestId, body }) =>
    Response.json(
      { voucher: await createVoucher({ actor: user, requestId }, body) },
      { status: 201 },
    ),
);
