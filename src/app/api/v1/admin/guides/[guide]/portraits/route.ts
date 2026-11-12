import { portraitInput, setPortrait } from '@/server/guides/portraits';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/**
 * PUT /api/v1/admin/guides/{guide}/portraits — `{slot, assetId}`: the photo of one character
 * version in a guide (an uploaded PORTRAIT), or `assetId: null` to take it out (2026-11-12).
 * Unknown guides are 404 (only the guides in the code exist).
 */
export const PUT = route<'moderator', typeof portraitInput>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: portraitInput },
  async ({ user, requestId, body, params }) => ({
    picture: await setPortrait({ actor: user, requestId }, String(params.guide ?? ''), body),
  }),
);
