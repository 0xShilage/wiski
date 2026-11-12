/** /.well-known/security.txt (RFC 9116, pentest 2026-11-11): present, well-formed, not expired. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chatSafe } from '@/lib/stream-safe';

const txt = readFileSync(
  join(import.meta.dirname, '../../public/.well-known/security.txt'),
  'utf8',
);

describe('security.txt', () => {
  it('has a Contact and an Expires less than a year away, still in the future', () => {
    expect(txt).toMatch(/^Contact: https:\/\/wiski\.fun\/contato$/m);
    const expires = new Date(/^Expires: (.+)$/m.exec(txt)![1]!);
    const days = (expires.getTime() - Date.now()) / 86_400_000;
    // renew it (and this date) when it gets close: RFC 9116 asks for less than a year ahead
    expect(days, 'security.txt Expires is close: renew it').toBeGreaterThan(30);
    expect(days).toBeLessThan(370);
    expect(txt).toMatch(/^Canonical: https:\/\/wiski\.fun\/\.well-known\/security\.txt$/m);
  });
});

describe('chatSafe', () => {
  it('drops invisible characters and command prefixes from the start of a bot line', () => {
    expect(chatSafe('\u200b/ban iara patrocinou Duna!')).toBe('ban iara patrocinou Duna!');
    expect(chatSafe('\ufeff\u2060.timeout x')).toBe('timeout x');
    expect(chatSafe('Tia Lu patrocinou Duna!')).toBe('Tia Lu patrocinou Duna!');
  });
});
