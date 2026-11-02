import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { auditQuery } from '@/server/admin/input';
import { auditPage } from '@/server/audit/viewer';

/** GET /api/v1/admin/audit?action=&actor=&before= — the audit log (read-only). */
export const GET = route<'streamer', undefined, typeof auditQuery>(
  { methods: ['GET'], access: 'streamer', rateLimit: RL.admin, query: auditQuery },
  async ({ query }) =>
    auditPage({
      ...(query.action ? { action: query.action } : {}),
      ...(query.actor ? { actor: query.actor } : {}),
      ...(query.before ? { before: query.before } : {}),
    }),
);
