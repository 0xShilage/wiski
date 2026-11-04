/**
 * 2026-11-04: badge rules, catalog filters and sort, the queue-position estimate, the analytics
 * buckets, ranking ties and the São Paulo month. Pure functions, no database.
 */
import { describe, expect, it } from 'vitest';
import { earnedAchievements, evaluateAchievements } from '@/lib/achievements';
import {
  bucketSums,
  bucketsFor,
  changePercent,
  granularityOf,
  niceTicks,
  parseDays,
  periodStart,
} from '@/lib/analytics';
import {
  filterCatalog,
  filterQuery,
  genresOf,
  isFiltering,
  parseFilter,
} from '@/lib/catalog/filter';
import type { PublicItem } from '@/lib/catalog/types';
import { countdownText, placeOnSession } from '@/lib/queue-position';
import { monthStart, withPositions } from '@/server/community/rankings';

const stats = (o: Partial<Parameters<typeof evaluateAchievements>[0]> = {}) => ({
  sponsorships: 0,
  contributions: 0,
  reviews: 0,
  likes: 0,
  memberDays: 0,
  vip: false,
  ...o,
});

describe('badges', () => {
  it('earned at the threshold, with progress shown up to the target', () => {
    const r = evaluateAchievements(stats({ sponsorships: 5, reviews: 3, likes: 60 }));
    const by = Object.fromEntries(r.map((a) => [a.id, a]));
    expect(by['sponsor-1']!.earned).toBe(true);
    expect(by['sponsor-5']!.earned).toBe(true);
    expect(by['sponsor-10']).toMatchObject({ earned: false, value: 5, target: 10 });
    expect(by['review-10']).toMatchObject({ earned: false, value: 3 });
    expect(by['likes-50']!.earned).toBe(true);
    expect(by['likes-50']!.value).toBe(50); // capped at the target
    expect(by.vip!.earned).toBe(false);
  });

  it('a fresh account earns nothing; VIP and a year of account count', () => {
    expect(earnedAchievements(stats())).toEqual([]);
    expect(earnedAchievements(stats({ vip: true, memberDays: 365 })).map((a) => a.id)).toEqual([
      'member-365',
      'vip',
    ]);
    expect(earnedAchievements(stats({ memberDays: 364 }))).toEqual([]);
  });
});

const item = (o: Partial<PublicItem>): PublicItem =>
  ({
    id: o.title ?? 'x',
    kind: 'MOVIE',
    slug: 'x',
    slot: 1,
    title: 'X',
    originalTitle: null,
    year: 2000,
    runtimeMinutes: 100,
    ageRating: null,
    genres: [],
    synopsis: '',
    director: null,
    cast: [],
    seasonsLabel: null,
    seasonCount: null,
    episodeCount: null,
    trailerYoutubeId: null,
    posterTitle: false,
    poster: null,
    backdrop: null,
    logo: null,
    state: 'ACTIVE',
    watchedAt: null,
    priceCents: 2000,
    manualPrice: false,
    sponsorName: null,
    campaign: null,
    films: [],
    ...o,
  }) as PublicItem;

describe('catalog filters and sort', () => {
  const movies = [
    item({
      title: 'Ação Total',
      genres: ['Ação'],
      runtimeMinutes: 88,
      year: 1999,
      priceCents: 1500,
    }),
    item({
      title: 'Drama Longo',
      genres: ['Drama'],
      runtimeMinutes: 150,
      year: 2020,
      priceCents: 3000,
    }),
    item({
      title: 'Comédia',
      genres: ['Comédia', 'Drama'],
      runtimeMinutes: 105,
      year: null,
      priceCents: null,
      director: 'Fulana de Tal',
    }),
  ];
  const titles = (f: Partial<ReturnType<typeof parseFilter>>) =>
    filterCatalog(movies, { ...parseFilter({}, 'movies'), ...f }).map((m) => m.title);

  it('search ignores accents and case and also looks at director and cast', () => {
    expect(titles({ q: 'acao' })).toEqual(['Ação Total']);
    expect(titles({ q: 'FULANA' })).toEqual(['Comédia']);
    expect(titles({ q: 'nada disso' })).toEqual([]);
  });

  it('genre, duration buckets, and sorts with missing values last', () => {
    expect(titles({ genero: 'drama' })).toEqual(['Drama Longo', 'Comédia']);
    expect(titles({ duracao: 'ate-90' })).toEqual(['Ação Total']);
    expect(titles({ duracao: '90-120' })).toEqual(['Comédia']);
    expect(titles({ duracao: 'mais-120' })).toEqual(['Drama Longo']);
    expect(titles({ ordem: 'preco-asc' })).toEqual(['Ação Total', 'Drama Longo', 'Comédia']);
    expect(titles({ ordem: 'preco-desc' })).toEqual(['Drama Longo', 'Ação Total', 'Comédia']);
    expect(titles({ ordem: 'recentes' })).toEqual(['Drama Longo', 'Ação Total', 'Comédia']);
    expect(titles({ ordem: 'curtos' })).toEqual(['Ação Total', 'Comédia', 'Drama Longo']);
    expect(titles({ ordem: 'az' })).toEqual(['Ação Total', 'Comédia', 'Drama Longo']);
    expect(titles({})).toEqual(['Ação Total', 'Drama Longo', 'Comédia']); // curated order
  });

  it('campaigns: closest to the goal first; deadline order skips closed campaigns', () => {
    const c = (raised: number, deadlineDays: number, state = 'OPEN') =>
      ({
        id: 'c',
        goalCents: 10_000,
        raisedCents: raised,
        remainingCents: 10_000 - raised,
        supporterCount: 1,
        deadlineAt: new Date(Date.now() + deadlineDays * 86_400_000).toISOString(),
        extensions: 0,
        state,
      }) as PublicItem['campaign'];
    const list = [
      item({ title: 'A', campaign: c(2_000, 10) }),
      item({ title: 'B', campaign: c(9_000, 30) }),
      item({ title: 'C', campaign: c(5_000, 2, 'FUNDED') }),
    ];
    const f = parseFilter({}, 'campaigns');
    expect(filterCatalog(list, { ...f, ordem: 'meta' }).map((i) => i.title)).toEqual([
      'B',
      'C',
      'A',
    ]);
    expect(filterCatalog(list, { ...f, ordem: 'prazo' }).map((i) => i.title)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('the address: unknown values fall back; the query only carries what is set', () => {
    expect(parseFilter({ ordem: 'meta', duracao: 'x', genero: 'Drama' }, 'movies')).toEqual({
      q: '',
      genero: 'Drama',
      duracao: '',
      ordem: 'destaque', // "meta" is a campaign sort
    });
    expect(parseFilter({ duracao: 'ate-90' }, 'campaigns').duracao).toBe('');
    expect(filterQuery({ q: ' duna ', genero: '', duracao: 'mais-120', ordem: 'az' })).toBe(
      '?q=duna&duracao=mais-120&ordem=az',
    );
    expect(filterQuery(parseFilter({}, 'movies'))).toBe('');
    expect(isFiltering(parseFilter({}, 'movies'))).toBe(false);
    expect(genresOf(movies)).toEqual(['Ação', 'Comédia', 'Drama']);
  });
});

describe('queue position', () => {
  const t0 = new Date('2026-11-10T23:00:00Z'); // 20:00 BRT
  const e = (id: string, runtimeMinutes: number, done = false) => ({ id, runtimeMinutes, done });

  it('counts only titles still to play; the estimate adds the runtimes before it', () => {
    const p = placeOnSession([e('a', 100, true), e('b', 90), e('c', 120)], 'c', t0, t0, false);
    expect(p).toEqual({
      position: 2,
      total: 2,
      estimatedAt: new Date(t0.getTime() + 90 * 60_000),
    });
    expect(placeOnSession([e('b', 90)], 'zzz', t0, t0, false)).toBeNull();
  });

  it('a live running late estimates from now, not from the planned start', () => {
    const late = new Date(t0.getTime() + 30 * 60_000);
    const p = placeOnSession([e('b', 60), e('c', 60)], 'c', t0, late, true);
    expect(p?.estimatedAt).toEqual(new Date(late.getTime() + 60 * 60_000));
  });

  it('countdown text', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    const plus = (min: number) => new Date(now.getTime() + min * 60_000);
    expect(countdownText(plus(0.5), now)).toBe('agora');
    expect(countdownText(plus(8), now)).toBe('8 min');
    expect(countdownText(plus(5 * 60 + 12), now)).toBe('5h 12min');
    expect(countdownText(plus(2 * 1440 + 3 * 60 + 40), now)).toBe('2d 03h');
  });
});

describe('analytics buckets', () => {
  const now = new Date('2026-11-04T15:00:00Z'); // 12:00 BRT, a Wednesday

  it('periods: days up to 31, weeks up to 120, months beyond; unknown → 30', () => {
    expect([7, 30, 90, 365].map((d) => granularityOf(d as 7))).toEqual([
      'day',
      'day',
      'week',
      'month',
    ]);
    expect(parseDays('90')).toBe(90);
    expect(parseDays('5')).toBe(30);
    expect(parseDays(undefined)).toBe(30);
  });

  it('7 days: one bucket per BRT day, the first at midnight BRT', () => {
    const b = bucketsFor(7, now);
    expect(b).toHaveLength(7);
    expect(b[0]!.label).toBe('29/10');
    expect(b.at(-1)!.label).toBe('04/11');
    expect(new Date(b[0]!.start).toISOString()).toBe('2026-10-29T03:00:00.000Z');
    expect(periodStart(7, now).toISOString()).toBe('2026-10-29T03:00:00.000Z');
  });

  it('90 days: Monday weeks; 12 months: calendar months', () => {
    const w = bucketsFor(90, now);
    expect(new Date(w[0]!.start - 3 * 3_600_000).getUTCDay()).toBe(1);
    expect(w.at(-1)!.label).toBe('02/11');
    const m = bucketsFor(365, now);
    expect(m.at(-1)!.label).toBe('nov/26');
    expect(m[0]!.label).toBe('nov/25');
    expect(m).toHaveLength(13);
  });

  it('sums by bucket; change vs before; clean ticks', () => {
    const b = bucketsFor(7, now);
    const sums = bucketSums(b, [
      { at: b[0]!.start, value: 100 },
      { at: b[0]!.end - 1, value: 50 },
      { at: b[6]!.start + 1, value: 7 },
      { at: b[0]!.start - 1, value: 999 }, // before the period
    ]);
    expect(sums).toEqual([150, 0, 0, 0, 0, 0, 7]);
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(50, 100)).toBe(-50);
    expect(changePercent(5, 0)).toBeNull();
    expect(niceTicks(930)).toEqual([0, 250, 500, 750, 1000]);
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(40)).toEqual([0, 10, 20, 30, 40]);
  });
});

describe('ranking helpers', () => {
  it('equal values share a position (1, 2, 2, 4)', () => {
    expect(
      withPositions([{ value: 9 }, { value: 5 }, { value: 5 }, { value: 1 }]).map(
        (r) => r.position,
      ),
    ).toEqual([1, 2, 2, 4]);
  });

  it('"este mês" starts at midnight of the 1st in São Paulo', () => {
    // 00:30 BRT on Dec 1 = 03:30 UTC → December
    expect(monthStart(new Date('2026-12-01T03:30:00Z')).toISOString()).toBe(
      '2026-12-01T03:00:00.000Z',
    );
    // 23:30 BRT on Nov 30 = 02:30 UTC Dec 1 → still November
    expect(monthStart(new Date('2026-12-01T02:30:00Z')).toISOString()).toBe(
      '2026-11-01T03:00:00.000Z',
    );
  });
});
