import { describe, expect, it } from 'vitest';
import {
  AVATAR_BACKGROUND,
  AVATAR_KEYS,
  avatarColour,
  DEFAULT_AVATAR,
  resolveAvatarKey,
} from '@/lib/avatars';
import { normalizeUsername, usernameRuleViolation, usernameSchema } from '@/lib/username';
import { meetsAccess } from '@/server/rbac';
import { isStepUpFresh } from '@/server/auth/step-up';
import { uaFamilyFrom } from '@/server/auth/session';

describe('usernames', () => {
  it.each(['ana', 'ana_maria_99', 'x'.repeat(20), 'abc'])('accepts %j', (n) =>
    expect(usernameRuleViolation(n)).toBeNull(),
  );
  it.each([
    'ab',
    'x'.repeat(21),
    'Ana',
    'ana-maria',
    'ana.maria',
    'joão',
    'аna' /* Cyrillic а */,
    'admin',
    'wiski',
    'superwiskifan',
    'suporte_oficial',
    'conta',
    'moderadora',
  ])('refuses %j', (n) => expect(usernameRuleViolation(n)).not.toBeNull());
  it('normalises case and surrounding spaces only', () => {
    expect(normalizeUsername('  Ana_99 ')).toBe('ana_99');
    expect(usernameSchema.safeParse('ANA_99').data).toBe('ana_99');
    expect(usernameSchema.safeParse('a n a').success).toBe(false);
  });
});

describe('avatars', () => {
  it('20 presets = 4 poses × 5 colours; contrast backgrounds per 06 §7', () => {
    expect(AVATAR_KEYS).toHaveLength(20);
    expect(AVATAR_KEYS).toContain(DEFAULT_AVATAR);
    expect(AVATAR_BACKGROUND[avatarColour('mascote-1-lavender')]).toBe('bg-ink');
    expect(AVATAR_BACKGROUND[avatarColour('mascote-1-lilac')]).toBe('bg-plum');
    expect(AVATAR_BACKGROUND[avatarColour('mascote-1-ink')]).toBe('bg-lilac');
  });
  it('unknown keys from the DB fall back to the default', () => {
    expect(resolveAvatarKey('../../x')).toBe(DEFAULT_AVATAR);
    expect(resolveAvatarKey(null)).toBe(DEFAULT_AVATAR);
    expect(resolveAvatarKey('mascote-2-plum')).toBe('mascote-2-plum');
  });
});

describe('RBAC levels', () => {
  it('ranks USER < MODERATOR < STREAMER', () => {
    expect(meetsAccess('USER', 'public')).toBe(true);
    expect(meetsAccess('USER', 'moderator')).toBe(false);
    expect(meetsAccess('MODERATOR', 'moderator')).toBe(true);
    expect(meetsAccess('MODERATOR', 'streamer')).toBe(false);
    expect(meetsAccess('STREAMER', 'streamer')).toBe(true);
  });
});

describe('step-up freshness', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('fresh within 10 min, stale after', () => {
    expect(isStepUpFresh({ authTime: new Date(now.getTime() - 9 * 60_000) }, now)).toBe(true);
    expect(isStepUpFresh({ authTime: new Date(now.getTime() - 11 * 60_000) }, now)).toBe(false);
    expect(isStepUpFresh({ authTime: new Date(now.getTime() + 5 * 60_000) }, now)).toBe(false);
  });
});

describe('device labels', () => {
  it('keeps only a coarse family, never the raw user-agent', () => {
    expect(uaFamilyFrom('Chrome', 'Windows')).toBe('Chrome · Windows');
    expect(uaFamilyFrom('<script>', undefined)).toBe('script · Sistema');
    expect(uaFamilyFrom(undefined, undefined)).toBeNull();
  });
});
