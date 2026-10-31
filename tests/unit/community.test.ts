/** Phase 6 helpers that need no database: link addresses, platform names, hours and minutes. */
import { describe, expect, it } from 'vitest';
import { hoursMinutes } from '@/components/live/ProgressBlock';
import { cleanLinkUrl, displayHost, platformOf } from '@/lib/links';
import { NAV_ITEMS } from '@/components/layout/nav-items';

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
  it('desktop: eight tabs; phones: five in the bar + "Mais" with the other three', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      'Filmes',
      'Séries',
      'Franquias',
      'Cronograma',
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
