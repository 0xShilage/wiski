/** Phase 6 helpers that need no database: link addresses, platform names, hours and minutes. */
import { describe, expect, it } from 'vitest';
import { hoursMinutes } from '@/components/live/ProgressBlock';
import { cleanLinkUrl, displayHost, platformOf } from '@/lib/links';
import { NAV_ITEMS } from '@/components/layout/nav-items';
import { PLATFORM_PATHS } from '@/components/links/platform-icons.generated';

describe('cleanLinkUrl', () => {
  it('adds https to a bare address and normalises it', () => {
    expect(cleanLinkUrl('twitch.tv/wiski')).toBe('https://twitch.tv/wiski');
    expect(cleanLinkUrl('HTTPS://Twitch.TV/Wiski')).toBe('https://twitch.tv/Wiski');
    expect(cleanLinkUrl('https://youtube.com/@wiski?si=a#b')).toBe(
      'https://youtube.com/@wiski?si=a#b',
    );
  });
  it.each([
    'http://twitch.tv/wiski',
    // eslint-disable-next-line no-script-url -- hostile input under test
    'javascript:alert(1)',
    // eslint-disable-next-line no-script-url -- hostile input under test
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,PHA+',
    'vbscript:x',
    'mailto:a@b.c',
    'https://a:b@twitch.tv',
    'https://twitch.tv:444/',
    'https://localhost',
    'https://10.0.0.1/',
    'https://[::1]/',
    'https://twitch.tv./',
    'https://twitch.tv/a b',
    '',
    `https://a.example/${'x'.repeat(300)}`,
  ])('refuses %s', (url) => {
    expect(cleanLinkUrl(url)).toBeNull();
  });
});

describe('labels', () => {
  it('platform names from the host only', () => {
    expect(platformOf('https://www.twitch.tv/wiski')).toBe('Twitch');
    expect(platformOf('https://youtu.be/abc')).toBe('YouTube');
    expect(platformOf('https://discord.gg/abc')).toBe('Discord');
    expect(platformOf('https://evil.example/twitch.tv')).toBeNull();
    expect(platformOf('https://twitch.tv.evil.example/')).toBeNull();
    expect(platformOf('https://www.amazon.com.br/hz/wishlist/ls/ABC123')).toBe('Amazon');
    expect(platformOf('https://amzn.to/3xyz')).toBe('Amazon');
    expect(platformOf('https://amazon.evil.example/hz/wishlist')).toBeNull();
    expect(platformOf('https://store.steampowered.com/wishlist/id/x')).toBe('Steam');
    expect(platformOf('https://kick.com/wiski')).toBe('Kick');
    expect(platformOf('https://cinefy.app/u/wiski')).toBe('Cinefy');
  });
  it('every platform has an icon (brand glyph or a drawn one)', () => {
    const drawn = new Set(['Amazon', 'Cinefy']);
    for (const url of [
      'https://instagram.com/a',
      'https://twitch.tv/a',
      'https://discord.gg/a',
      'https://steamcommunity.com/id/a',
      'https://youtube.com/@a',
      'https://facebook.com/a',
      'https://letterboxd.com/a',
      'https://kick.com/a',
      'https://tiktok.com/@a',
    ]) {
      const p = platformOf(url);
      expect(p, url).not.toBeNull();
      expect(PLATFORM_PATHS[p!], url).toMatch(/^M[\d.\sA-Za-z,-]+$/);
      expect(drawn.has(p!)).toBe(false);
    }
    expect(displayHost('https://www.exemplo.com.br/a')).toBe('exemplo.com.br');
  });
  it('hours and minutes', () => {
    expect(hoursMinutes(0)).toBe('0 min');
    expect(hoursMinutes(45)).toBe('45 min');
    expect(hoursMinutes(60)).toBe('1 h');
    expect(hoursMinutes(125)).toBe('2 h 5 min');
    expect(hoursMinutes(123_456)).toBe('2.057 h 36 min');
  });
});

describe('navigation', () => {
  it('desktop: nine tabs; phones: five in the bar + "Mais" with the other four', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      'Filmes',
      'Séries',
      'Franquias',
      'Cronograma',
      'Assistidos',
      'Avaliações',
      'Sugestões',
      'Links',
      'Perfil',
    ]);
    expect(NAV_ITEMS.filter((i) => i.mobile === 'bar').map((i) => i.label)).toEqual([
      'Filmes',
      'Séries',
      'Franquias',
      'Cronograma',
      'Perfil',
    ]);
  });
});

describe('dashboard upload downscale', () => {
  it('posters/backdrops cover their box, logos fit inside; never upscaled', async () => {
    const { downscaleFactor } = await import('@/lib/media-downscale');
    expect(downscaleFactor('POSTER', 600, 900)).toBe(1);
    expect(downscaleFactor('POSTER', 2400, 3600)).toBe(0.5); // → 1200 × 1800
    // wider than 2:3: the height decides, so the 2:3 crop is still ≥ 1200 × 1800
    expect(downscaleFactor('POSTER', 4000, 3600)).toBe(0.5);
    expect(downscaleFactor('BACKDROP', 5120, 2880)).toBe(0.5);
    expect(downscaleFactor('BACKDROP', 1920, 1080)).toBe(1);
    expect(downscaleFactor('LOGO', 3840, 960)).toBe(0.5);
  });
});
