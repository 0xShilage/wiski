/**
 * Every page at 360 px and 1280 px (Playwright projects): axe (WCAG 2.2 A/AA) clean, no
 * horizontal scroll, header visible (dashboard: its own shell). Screenshots go to test-results/screenshots for review.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PAGES } from './support/pages';
import { seedFor, signIn } from './support/seed';

for (const p of PAGES) {
  test(`${p.name}: accessible and fits the viewport`, async ({ page, context }, info) => {
    let username = 'perfil_publico';
    if (p.auth || typeof p.path === 'function') {
      const seeded = await seedFor(p.auth);
      if (seeded.username) username = seeded.username;
      if (p.auth) await signIn(context, seeded.token);
    }
    const path = typeof p.path === 'function' ? p.path(username) : p.path;
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    if (p.shell !== false) {
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('contentinfo')).toBeVisible();
    }
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');

    await page.screenshot({
      path: `test-results/screenshots/${info.project.name}/${p.name}.png`,
      fullPage: true,
    });
  });
}
