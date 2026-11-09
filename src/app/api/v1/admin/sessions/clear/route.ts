import { route } from '@/server/http/route';
import { clearPastSessions } from '@/server/live/schedule';
import { RL } from '@/server/ratelimit/rules';

/**
 * POST /api/v1/admin/sessions/clear — "Limpar encerradas e canceladas" (2026-11-09): hides every
 * DONE or CANCELLED session from the agenda and the Cronograma (nothing is deleted).
 */
export const POST = route<'moderator'>(
  { methods: ['POST'], access: 'moderator', rateLimit: RL.adminWrite },
  async ({ user, requestId }) => clearPastSessions({ actor: user, requestId }),
);
