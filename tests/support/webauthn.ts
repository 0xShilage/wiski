/**
 * A minimal software authenticator (ES256, "none" attestation) for passkey tests. It produces
 * exactly the JSON @simplewebauthn/browser would send, and can be told to misbehave: wrong
 * origin, wrong RP ID, a counter that goes backwards, no user verification.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

// ── tiny CBOR encoder (maps, byte/text strings, ints) ──────────────────────────
function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;
function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const b = Buffer.from(v, 'utf8');
    return Buffer.concat([head(3, b.length), b]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  const parts = [head(5, v.size)];
  for (const [k, val] of v) parts.push(cbor(k), cbor(val));
  return Buffer.concat(parts);
}

const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

export type Ceremony = { challenge: string };

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  counter = 0;

  constructor(
    readonly origin: string,
    readonly rpId = new URL(origin).hostname,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    this.publicJwk = { x: jwk.x, y: jwk.y };
  }

  private authData(flags: number, withCredential: boolean, rpId: string): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter >>> 0);
    const parts: Buffer[] = [sha256(rpId), Buffer.from([flags]), counter];
    if (withCredential) {
      const cose = new Map<Cbor, Cbor>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(this.publicJwk.x, 'base64url')],
        [-3, Buffer.from(this.publicJwk.y, 'base64url')],
      ]);
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), idLen, Buffer.from(this.credentialId), cbor(cose)); // aaguid = zeros
    }
    return Buffer.concat(parts);
  }

  /** navigator.credentials.create() → RegistrationResponseJSON */
  register(
    options: Ceremony,
    over: { origin?: string; rpId?: string; userVerified?: boolean } = {},
  ) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: options.challenge,
        origin: over.origin ?? this.origin,
        crossOrigin: false,
      }),
    );
    const flags = 0x01 | (over.userVerified === false ? 0 : 0x04) | 0x40; // UP | UV | AT
    const authData = this.authData(flags, true, over.rpId ?? this.rpId);
    const attestationObject = cbor(
      new Map<Cbor, Cbor>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', authData],
      ]),
    );
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: 'public-key' as const,
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ['internal' as const],
      },
    };
  }

  /** navigator.credentials.get() → AuthenticationResponseJSON (counter += 1 unless overridden) */
  assert(
    options: Ceremony,
    over: { origin?: string; rpId?: string; counter?: number; userVerified?: boolean } = {},
  ) {
    this.counter = over.counter ?? this.counter + 1;
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin: over.origin ?? this.origin,
        crossOrigin: false,
      }),
    );
    const flags = 0x01 | (over.userVerified === false ? 0 : 0x04);
    const authData = this.authData(flags, false, over.rpId ?? this.rpId);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, sha256(clientDataJSON)]),
      this.privateKey,
    );
    return {
      id: b64u(this.credentialId),
      rawId: b64u(this.credentialId),
      type: 'public-key' as const,
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
      },
    };
  }
}
