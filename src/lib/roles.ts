/**
 * Staff roles (2026-11-13), shared by the server and the dashboard. The server enforces access
 * through route() and src/server/rbac; these helpers keep the UI and the rules in step.
 */
export type RoleName = 'USER' | 'MODERATOR' | 'SUPER_MODERATOR' | 'STREAMER';
export type StaffRole = Exclude<RoleName, 'USER'>;

/** UI names. SUPER_MODERATOR is shown as "Desenvolvedor" (renamed 2026-11-13; the stored value
 *  stays, since audit-log row hashes include the actor's role). */
export const ROLE_LABEL: Record<RoleName, string> = {
  USER: '',
  MODERATOR: 'Moderação',
  SUPER_MODERATOR: 'Desenvolvedor',
  STREAMER: 'Streamer',
};

/** The streamer's powers: refunds, roles, settings, campaigns, permanent removals… */
export function hasStreamerPowers(role: RoleName): boolean {
  return role === 'STREAMER' || role === 'SUPER_MODERATOR';
}

/**
 * Whether `actor` may change `target`'s account (suspend, VIP, role): never the streamer's, and a
 * Desenvolvedor's only by the streamer.
 */
export function canActOn(actor: RoleName, target: RoleName): boolean {
  if (target === 'STREAMER') return false;
  if (target === 'SUPER_MODERATOR') return actor === 'STREAMER';
  return true;
}

/** Roles `actor` may give (the streamer alone names Desenvolvedores; nobody names a streamer). */
export function assignableRoles(actor: RoleName): RoleName[] {
  if (actor === 'STREAMER') return ['USER', 'MODERATOR', 'SUPER_MODERATOR'];
  if (actor === 'SUPER_MODERATOR') return ['USER', 'MODERATOR'];
  return [];
}

/** A dashboard page's viewer is staff (the gate lets nobody else in). */
export function staffRole(role: RoleName): StaffRole {
  return role === 'USER' ? 'MODERATOR' : role;
}
