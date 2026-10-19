/**
 * Fonts (10 §2 step 6): pt-BR glyph coverage of the served woff2 subsets, and no layout shift
 * on the header while fonts load.
 */
import { expect, test } from '@playwright/test';

const PT_BR = 'ÁÉÍÓÚÂÊÔÃÕÇÀÜáéíóúâêôãõçàüºª' + 'R$1.234,56—“”‘’…•';
/** Absent from the ORIGINAL display fonts (checked with opentype.js); the stack falls back to Poppins. */
const DISPLAY_FALLBACK = ['º', 'ª', '…'];

test('every pt-BR character exists in each font (display faces: only º ª … fall back)', async ({
  page,
}) => {
  await page.goto('/termos', { waitUntil: 'networkidle' });
  const missing = await page.evaluate(async (chars) => {
    const families: Record<string, string> = {};
    for (const cls of ['font-sans', 'font-display', 'font-brand']) {
      const el = document.createElement('span');
      el.className = cls;
      el.textContent = 'x';
      document.body.append(el);
      families[cls] = getComputedStyle(el).fontFamily.split(',')[0]!.trim();
      await document.fonts.load(`40px ${families[cls]}`, chars);
      el.remove();
    }
    const ctx = document.createElement('canvas').getContext('2d')!;
    const width = (font: string, ch: string) => {
      ctx.font = font;
      return ctx.measureText(ch).width;
    };
    const out: Record<string, string[]> = {};
    for (const [cls, family] of Object.entries(families)) {
      // A glyph the font lacks falls back, so its width changes with the fallback family.
      out[cls] = [...chars].filter(
        (ch) => width(`40px ${family}, monospace`, ch) !== width(`40px ${family}, serif`, ch),
      );
    }
    return { families, out };
  }, PT_BR);
  expect(missing.out['font-sans']).toEqual([]);
  for (const display of ['font-display', 'font-brand']) {
    expect(
      missing.out[display]!.filter((c) => !DISPLAY_FALLBACK.includes(c)),
      display,
    ).toEqual([]);
  }
});

test('no layout shift in the header while fonts load', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: { value: number; sources: string[] }[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        sources?: { node?: Node }[];
      }[]) {
        if (!e.hadRecentInput) {
          w.__shifts.push({
            value: e.value,
            sources: (e.sources ?? []).map((s) =>
              (s.node as Element | undefined)?.closest?.('header') ? 'header' : 'other',
            ),
          });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const before = await page.getByRole('banner').boundingBox();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  const after = await page.getByRole('banner').boundingBox();
  expect(after).toEqual(before);
  const shifts = await page.evaluate(
    () => (window as unknown as { __shifts: { value: number; sources: string[] }[] }).__shifts,
  );
  expect(shifts.filter((s) => s.sources.includes('header'))).toEqual([]);
  const cls = shifts.reduce((sum, s) => sum + s.value, 0);
  expect(cls).toBeLessThan(0.05);
});
