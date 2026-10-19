import 'server-only';
import { z } from 'zod';

/**
 * Bounded shapes of the JSON @simplewebauthn/browser produces. The library re-parses and verifies
 * every byte; these schemas only keep oversized or unexpected input away from it (.strict()).
 */
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
        authenticatorData: b64u(4096).optional(),
        transports: z.array(transport).max(8).optional(),
        publicKeyAlgorithm: z.int().optional(),
        publicKey: b64u(2048).optional(),
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
        signature: b64u(2048),
        userHandle: b64u(512).optional(),
      })
      .strict(),
  })
  .strict();
