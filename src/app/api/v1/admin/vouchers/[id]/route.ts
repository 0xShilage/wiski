import { uuidParam } from '@/server/http/params';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { voucherUpdateInput } from '@/server/admin/input';
import { updateVoucher } from '@/server/admin/vouchers';

/** PATCH /api/v1/admin/vouchers/[id] — turn off, change the end date or the usage cap; step-up. */
export const PATCH = route<'moderator', typeof voucherUpdateInput, undefined, { id: string }>(
  {
    methods: ['PATCH'],
    access: 'moderator',
    stepUp: true,
    rateLimit: RL.adminWrite,
    body: voucherUpdateInput,
  },
  async ({ user, requestId, body, params }) => ({
    voucher: await updateVoucher({ actor: user, requestId }, uuidParam(params.id), body),
  }),
);
