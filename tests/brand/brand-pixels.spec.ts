/**
 * "Use the assets as-is" proof (06 §5 rule 3, 10 §2 step 3 & 4):
 *  - every ORIGINAL vs PROCESSED (lossless SVGO) SVG renders with 0 differing pixels at 2×
 *  - every SVGR component renders identically to the processed SVG it was generated from
 *  - the "Wiski" logo (glyph outlines) matches live text set in the Black Rockie font
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { componentName, svgEntries } from '../../scripts/brand-map';

const ROOT = join(import.meta.dirname, '../..');
const read = (p: string) => readFile(join(ROOT, p), 'utf8');
/** SSR markup of every generated component (tests/brand/global-setup.ts → render-components.tsx). */
const componentMarkup = async (name: string): Promise<string | undefined> =>
  (JSON.parse(await read('test-results/brand-components.json')) as Record<string, string>)[name];

function viewBoxSize(svg: string): [number, number] {
  const m = /viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(svg);
  if (!m) throw new Error('no viewBox');
  return [Number(m[1]), Number(m[2])];
}

const stripProlog = (svg: string) => svg.replace(/<\?xml[^>]*\?>\s*/, '');
const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

async function render(page: Page, inner: string, [w, h]: [number, number]): Promise<Buffer> {
  await page.setContent(
    `<!doctype html><html><head><style>
      html,body{margin:0;background:transparent}
      #box{width:${w}px;height:${h}px}
      #box>img,#box>svg{display:block;width:100%;height:100%}
    </style></head><body><div id="box">${inner}</div></body></html>`,
  );
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  return page.locator('#box').screenshot({ omitBackground: true, animations: 'disabled' });
}

async function countDiff(a: Buffer, b: Buffer): Promise<{ diff: number; total: number }> {
  const [ra, rb] = await Promise.all(
    [a, b].map((x) => sharp(x).ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  expect([rb!.info.width, rb!.info.height]).toEqual([ra!.info.width, ra!.info.height]);
  let diff = 0;
  for (let i = 0; i < ra!.data.length; i += 4) {
    if (
      ra!.data[i] !== rb!.data[i] ||
      ra!.data[i + 1] !== rb!.data[i + 1] ||
      ra!.data[i + 2] !== rb!.data[i + 2] ||
      ra!.data[i + 3] !== rb!.data[i + 3]
    ) {
      diff++;
    }
  }
  return { diff, total: ra!.data.length / 4 };
}

for (const entry of svgEntries()) {
  test.describe(entry.slug, () => {
    test('original ≡ processed (as image, 2×): 0 differing pixels', async ({ page }) => {
      const original = await read(`ASSETS/${entry.source}`);
      const processed = await read(`public/brand/${entry.slug}.svg`);
      const size = viewBoxSize(original);
      expect(viewBoxSize(processed)).toEqual(size);
      const a = await render(page, `<img alt="" src="${dataUri(original)}">`, size);
      const b = await render(page, `<img alt="" src="${dataUri(processed)}">`, size);
      const { diff } = await countDiff(a, b);
      expect(diff).toBe(0);
    });

    test('original ≡ processed (inline, 2×): 0 differing pixels', async ({ page }) => {
      const original = stripProlog(await read(`ASSETS/${entry.source}`));
      const processed = await read(`public/brand/${entry.slug}.svg`);
      const size = viewBoxSize(original);
      const a = await render(page, original, size);
      const b = await render(page, processed, size);
      const { diff, total } = await countDiff(a, b);
      expect(total).toBeGreaterThan(1000);
      expect(diff).toBe(0);
    });

    if (entry.component) {
      test('SVGR component ≡ processed SVG (inline, 2×): 0 differing pixels', async ({ page }) => {
        const processed = await read(`public/brand/${entry.slug}.svg`);
        const markup = await componentMarkup(componentName(entry.slug));
        expect(markup, `component ${componentName(entry.slug)}`).toBeDefined();
        expect(markup).not.toMatch(/style=|<style/);
        const size = viewBoxSize(processed);
        const a = await render(page, processed, size);
        const b = await render(page, markup!, size);
        const { diff } = await countDiff(a, b);
        expect(diff).toBe(0);
      });
    }
  });
}

test('logo "Wiski" outlines match live text set in Black Rockie', async ({ page }) => {
  const meta = JSON.parse(await read('public/brand/logo-wiski.json')) as {
    text: string;
    unitsPerEm: number;
    box: { x1: number; y1: number; x2: number; y2: number };
  };
  const svg = (await read('public/brand/logo-wiski-ink.svg')).replace(
    /fill="#[0-9a-f]{6}"/,
    'fill="#000"',
  );
  const font = await readFile(join(ROOT, 'ASSETS/FONTS/Black Rockie/BlackRockie.ttf'));

  await page.setContent('<!doctype html><html><body></body></html>');
  const result = await page.evaluate(
    async ({ fontData, svgUri, meta }) => {
      const face = new FontFace(
        'LiveBlackRockie',
        Uint8Array.from(atob(fontData), (c) => c.charCodeAt(0)),
      );
      document.fonts.add(await face.load());
      const F = 240; // px
      const s = F / meta.unitsPerEm;
      const pad = 20;
      const W = Math.ceil(meta.box.x2 * s) + 2 * pad;
      const H = Math.ceil((meta.box.y2 - meta.box.y1) * s) + 2 * pad;
      const baseline = pad - meta.box.y1 * s;

      const canvas = (draw: (c: CanvasRenderingContext2D) => void) => {
        const el = document.createElement('canvas');
        el.width = W;
        el.height = H;
        const ctx = el.getContext('2d')!;
        draw(ctx);
        return ctx.getImageData(0, 0, W, H).data;
      };
      const text = canvas((ctx) => {
        ctx.font = `${F}px LiveBlackRockie`;
        ctx.fontKerning = 'normal';
        ctx.fillStyle = '#000';
        ctx.fillText(meta.text, pad, baseline);
      });
      const img = new Image();
      img.src = svgUri;
      await img.decode();
      const outline = canvas((ctx) => {
        ctx.drawImage(
          img,
          pad + meta.box.x1 * s,
          baseline + meta.box.y1 * s,
          (meta.box.x2 - meta.box.x1) * s,
          (meta.box.y2 - meta.box.y1) * s,
        );
      });
      // A pixel "mismatches" when no pixel within 1 px in the other rendering has a similar
      // coverage: anti-aliasing/hinting may move an edge by < 1 px, a different shape cannot.
      const alpha = (d: Uint8ClampedArray, x: number, y: number) => d[(y * W + x) * 4 + 3]!;
      const near = (d: Uint8ClampedArray, x: number, y: number, v: number) => {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < W && ny < H && Math.abs(alpha(d, nx, ny) - v) <= 96)
              return true;
          }
        return false;
      };
      let ink = 0;
      let mismatch = 0;
      let strict = 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const a = alpha(text, x, y);
          const b = alpha(outline, x, y);
          if (a > 127 || b > 127) ink++;
          if (Math.abs(a - b) > 96) {
            strict++;
            if (!near(outline, x, y, a) || !near(text, x, y, b)) mismatch++;
          }
        }
      return { ink, mismatch, strict };
    },
    { fontData: font.toString('base64'), svgUri: dataUri(svg), meta },
  );
  expect(result.ink).toBeGreaterThan(20_000);
  // Same glyphs, kerning and position: differences are edge shifts from the browser's text
  // hinting (≤ 1 px), plus a handful of hinted hairline pixels (< 0.1 % of the ink).
  console.log(
    `logo vs live text: ${result.strict} edge pixels differ (${((100 * result.strict) / result.ink).toFixed(2)} % of ink), ${result.mismatch} beyond 1 px`,
  );
  expect(result.mismatch / result.ink).toBeLessThan(0.001);
  expect(result.strict / result.ink).toBeLessThan(0.03);
});
