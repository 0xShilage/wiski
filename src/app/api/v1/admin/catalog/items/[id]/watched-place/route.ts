import { setWatchedPlace } from '@/server/catalog/service';
import { watchedPlaceInput } from '@/server/catalog/input';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/**
 * PUT /api/v1/admin/catalog/items/[id]/watched-place — `{expectedVersion, offStream}`:
 * "Visto em live" / "Visto fora da live" on a watched title (2026-11-22, Admin › Assistidos).
 */
export const PUT = route<'moderator', typeof watchedPlaceInput, undefined, { id: string }>(
  { methods: ['PUT'], access: 'moderator', rateLimit: RL.adminWrite, body: watchedPlaceInput },
  async ({ body, user, requestId, params }) => {
    const id = uuidParam(params.id);
    const item = await setWatchedPlace(
      { actor: user, requestId },
      id,
      body.expectedVersion,
      body.offStream,
    );
    return { id: item.id, offStream: item.offStream, version: item.version };
  },
);
