import { randomBytes, randomInt } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A well-formed, random order public code ("WF-" + 6 Crockford base32 chars). */
export function testPublicCode(): string {
  let s = 'WF-';
  for (let i = 0; i < 6; i++) s += CROCKFORD[randomInt(32)];
  return s;
}

/** A random guest buyer key (each test order is its own buyer unless a test says otherwise). */
export function testBuyerKey(): string {
  return `e:${randomBytes(32).toString('hex')}`;
}
