import { describe, expect, it } from 'vitest';
import {
  type Recap,
  defaultRecapYear,
  hoursLabel,
  isRecapSeason,
  parseRecapYear,
  personaOf,
} from '@/lib/recap';

const mine = (over: Partial<Recap['mine']> = {}): Recap['mine'] => ({
  sponsorships: 0,
  sponsored: [],
  contributions: 0,
  supported: [],
  minutes: 0,
  reviews: 0,
  averageRating: null,
  likesReceived: 0,
  topReview: null,
  suggestions: 0,
  suggestionsTaken: 0,
  spins: 0,
  prizes: 0,
  badges: [],
  ...over,
});

describe('recap rules', () => {
  it('years follow São Paulo; January looks back at last year', () => {
    expect(defaultRecapYear(new Date('2026-11-12T12:00:00Z'))).toBe(2026);
    // 1 Jan 2027 01:00 UTC is still 31 Dec 2026 in São Paulo
    expect(defaultRecapYear(new Date('2027-01-01T01:00:00Z'))).toBe(2026);
    expect(defaultRecapYear(new Date('2027-01-20T12:00:00Z'))).toBe(2026);
    expect(defaultRecapYear(new Date('2027-02-01T12:00:00Z'))).toBe(2027);
    // the site's first January has nothing before it
    expect(defaultRecapYear(new Date('2026-01-10T12:00:00Z'))).toBe(2026);
  });

  it('?ano= only for years since the site opened, up to now', () => {
    const now = new Date('2027-03-01T12:00:00Z');
    expect(parseRecapYear('2026', now)).toBe(2026);
    expect(parseRecapYear('2027', now)).toBe(2027);
    expect(parseRecapYear('2025', now)).toBeNull();
    expect(parseRecapYear('2028', now)).toBeNull();
    expect(parseRecapYear('20x6', now)).toBeNull();
    expect(parseRecapYear(['2026'], now)).toBeNull();
    expect(parseRecapYear(undefined, now)).toBeNull();
  });

  it('season: December and January only', () => {
    expect(isRecapSeason(new Date('2026-11-30T12:00:00Z'))).toBe(false);
    expect(isRecapSeason(new Date('2026-12-01T12:00:00Z'))).toBe(true);
    expect(isRecapSeason(new Date('2027-01-31T12:00:00Z'))).toBe(true);
    expect(isRecapSeason(new Date('2027-02-01T12:00:00Z'))).toBe(false);
  });

  it('hours', () => {
    expect(hoursLabel(45)).toBe('45 min');
    expect(hoursLabel(120)).toBe('2 h');
    expect(hoursLabel(135)).toBe('2 h 15 min');
    expect(hoursLabel(60 * 1234)).toBe('1.234 h');
  });

  it('the role is what the viewer did most', () => {
    expect(personaOf(mine()).id).toBe('primeira-fila');
    expect(personaOf(mine({ reviews: 4, sponsorships: 1 })).id).toBe('critica');
    expect(personaOf(mine({ contributions: 2, sponsorships: 1 })).id).toBe('vaquinha');
    expect(personaOf(mine({ suggestions: 2, suggestionsTaken: 1 })).id).toBe('curadoria');
    expect(personaOf(mine({ spins: 30 })).id).toBe('primeira-fila');
    expect(personaOf(mine({ spins: 30, prizes: 2 })).id).toBe('roleta');
    // a tie goes to the one listed first
    expect(personaOf(mine({ sponsorships: 2, contributions: 3 })).id).toBe('patrocinio');
  });
});
