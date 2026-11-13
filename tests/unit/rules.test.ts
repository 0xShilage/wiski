import { describe, expect, it } from 'vitest';
import {
  AVATAR_COLOR_ORDER,
  AVATAR_KEYS,
  avatarLabel,
  avatarSrc,
  DEFAULT_AVATAR,
  resolveAvatarKey,
} from '@/lib/avatars';
import { normalizeUsername, usernameRuleViolation, usernameSchema } from '@/lib/username';
import { meetsAccess } from '@/server/rbac';
import { ROLE_LABEL, assignableRoles, canActOn, hasStreamerPowers, staffRole } from '@/lib/roles';
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
  it('45 hand-made presets; the default is one of them; the picker order holds each once', () => {
    expect(AVATAR_KEYS).toHaveLength(45);
    expect(AVATAR_KEYS[0]).toBe('perfil-01');
    expect(AVATAR_KEYS.at(-1)).toBe('perfil-45');
    expect(AVATAR_KEYS).toContain(DEFAULT_AVATAR);
    expect(avatarLabel('perfil-07')).toBe('Avatar 7');
    expect(avatarSrc('perfil-07', 48)).toBe('/avatars/perfil-07-128.webp');
    expect(avatarSrc('perfil-07', 96)).toBe('/avatars/perfil-07-256.webp');
    expect([...AVATAR_COLOR_ORDER].sort()).toEqual([...AVATAR_KEYS]);
  });
  it('unknown and retired keys from the DB fall back to the default', () => {
    expect(resolveAvatarKey('../../x')).toBe(DEFAULT_AVATAR);
    expect(resolveAvatarKey(null)).toBe(DEFAULT_AVATAR);
    expect(resolveAvatarKey('mascote-2-plum')).toBe(DEFAULT_AVATAR);
    expect(resolveAvatarKey('perfil-46')).toBe(DEFAULT_AVATAR);
    expect(resolveAvatarKey('perfil-12')).toBe('perfil-12');
  });
});

describe('RBAC levels', () => {
  it('ranks USER < MODERATOR < SUPER_MODERATOR = STREAMER', () => {
    expect(meetsAccess('USER', 'public')).toBe(true);
    expect(meetsAccess('USER', 'moderator')).toBe(false);
    expect(meetsAccess('MODERATOR', 'moderator')).toBe(true);
    expect(meetsAccess('MODERATOR', 'streamer')).toBe(false);
    expect(meetsAccess('STREAMER', 'streamer')).toBe(true);
    expect(meetsAccess('SUPER_MODERATOR', 'streamer')).toBe(true);
    expect(meetsAccess('SUPER_MODERATOR', 'moderator')).toBe(true);
  });

  it('Super Moderador: the streamer names one; nobody but the streamer acts on one', () => {
    expect(hasStreamerPowers('SUPER_MODERATOR')).toBe(true);
    expect(hasStreamerPowers('MODERATOR')).toBe(false);
    expect(canActOn('SUPER_MODERATOR', 'MODERATOR')).toBe(true);
    expect(canActOn('SUPER_MODERATOR', 'SUPER_MODERATOR')).toBe(false);
    expect(canActOn('SUPER_MODERATOR', 'STREAMER')).toBe(false);
    expect(canActOn('STREAMER', 'SUPER_MODERATOR')).toBe(true);
    expect(canActOn('MODERATOR', 'SUPER_MODERATOR')).toBe(false);
    expect(assignableRoles('STREAMER')).toEqual(['USER', 'MODERATOR', 'SUPER_MODERATOR']);
    expect(assignableRoles('SUPER_MODERATOR')).toEqual(['USER', 'MODERATOR']);
    expect(assignableRoles('MODERATOR')).toEqual([]);
    expect(staffRole('SUPER_MODERATOR')).toBe('SUPER_MODERATOR');
    expect(ROLE_LABEL.SUPER_MODERATOR).toBe('Super Moderador');
  });
});

describe('step-up freshness', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('fresh within 10 min, stale after', () => {
    expect(isStepUpFresh({ authTime: new Date(now.getTime() - 9 * 60_000) }, now)).toBe(true);
    expect(isStepUpFresh({ authTime: new Date(now.getTime() - 11 * 60_000) }, now)).toBe(false);
    expect(isStepUpFresh({ authTime: new Date(now.getTime() + 5 * 60_000) }, now)).toBe(false);
    // 2026-11-01: a second-factor check in the last 10 minutes is a step-up too
    const old = new Date(now.getTime() - 60 * 60_000);
    expect(isStepUpFresh({ authTime: old, mfaAt: new Date(now.getTime() - 9 * 60_000) }, now)).toBe(
      true,
    );
    expect(
      isStepUpFresh({ authTime: old, mfaAt: new Date(now.getTime() - 11 * 60_000) }, now),
    ).toBe(false);
    expect(isStepUpFresh({ authTime: old, mfaAt: null }, now)).toBe(false);
  });
});

describe('device labels', () => {
  it('keeps only a coarse family, never the raw user-agent', () => {
    expect(uaFamilyFrom('Chrome', 'Windows')).toBe('Chrome · Windows');
    expect(uaFamilyFrom('<script>', undefined)).toBe('script · Sistema');
    expect(uaFamilyFrom(undefined, undefined)).toBeNull();
  });
});
