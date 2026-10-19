import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { verifyRegistration } from '@/server/auth/passkeys';
import { registrationResponseSchema } from '@/server/auth/passkey-schemas';
import { route } from '@/server/http/route';
import { RL } from '@/server/ratelimit/rules';
import { plainText } from '@/server/text/sanitize';

const body = z
  .object({
    response: registrationResponseSchema,
    label: z.string().max(40).optional(),
  })
  .strict();

/** POST /api/v1/me/passkeys/registration — finish enrolling (verifies the attestation). */
export const POST = route(
  {
    methods: ['POST'],
    access: 'moderator',
    mfa: false,
    stepUp: true,
    rateLimit: RL.passkey,
    body,
  },
  async ({ user, session, body, audit }) => {
    const label = body.label ? plainText(body.label) || null : null;
    const created = await verifyRegistration(
      user,
      session,
      body.response as RegistrationResponseJSON,
      label,
    );
    await audit({
      action: 'passkey.register',
      targetType: 'Passkey',
      targetId: created.id,
      metadata: {
        backedUp: created.backedUp,
        transports: created.transports as ('internal' | 'hybrid')[],
      },
    });
    return Response.json({ id: created.id }, { status: 201 });
  },
);
