import { describe, expect, it } from 'vitest';
import {
  authenticationResponseSchema,
  registrationResponseSchema,
} from '@/server/auth/passkey-schemas';

/** base64url text of `bytes` bytes (content doesn't matter here, only the size). */
const b64u = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3));

const assertion = (signatureBytes: number) => ({
  id: b64u(32),
  rawId: b64u(32),
  type: 'public-key',
  clientExtensionResults: {},
  response: {
    clientDataJSON: b64u(250),
    authenticatorData: b64u(37),
    signature: b64u(signatureBytes),
  },
});

const attestation = (spkiBytes: number, authDataBytes: number) => ({
  id: b64u(32),
  rawId: b64u(32),
  type: 'public-key',
  clientExtensionResults: {},
  response: {
    clientDataJSON: b64u(250),
    attestationObject: b64u(authDataBytes + 30),
    authenticatorData: b64u(authDataBytes),
    publicKeyAlgorithm: -48,
    publicKey: b64u(spkiBytes),
  },
});

describe('passkey response bounds', () => {
  it('accepts classic and post-quantum (ML-DSA) signatures', () => {
    for (const bytes of [72 /* ES256 */, 256 /* RS256 */, 2420 /* ML-DSA-44 */, 4627 /* -87 */])
      expect(authenticationResponseSchema.safeParse(assertion(bytes)).success, `${bytes}`).toBe(
        true,
      );
  });

  it('still refuses an oversized signature', () => {
    expect(authenticationResponseSchema.safeParse(assertion(4628)).success).toBe(false);
  });

  it('accepts an ML-DSA-87 public key with the longest credential id', () => {
    // 37 + 16 + 2 + 1023 (credential id) + 2602 (COSE ML-DSA-87 key)
    expect(registrationResponseSchema.safeParse(attestation(2614, 3680)).success).toBe(true);
    expect(registrationResponseSchema.safeParse(attestation(2615, 3680)).success).toBe(false);
  });
});
