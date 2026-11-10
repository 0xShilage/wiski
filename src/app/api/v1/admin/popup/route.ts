import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { popupForAdmin, popupInput, setPopup } from '@/server/site/appearance';

/**
 * GET / PUT /api/v1/admin/popup — the home pop-up (2026-11-10). Switching it on (or `renew`)
 * gives it a new id, so every visitor sees it once more.
 */
export const GET = route<'moderator'>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async () => ({ popup: await popupForAdmin() }),
);

export const PUT = route<'moderator', typeof popupInput>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: popupInput },
  async ({ body, user, requestId }) => ({
    popup: await setPopup({ actor: user, requestId }, body),
  }),
);
