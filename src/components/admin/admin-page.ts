import 'server-only';
import type { ReactNode } from 'react';
import { opsCounts } from '@/server/admin/counts';
import type { SessionContext } from '@/server/auth/session';
import { adminCounts } from '@/server/catalog/read';
import { notFound } from 'next/navigation';
import { adminGate } from './AdminGate';

/**
 * Everything an /admin page needs before rendering: the gate (role + passkey), and the sidebar's
 * numbers. `streamer: true` pages answer 404 to moderators (the API does the same).
 */
export async function adminPage(
  path: string,
  opts: { streamer?: boolean } = {},
): Promise<
  | { gate: ReactNode }
  | {
      ctx: SessionContext;
      shell: {
        user: { username: string | null; role: SessionContext['user']['role'] };
        catalog: Awaited<ReturnType<typeof adminCounts>>;
        counts: Awaited<ReturnType<typeof opsCounts>>;
      };
    }
> {
  const g = await adminGate(path);
  if ('gate' in g) return g;
  if (opts.streamer && g.ctx.user.role !== 'STREAMER') notFound();
  const [catalog, counts] = await Promise.all([adminCounts(), opsCounts()]);
  return {
    ctx: g.ctx,
    shell: { user: { username: g.ctx.user.username, role: g.ctx.user.role }, catalog, counts },
  };
}
