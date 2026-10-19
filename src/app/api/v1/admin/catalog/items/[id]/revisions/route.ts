import { db } from '@/server/db';
import { route } from '@/server/http/route';
import { uuidParam } from '@/server/http/params';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/admin/catalog/items/[id]/revisions — full history (snapshots for preview/diff). */
export const GET = route<'moderator', undefined, undefined, { id: string }>(
  { methods: ['GET'], access: 'moderator', rateLimit: RL.admin },
  async ({ params }) => {
    const rows = await db().catalogRevision.findMany({
      where: { itemId: uuidParam(params.id) },
      orderBy: { version: 'desc' },
      take: 100,
      select: {
        version: true,
        note: true,
        snapshot: true,
        createdAt: true,
        editor: { select: { username: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        version: r.version,
        note: r.note,
        snapshot: r.snapshot,
        createdAt: r.createdAt.toISOString(),
        editor: r.editor.username ? `@${r.editor.username}` : 'moderação',
      })),
    };
  },
);
