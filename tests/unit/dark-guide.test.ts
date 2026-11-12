/**
 * Guia de Winden (2026-11-11): the spoiler gates. Nothing may show before its era is unlocked,
 * every link points at a real place, and moving back an episode hides what came after it.
 */
import { describe, expect, it } from 'vitest';
import {
  clampEpisode,
  EPISODE_COUNT,
  ERAS,
  erasUnlocked,
  allSlots,
  PEOPLE,
  peopleAt,
  peopleFor,
  PLACES,
  placesFor,
  SPOILERS,
  stagedText,
} from '@/lib/guides/dark-s1';
import { guideFor } from '@/lib/guides';

const eraFrom = Object.fromEntries(ERAS.map((e) => [e.id, e.from]));
const placeIds = new Set(PLACES.map((p) => p.id));

describe('the data', () => {
  it('ids are unique and every link points at a known place', () => {
    expect(new Set(PLACES.map((p) => p.id)).size).toBe(PLACES.length);
    expect(new Set(PEOPLE.map((p) => p.id)).size).toBe(PEOPLE.length);
    for (const p of PEOPLE)
      for (const v of p.versions)
        for (const id of v.places) expect(placeIds.has(id), id).toBe(true);
  });
  it('nothing is dated before its era unlocks, and staged texts only grow', () => {
    for (const p of PLACES)
      for (const [era, staged] of Object.entries(p.eras)) {
        expect(staged![0]!.from, `${p.id} ${era}`).toBeGreaterThanOrEqual(eraFrom[era]!);
        staged!.reduce((a, s) => (expect(s.from).toBeGreaterThan(a), s.from), 0);
      }
    for (const p of PEOPLE)
      for (const v of p.versions) {
        if (v.era) expect(v.from, `${p.id} ${v.era}`).toBeGreaterThanOrEqual(eraFrom[v.era]!);
        expect(v.text[0]!.from, p.id).toBe(v.from);
        v.text.reduce((a, s) => (expect(s.from).toBeGreaterThanOrEqual(a), s.from), 0);
        for (const s of v.text) expect(s.from).toBeLessThanOrEqual(EPISODE_COUNT);
      }
  });
  it('a person has at most one version per era', () => {
    for (const p of PEOPLE) {
      const eras = p.versions.map((v) => v.era);
      expect(new Set(eras).size, p.id).toBe(eras.length);
    }
  });
});

describe('the gates', () => {
  it('only 2019 at first; the other eras open later', () => {
    expect(erasUnlocked(1)).toEqual(['2019']);
    expect(erasUnlocked(EPISODE_COUNT)).toEqual(['2019', '1986', '1953']);
    expect(placesFor('1986', 2)).toEqual([]);
    expect(peopleFor('1953', 7)).toEqual([]);
  });
  it('episode 1 shows only episode-1 things', () => {
    for (const s of peopleFor('2019', 1)) expect(s.version.from).toBe(1);
    expect(peopleFor('2019', 1).some((s) => s.person.id === 'estranho')).toBe(false);
    expect(placesFor('2019', 1).some((p) => p.id === 'hotel')).toBe(false);
    expect(stagedText(PEOPLE.find((p) => p.id === 'ulrich')!.versions[0]!.text, 1)).not.toMatch(
      /1986/,
    );
  });
  it('going back an episode never shows more', () => {
    for (const era of ['2019', '1986', '1953'] as const)
      for (let ep = 2; ep <= EPISODE_COUNT; ep++) {
        const now = new Set(peopleFor(era, ep).map((s) => s.person.id));
        for (const s of peopleFor(era, ep - 1)) expect(now.has(s.person.id)).toBe(true);
        expect(placesFor(era, ep - 1).length).toBeLessThanOrEqual(placesFor(era, ep).length);
      }
  });
  it('a place lists only people shown in that era', () => {
    const here = peopleAt('escola', '2019', 1).map((s) => s.person.id);
    expect(here).toEqual(expect.arrayContaining(['jonas', 'martha', 'bartosz']));
    expect(peopleAt('hotel', '2019', 1)).toEqual([]); // the hotel isn't on the map yet
  });
  it('the episode from a link or storage is clamped', () => {
    expect(clampEpisode('4')).toBe(4);
    expect(clampEpisode('0')).toBe(1);
    expect(clampEpisode('11')).toBe(1);
    expect(clampEpisode('x')).toBe(1);
  });
});

describe('guideFor', () => {
  it('Dark (series) links to the guide; other titles do not', () => {
    expect(guideFor({ kind: 'SERIES', title: 'Dark' })?.href).toBe('/guias/dark');
    expect(guideFor({ kind: 'SERIES', title: 'Dark', originalTitle: 'Dark' })).not.toBeNull();
    expect(guideFor({ kind: 'MOVIE', title: 'Dark' })).toBeNull();
    expect(guideFor({ kind: 'SERIES', title: 'Dark Matter' })).toBeNull();
  });
});

describe('photo slots and spoilers (2026-11-12)', () => {
  it('one slot per person and era, in the shape the database accepts', () => {
    const slots = allSlots();
    expect(new Set(slots.map((s) => s.slot)).size).toBe(slots.length);
    for (const s of slots) expect(s.slot).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*:(?:19\d{2}|20\d{2})$/);
    expect(slots.map((s) => s.slot)).toEqual(expect.arrayContaining(['jonas:2019', 'ulrich:1986']));
  });
  it('the spoilers are only in the spoiler list, never in the spoiler-free data', () => {
    expect(SPOILERS.length).toBeGreaterThan(4);
    const safe = JSON.stringify({ PEOPLE, PLACES });
    for (const leak of ['Michael Kahnwald, o pai', 'Jonas, adulto', '2052', 'bunker', 'máquina'])
      expect(safe.includes(leak), leak).toBe(false);
  });
});
