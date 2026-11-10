import { describe, expect, it } from 'vitest';
import { chatSafe, streamSafe, streamSafeName } from '@/lib/stream-safe';

describe('streamSafe (2026-11-09)', () => {
  it('keeps ordinary messages as they are', () => {
    expect(streamSafe('Amei o filme do macaco, Bambi e Piranha 3D!')).toEqual({
      shown: 'Amei o filme do macaco, Bambi e Piranha 3D!',
      spoken: 'Amei o filme do macaco, Bambi e Piranha 3D!',
    });
    expect(streamSafe('')).toBeNull();
    expect(streamSafe(null)).toBeNull();
  });

  it('drops links, also disguised ones', () => {
    expect(streamSafe('veja https://golpe.example/x agora')?.shown).toBe('veja agora');
    expect(streamSafe('entra em www.site.com.br')?.shown).toBe('entra em');
    expect(streamSafe('meu canal canalzinho . tv e fim')?.shown).toBe('meu canal e fim');
    expect(streamSafe('promo loja ponto com')?.shown).toBe('promo');
    expect(streamSafe('https://so-um-link.com')).toBeNull();
  });

  it('masks swear words, also with accents, digits and repeated letters', () => {
    expect(streamSafe('que filme da porra')).toEqual({
      shown: 'que filme da ***',
      spoken: 'que filme da',
    });
    expect(streamSafe('P0RRAAA, que CARÁLHO!')?.shown).toBe('***, que ***!');
    expect(streamSafe('vsf kkk')?.spoken).toBe('kkk');
    expect(streamSafe('merda')).toEqual({ shown: '***', spoken: '' });
  });

  it('a name that is a swear word or a link is not shown', () => {
    expect(streamSafeName('Tia Lu')).toBe('Tia Lu');
    expect(streamSafeName('@fulano_1')).toBe('@fulano_1');
    expect(streamSafeName('caralho')).toBeNull();
    expect(streamSafeName('meusite.com')).toBeNull();
  });

  it('a chat line never starts like a command', () => {
    expect(chatSafe('/ban fulano')).toBe('ban fulano');
    expect(chatSafe('  .timeout x')).toBe('timeout x');
    expect(chatSafe('!cmd')).toBe('cmd');
    expect(chatSafe('Tia Lu patrocinou X!')).toBe('Tia Lu patrocinou X!');
  });
});
