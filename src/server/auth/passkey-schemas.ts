import 'server-only';
import { z } from 'zod';

/**
 * Bounded shapes of the JSON @simplewebauthn/browser produces. The library re-parses and verifies
 * every byte; these schemas only keep oversized or unexpected input away from it (.strict()).
 *
 * Sizes fit the largest WebAuthn algorithm, ML-DSA-87 (post-quantum; COSE -50): signature 4627
 * bytes, public key 2592 bytes. SimpleWebAuthn offers ML-DSA-44 first whenever the Node runtime
 * supports it (Node 24 does), and browsers have started to pick it — its 2420-byte signature
 * overflowed the old 2048-character limit and every passkey check failed with 422.
 * base64url length = ceil(bytes × 4 / 3).
 */
const MAX_SIGNATURE_B64U = 6170; // ML-DSA-87 signature (4627 bytes)
const MAX_SPKI_B64U = 3486; // ML-DSA-87 SubjectPublicKeyInfo (2614 bytes)
// authenticatorData with attested credential: 37 + 16 + 2 + credential id (≤ 1023) + COSE key
// (ML-DSA-87 ≈ 2602) ≈ 3680 bytes → 4907 characters; attestationObject wraps it (fmt "none").
const MAX_AUTH_DATA_B64U = 6144;
const b64u = (max: number) =>
  z
    .string()
    .regex(/^[\w-]+$/)
    .max(max);
const transport = z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
const extensions = z
  .record(z.string().max(40), z.unknown())
  .refine((r) => Object.keys(r).length <= 8 && JSON.stringify(r).length <= 1024, 'too large');

export const registrationResponseSchema = z
  .object({
    id: b64u(1366),
    rawId: b64u(1366),
    type: z.literal('public-key'),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
    clientExtensionResults: extensions,
    response: z
      .object({
        clientDataJSON: b64u(4096),
        attestationObject: b64u(8192),
        authenticatorData: b64u(MAX_AUTH_DATA_B64U).optional(),
        transports: z.array(transport).max(8).optional(),
        publicKeyAlgorithm: z.int().optional(),
        publicKey: b64u(MAX_SPKI_B64U).optional(),
      })
      .strict(),
  })
  .strict();

export const authenticationResponseSchema = z
  .object({
    id: b64u(1366),
    rawId: b64u(1366),
    type: z.literal('public-key'),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
    clientExtensionResults: extensions,
    response: z
      .object({
        clientDataJSON: b64u(4096),
        authenticatorData: b64u(4096),
        signature: b64u(MAX_SIGNATURE_B64U),
        userHandle: b64u(512).optional(),
      })
      .strict(),
  })
  .strict();
