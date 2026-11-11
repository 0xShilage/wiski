/**
 * Showcase (2026-11-11): the 3D poster tilt, the Assistidos poster wall, "Em breve" on the
 * Cronograma and the membership card on /perfil. Screenshots go to test-results/showcase.
 */
import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { seedUser, signIn } from './support/seed';

const SHOTS = 'test-results/showcase';
mkdirSync(SHOTS, { recursive: true });
const isPhone = (name: string) => name.startsWith('mobile');

/** CSP refusals and hydration errors the page logs while `fn` runs. */
async function consoleProblems(page: Page, fn: () => Promise<void>) {
  const seen: string[] = [];
  const onMsg = (m: { text: () => string }) => {
    const t = m.text();
    if (/Content Security Policy|Refused to apply|Hydration|did not match/i.test(t)) seen.push(t);
  };
  page.on('console', onMsg);
  await fn();
  page.off('console', onMsg);
  return seen;
}

test('tilt: a catalog card leans toward the mouse and settles back (never on touch)', async ({
  page,
}, info) => {
  await page.goto('/');
  const card = page.locator('.wf-scard[data-tilt]').first();
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  const problems = await consoleProblems(page, async () => {
    // the top-right corner: leans right and back
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.15, { steps: 4 });
    if (isPhone(info.project.name)) {
      await expect(card).not.toHaveClass(/is-tilting/);
      return;
    }
    await expect(card).toHaveClass(/is-tilting/);
    const tilt = await card.evaluate((el) => ({
      rx: parseFloat(el.style.getPropertyValue('--tilt-rx')),
      ry: parseFloat(el.style.getPropertyValue('--tilt-ry')),
      transform: getComputedStyle(el).transform,
    }));
    expect(tilt.ry).toBeGreaterThan(4);
    expect(tilt.rx).toBeGreaterThan(4);
    expect(tilt.transform).not.toBe('none');
    await page.screenshot({
      path: `${SHOTS}/tilt.png`,
      clip: {
        x: Math.max(0, box.x - 24),
        y: Math.max(0, box.y - 24),
        width: box.width + 48,
        height: box.height + 48,
      },
    });
    // leaving: flat again, the custom properties gone
    await page.mouse.move(2, box.y + box.height / 2, { steps: 4 });
    await expect(card).not.toHaveClass(/is-tilting/);
    expect(await card.evaluate((el) => el.style.getPropertyValue('--tilt-ry'))).toBe('');
  });
  expect(problems).toEqual([]);
});

test('assistidos: an edge-to-edge poster wall with the title on hover (always on touch)', async ({
  page,
}, info) => {
  await page.goto('/assistidos');
  await expect(page.locator('.wf-wall__stat strong').first()).toHaveText(/^\d[\d.]*$/);
  await expect(page.locator('.wf-wall__stat')).toContainText('títulos');
  await expect(page.locator('.wf-wall__stat')).toContainText('juntos na live');
  const wall = page.getByRole('list', { name: 'Parede de pôsteres dos títulos assistidos' });
  await expect(wall).toBeVisible();
  const tile = wall.locator('.wf-wall__tile').first();
  const cap = tile.locator('.wf-wall__cap');
  await expect(tile.locator('img')).toHaveAttribute('src', /^\/media\//);
  // the poster fills its column at 2:3 (an aspect-ratio box once shrank to the row's height)
  const size = await tile.evaluate((t) => {
    const p = t.querySelector('.wf-wall__poster')!.getBoundingClientRect();
    return { tile: t.getBoundingClientRect().width, w: p.width, h: p.height };
  });
  expect(size.w).toBeGreaterThan(size.tile - 2);
  expect(size.h / size.w).toBeCloseTo(1.5, 1);
  const viewport = page.viewportSize()!;
  const wallBox = (await wall.boundingBox())!;
  // spans the window, wider than the page column above it
  expect(wallBox.width).toBeGreaterThan(viewport.width - 64);
  if (isPhone(info.project.name)) {
    await expect(cap.locator('.wf-seen__title')).toBeVisible();
    await expect(cap.locator('.wf-seen__meta').first()).toBeHidden();
  } else {
    await expect.poll(() => cap.evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
    await tile.hover();
    await expect.poll(() => cap.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    await expect(cap).toContainText('Assistido em');
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/wall-${info.project.name}.png` });
});

test('cronograma: "Em breve" shows the next live, its titles with a ribbon and a ticking countdown', async ({
  page,
}, info) => {
  const problems = await consoleProblems(page, async () => {
    await page.goto('/cronograma');
    const soon = page.getByRole('region', { name: 'Em breve' });
    await expect(soon).toBeVisible();
    await expect(soon).toContainText('Próxima live');
    // the seed's next live: tomorrow 20:00 with its note and the sponsored movie
    await expect(soon).toContainText('Sessão com pipoca e chat aberto');
    const timer = soon.getByRole('timer');
    await expect(timer).toHaveAttribute('aria-label', /^Começa em /);
    const card = soon.locator('a.wf-soon__card').first();
    await expect(card).toHaveAttribute('href', /^\/filmes\//);
    await expect(card.locator('.wf-soon__ribbon')).toHaveText('Em breve');
    // it ticks
    const secs = soon.locator('.wf-countdown__n').last();
    const first = await secs.textContent();
    await expect.poll(() => secs.textContent(), { timeout: 4_000 }).not.toBe(first);
    await soon.scrollIntoViewIfNeeded();
    await soon.screenshot({ path: `${SHOTS}/em-breve-${info.project.name}.png` });
  });
  expect(problems).toEqual([]);
});

test('perfil: the membership card with tier, numbers and member number', async ({
  browser,
}, info) => {
  const v = await seedUser();
  const ctx = await browser.newContext();
  await signIn(ctx, v.token);
  const page = await ctx.newPage();
  try {
    await page.goto('/perfil');
    const card = page.getByRole('region', { name: 'Carteirinha de sócio' });
    await expect(card).toBeVisible();
    await expect(card).toContainText(`@${v.username}`);
    await expect(card).toContainText('Sócio desde');
    await expect(card).toContainText('Espectador'); // a new account: nothing sponsored yet
    await expect(card).toContainText(/Nº \d{4} \d{4}/);
    for (const label of ['Filmes patrocinados', 'Contribuições', 'Minutos de live', 'Avaliações'])
      await expect(card.getByRole('term').filter({ hasText: label })).toBeVisible();
    await expect(card).toContainText('Faltam 1 patrocínio ou contribuição para Sócio.');
    // the account buttons moved next to the card
    await expect(card.getByRole('link', { name: 'Perfil público' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Sair' })).toBeVisible();
    await page.waitForTimeout(300);
    await card.screenshot({ path: `${SHOTS}/member-card-${info.project.name}.png` });
  } finally {
    await ctx.close();
  }
});
