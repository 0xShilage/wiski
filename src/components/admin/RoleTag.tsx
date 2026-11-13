import { ROLE_LABEL, type RoleName } from '@/lib/roles';

const SLUG = {
  USER: 'user',
  MODERATOR: 'mod',
  SUPER_MODERATOR: 'super',
  STREAMER: 'streamer',
} as const;

/** A staff role's name as a small tag; the Desenvolvedor's has its own </> mark and colour. */
export function RoleTag({ role, label }: { role: RoleName; label?: string }) {
  const text = label ?? ROLE_LABEL[role];
  if (!text) return null;
  return (
    <span className={`wf-role-tag wf-role-tag--${SLUG[role]}`}>
      {role === 'SUPER_MODERATOR' ? (
        <span className="wf-role-tag__star" aria-hidden="true">
          {'</>'}
        </span>
      ) : null}
      {text}
    </span>
  );
}
