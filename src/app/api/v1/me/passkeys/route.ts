import { isMfaFresh, listPasskeys } from '@/server/auth/passkeys';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';

/** GET /api/v1/me/passkeys — my passkeys (no key material) and whether this session is verified. */
export const GET = route(
  { methods: ['GET'], access: 'moderator', mfa: false, rateLimit: RL.passkey },
  async ({ user, session }) => ({
    verified: isMfaFresh(session),
    items: (await listPasskeys(user.id)).map((p) => ({
      id: p.id,
      label: p.label,
      createdAt: p.createdAt.toISOString(),
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      synced: p.backedUp,
    })),
  }),
);
