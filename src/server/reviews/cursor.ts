import 'server-only';
import { z } from 'zod';
import { Problems } from '../http/problem';

/**
 * Opaque keyset cursors for review lists (newest first, or most liked first). The cursor is the
 * last row's sort key, base64url JSON; anything that doesn't decode to a well-formed key is a
 * 422 — never an offset, so pages stay stable while reviews are written.
 */
const key = z
  .object({ c: z.iso.datetime(), i: z.uuid(), l: z.int().min(0).max(1_000_000_000).optional() })
  .strict();
export type CursorKey = { createdAt: Date; id: string; likeCount?: number };

export function encodeCursor(k: CursorKey): string {
  const json = JSON.stringify({
    c: k.createdAt.toISOString(),
    i: k.id,
    ...(k.likeCount !== undefined ? { l: k.likeCount } : {}),
  });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined, needsLikes: boolean): CursorKey | null {
  if (raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const r = key.safeParse(parsed);
  if (!r.success || (needsLikes && r.data.l === undefined)) throw invalid();
  return {
    createdAt: new Date(r.data.c),
    id: r.data.i,
    ...(r.data.l !== undefined ? { likeCount: r.data.l } : {}),
  };
}

function invalid() {
  return Problems.validation([{ path: 'cursor', message: 'Cursor inválido.' }]);
}
