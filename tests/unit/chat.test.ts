/** Chat da live (2026-11-11): the rules shared by the panel and the server. */
import { describe, expect, it } from 'vitest';
import { CHAT_MAX, chatLength, chatProblem, expand, oneLine, placeholdersIn } from '@/lib/chat';

describe('chat rules', () => {
  it('one line, as Twitch shows it', () => {
    expect(oneLine('  oi\n\nchat\t!  ')).toBe('oi chat !');
    expect(oneLine('a\u0000b c')).toBe('a b c');
  });
  it('counts emoji as one character', () => {
    expect(chatLength('🍿🎥')).toBe(2);
  });
  it('fills placeholders and lists the ones with no value', () => {
    const vars = { site: 'wiski.fun', agora: null, proxima: 'sexta, 13/11 às 20:00' };
    expect(expand('{site} · {proxima}', vars)).toEqual({
      text: 'wiski.fun · sexta, 13/11 às 20:00',
      missing: [],
    });
    expect(expand('Agora: {agora} {agora}', vars).missing).toEqual(['agora']);
    expect(placeholdersIn('{site} {nope} {site}')).toEqual(['site']);
  });
  it('nothing invisible in front of a command gets it past the check (pentest 2026-11-11)', () => {
    for (const sneaky of [
      '\u200b/ban x',
      '\u2060.timeout x',
      '\ufeff/mod x',
      '\u00a0 /ban x',
      '\u202e/ban x',
    ])
      expect(chatProblem(oneLine(sneaky)), JSON.stringify(sneaky)).toMatch(/Comandos/);
    // emoji sequences keep their joiners
    expect(oneLine('👨\u200d👩\u200d👧 oi')).toBe('👨\u200d👩\u200d👧 oi');
  });
  it('refuses commands, empty and over-long lines; "!" commands are text', () => {
    expect(chatProblem('')).toMatch(/Escreva/);
    expect(chatProblem('/ban x')).toMatch(/Comandos/);
    expect(chatProblem('.timeout x')).toMatch(/Comandos/);
    expect(chatProblem('!proximo')).toBeNull();
    expect(chatProblem('x'.repeat(CHAT_MAX))).toBeNull();
    expect(chatProblem('x'.repeat(CHAT_MAX + 1))).toMatch(/500/);
  });
});
