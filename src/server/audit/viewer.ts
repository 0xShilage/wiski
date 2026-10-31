import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '../db';

/**
 * Read-only audit log for the streamer (05 §13): newest first, filter by action prefix or actor,
 * keyset by id. CSV export neutralises formula injection (cells starting with = + - @ tab CR get
 * a leading apostrophe — 05 §8 sinks).
 */
const PAGE = 50;

export async function auditPage(q: { action?: string; actor?: string; before?: string }) {
  const where: Prisma.AuditLogWhereInput = {
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.actor ? { actorId: q.actor } : {}),
    ...(q.before ? { id: { lt: BigInt(q.before) } } : {}),
  };
  const rows = await db().auditLog.findMany({
    where,
    orderBy: { id: 'desc' },
    take: PAGE + 1,
    select: {
      id: true,
      at: true,
      actorId: true,
      actorRole: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      requestId: true,
    },
  });
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const actors = await db().user.findMany({
    where: {
      id: { in: [...new Set(shown.map((r) => r.actorId).filter((x): x is string => !!x))] },
    },
    select: { id: true, username: true },
  });
  const name = new Map(actors.map((a) => [a.id, a.username]));
  return {
    entries: shown.map((r) => ({
      id: r.id.toString(),
      at: r.at.toISOString(),
      actor: r.actorId
        ? name.get(r.actorId)
          ? `@${name.get(r.actorId)}`
          : 'conta removida'
        : 'sistema',
      actorId: r.actorId,
      actorRole: r.actorRole,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata,
      requestId: r.requestId,
    })),
    next: more ? shown.at(-1)!.id.toString() : null,
  };
}

/** A CSV cell that a spreadsheet will show as text, never evaluate. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function auditCsv(q: { action?: string; actor?: string }, maxRows = 5000) {
  const lines = ['id,at,actor,role,action,targetType,targetId,metadata,requestId'];
  let before: string | undefined;
  let count = 0;
  while (count < maxRows) {
    const page = await auditPage({ ...q, ...(before ? { before } : {}) });
    for (const e of page.entries) {
      lines.push(
        [
          e.id,
          e.at,
          e.actor,
          e.actorRole,
          e.action,
          e.targetType,
          e.targetId,
          e.metadata,
          e.requestId,
        ]
          .map(csvCell)
          .join(','),
      );
      count++;
    }
    if (!page.next) break;
    before = page.next;
  }
  return { csv: lines.join('\r\n') + '\r\n', rows: count };
}
