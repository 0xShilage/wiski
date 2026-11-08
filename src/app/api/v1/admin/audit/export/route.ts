import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { auditQuery } from '@/server/admin/input';
import { auditCsv } from '@/server/audit/viewer';

/** GET /api/v1/admin/audit/export?action=&actor= — CSV (formula-safe cells), up to 5 000 rows. */
export const GET = route<'moderator', undefined, typeof auditQuery>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.dataExport, query: auditQuery },
  async ({ query, audit }) => {
    const { csv, rows } = await auditCsv({
      ...(query.action ? { action: query.action } : {}),
      ...(query.actor ? { actor: query.actor } : {}),
    });
    await audit({ action: 'audit.export', targetType: 'AuditLog', metadata: { rows } });
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="wiski-auditoria.csv"',
        'cache-control': 'private, no-store',
      },
    });
  },
);
