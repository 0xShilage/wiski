import 'server-only';
import type { Role } from '@/generated/prisma/enums';
import { Problems } from '../http/problem';

/**
 * Server-side RBAC (03 §3). Hiding buttons in the UI is cosmetic only; every handler is wrapped
 * by route() which enforces the access level, and handlers call requireOwner() for resources.
 */
export type AccessLevel = 'public' | 'user' | 'moderator' | 'streamer';

/** A Desenvolvedor (2026-11-13) has the streamer's access level; src/server/users/admin.ts adds
 *  the few differences (who names one, who can act on one). */
export const ROLE_RANK: Record<Role, number> = {
  USER: 0,
  MODERATOR: 1,
  SUPER_MODERATOR: 2,
  STREAMER: 2,
};
const LEVEL_RANK: Record<Exclude<AccessLevel, 'public'>, number> = {
  user: 0,
  moderator: 1,
  streamer: 2,
};

export function meetsAccess(role: Role, level: AccessLevel): boolean {
  if (level === 'public') return true;
  return ROLE_RANK[role] >= LEVEL_RANK[level];
}

export function isPrivileged(role: Role): boolean {
  return role !== 'USER';
}

/**
 * Ownership check. A foreign resource answers 404 (not 403) so its existence doesn't leak.
 * `allowRole` lets moderators/streamer act on others' resources where the matrix allows it.
 */
export function requireOwner(
  ownerId: string | null | undefined,
  actor: { id: string; role: Role },
  allowRole?: Exclude<AccessLevel, 'public' | 'user'>,
): void {
  if (ownerId && ownerId === actor.id) return;
  if (allowRole && meetsAccess(actor.role, allowRole)) return;
  throw Problems.notFound();
}
