import { randomBytes, randomUUID } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A public order code in the production format ("WF-" + 6 Crockford base32 characters). */
export function testPublicCode(): string {
  const bytes = randomBytes(6);
  return `WF-${[...bytes].map((b) => CROCKFORD[b % 32]).join('')}`;
}

/** A guest buyer key ("e:" + 64 hex), unique per call. */
export function testBuyerKey(): string {
  return `e:${randomBytes(32).toString('hex')}`;
}

/** The identity columns every Order row needs, unique per call (direct DB tests only). */
export function orderIdentity() {
  return {
    publicCode: testPublicCode(),
    contactEmail: 'guest@example.com',
    buyerKey: testBuyerKey(),
    accessTokenHash: new Uint8Array(randomBytes(32)),
    breakdown: [],
    clientRequestId: randomUUID(),
  };
}
