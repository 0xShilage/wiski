/** Showcase (2026-11-11): the "Em breve" countdown and the membership card's rules. */
import { describe, expect, it } from 'vitest';
import { countdownParts, countdownSentence, pad2 } from '@/lib/live/countdown';
import {
  barcodeBars,
  barcodeWidth,
  memberNumber,
  memberTier,
  nextMemberTier,
} from '@/lib/member-card';

const S = 1_000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;

describe('countdownParts', () => {
  it('splits the time left into days, hours, minutes and seconds', () => {
    const now = Date.UTC(2026, 10, 11, 12);
    expect(countdownParts(now + 2 * D + 4 * H + 31 * MIN + 12 * S, now)).toEqual({
      days: 2,
      hours: 4,
      minutes: 31,
      seconds: 12,
      done: false,
    });
  });
  it('is done (all zeros) at the start time and after it — a live can be late', () => {
    const now = 1_000_000;
    expect(countdownParts(now, now).done).toBe(true);
    expect(countdownParts(now - 5 * MIN, now)).toEqual({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      done: true,
    });
  });
  it('rounds down to the whole second', () => {
    expect(countdownParts(1_999, 0)).toMatchObject({ seconds: 1, done: false });
    expect(countdownParts(999, 0).done).toBe(true);
  });
});

describe('countdownSentence', () => {
  it('reads like a sentence, singular and plural, to the minute', () => {
    expect(countdownSentence(countdownParts(2 * D + 4 * H + 31 * MIN + 9 * S, 0))).toBe(
      'Começa em 2 dias, 4 horas e 31 minutos',
    );
    expect(countdownSentence(countdownParts(D + H + MIN, 0))).toBe(
      'Começa em 1 dia, 1 hora e 1 minuto',
    );
    expect(countdownSentence(countdownParts(3 * H, 0))).toBe('Começa em 3 horas');
    expect(countdownSentence(countdownParts(D + 5 * MIN, 0))).toBe('Começa em 1 dia e 5 minutos');
  });
  it('under a minute, and once it is time', () => {
    expect(countdownSentence(countdownParts(40 * S, 0))).toBe('Começa em menos de um minuto');
    expect(countdownSentence(countdownParts(0, 0))).toBe('Começa a qualquer momento');
  });
  it('pads two digits', () => {
    expect([pad2(0), pad2(7), pad2(42)]).toEqual(['00', '07', '42']);
  });
});

const tierOf = (sponsorships: number, contributions = 0) =>
  memberTier({ sponsorships, contributions }, 'USER').label;

describe('membership tiers', () => {
  it('follow the badge steps, counting sponsorships and contributions together', () => {
    expect(tierOf(0)).toBe('Espectador');
    expect(tierOf(1)).toBe('Sócio');
    expect(tierOf(0, 1)).toBe('Sócio');
    expect(tierOf(4)).toBe('Sócio');
    expect(tierOf(3, 2)).toBe('Sócio Prata');
    expect(tierOf(9)).toBe('Sócio Prata');
    expect(tierOf(10)).toBe('Sócio Ouro');
    expect(tierOf(24)).toBe('Sócio Ouro');
    expect(tierOf(20, 5)).toBe('Sócio Diamante');
    expect(tierOf(400)).toBe('Sócio Diamante');
  });
  it('staff and the streamer get their own card, with no "next tier"', () => {
    const stats = { sponsorships: 30, contributions: 0 };
    expect(memberTier(stats, 'STREAMER')).toEqual({ id: 'streamer', label: 'Streamer' });
    expect(memberTier(stats, 'MODERATOR')).toEqual({ id: 'staff', label: 'Moderação' });
    expect(memberTier(stats, 'SUPER_MODERATOR')).toEqual({ id: 'super', label: 'Desenvolvedor' });
    expect(nextMemberTier({ sponsorships: 0, contributions: 0 }, 'MODERATOR')).toBeNull();
  });
  it('says how many more it takes, and nothing at the top', () => {
    expect(nextMemberTier({ sponsorships: 0, contributions: 0 }, 'USER')).toEqual({
      label: 'Sócio',
      remaining: 1,
    });
    expect(nextMemberTier({ sponsorships: 6, contributions: 1 }, 'USER')).toEqual({
      label: 'Sócio Ouro',
      remaining: 3,
    });
    expect(nextMemberTier({ sponsorships: 25, contributions: 0 }, 'USER')).toBeNull();
  });
});

describe('member number and barcode', () => {
  const id = '0193a1b2-7c3d-7e4f-8a9b-0c1d2e3f4a5b';
  it('is eight digits in two groups, stable for the account, different between accounts', () => {
    expect(memberNumber(id)).toMatch(/^\d{4} \d{4}$/);
    expect(memberNumber(id)).toBe(memberNumber(id));
    expect(memberNumber(id)).not.toBe(memberNumber('0193a1b2-7c3d-7e4f-8a9b-0c1d2e3f4a5c'));
    expect(memberNumber(id).replace(' ', '')).not.toContain(id.replace(/-/g, '').slice(0, 8));
  });
  it('draws non-overlapping bars inside the computed width', () => {
    const bars = barcodeBars(memberNumber(id));
    expect(bars.length).toBe(2 + 8 * 2 + 2);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.x).toBeGreaterThanOrEqual(bars[i - 1]!.x + bars[i - 1]!.w);
    }
    expect(barcodeWidth(bars)).toBe(bars.at(-1)!.x + bars.at(-1)!.w);
    expect(barcodeBars('1234 5678')).toEqual(barcodeBars('1234 5678'));
  });
});
