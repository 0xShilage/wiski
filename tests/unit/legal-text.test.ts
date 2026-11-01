/** The single legal text (2026-11-01): the markup parser and the published content. */
import { describe, expect, it } from 'vitest';
import { LEGAL_CONTROLLER, LEGAL_TEXT, LEGAL_UPDATED } from '@/content/legal/privacy';
import { type Block, type Inline, parseInline, parseLegal, sectionId } from '@/lib/legal-text';

const flat = (parts: Inline[]): string =>
  parts
    .map((p) =>
      p.t === 'text' ? p.v : p.t === 'b' ? flat(p.v) : p.t === 'a' ? p.href : `{${p.key}}`,
    )
    .join('');

describe('parser', () => {
  it('headings, paragraphs, lists (loose items merged), bold, links, blanks', () => {
    const blocks = parseLegal(
      [
        'Intro com **negrito** e <https://example.com/a?b=1>.',
        '## 1. TÍTULO',
        '### 1.1. Sub',
        '- um',
        '- dois: {email}',
        '- três',
        'Fim.',
      ].join('\n\n'),
      { email: null },
    );
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'h2', 'h3', 'ul', 'p']);
    expect(blocks[1]).toMatchObject({ id: 'secao-1', text: '1. TÍTULO' });
    expect(blocks[2]).toMatchObject({ id: 'secao-1-1' });
    const ul = blocks[3] as Extract<Block, { kind: 'ul' }>;
    expect(ul.items).toHaveLength(3);
    expect(ul.items[1]).toContainEqual({ t: 'blank', key: 'email', v: null });
    const intro = (blocks[0] as Extract<Block, { kind: 'p' }>).inlines;
    expect(intro).toContainEqual({ t: 'b', v: [{ t: 'text', v: 'negrito' }] });
    expect(intro).toContainEqual({ t: 'a', href: 'https://example.com/a?b=1' });
  });

  it('never turns text into markup: http, javascript and unknown placeholders stay text', () => {
    const parts = parseInline(
      '<http://x.example> <javascript:alert(1)> {constructor} {nope} <img src=x> **aberto',
      { email: 'a@b.co' },
    );
    expect(parts.every((p) => p.t === 'text')).toBe(true);
    expect(flat(parts)).toBe(
      '<http://x.example> <javascript:alert(1)> {constructor} {nope} <img src=x> **aberto',
    );
  });

  it('anchors come from the section numbers', () => {
    expect(sectionId('6.2. Mercado Pago — Processamento financeiro')).toBe('secao-6-2');
    expect(sectionId('Disposições Finais')).toBe('disposicoes-finais');
  });
});

describe('published text', () => {
  const blocks = parseLegal(LEGAL_TEXT, LEGAL_CONTROLLER);
  const h2 = blocks.filter((b) => b.kind === 'h2');

  it('sections 1–17 in order, unique anchors, the LGPD channel is section 1', () => {
    expect(h2.map((b) => b.id)).toEqual(Array.from({ length: 17 }, (_, i) => `secao-${i + 1}`));
    const ids = blocks.flatMap((b) => (b.kind === 'h2' || b.kind === 'h3' ? [b.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(h2[0]).toMatchObject({ text: '1. IDENTIFICAÇÃO DO CONTROLADOR' });
  });

  it('no markup or blank left over from the .docx', () => {
    const text = blocks
      .map((b) =>
        b.kind === 'p' ? flat(b.inlines) : b.kind === 'ul' ? b.items.map(flat).join(' ') : b.text,
      )
      .join('\n');
    expect(text).not.toMatch(/\*\*|\\|\[[\p{Lu} ]+\]|#{2}/u);
    expect(text).toContain('Lei nº 13.709/2018');
    // every placeholder is one of the known blanks
    for (const m of LEGAL_TEXT.matchAll(/\{([a-z]+)\}/g))
      expect(Object.keys(LEGAL_CONTROLLER)).toContain(m[1]);
  });

  it('third-party policies are https links', () => {
    const links = blocks.flatMap((b) =>
      b.kind === 'p' ? b.inlines.filter((p) => p.t === 'a').map((p) => p.href) : [],
    );
    expect(links).toEqual(
      expect.arrayContaining([
        'https://policies.google.com/privacy?hl=pt-BR',
        'https://www.mercadopago.com.br/privacidade/declaracao-privacidade/2.0',
        'https://www.cloudflare.com/pt-br/privacypolicy/',
      ]),
    );
    for (const l of links) expect(l).toMatch(/^https:\/\//);
  });

  it('a real date', () => {
    expect(LEGAL_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(LEGAL_UPDATED))).toBe(false);
  });
});
