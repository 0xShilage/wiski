/**
 * Roleta end to end (2026-11-04): the page signed out (wheel, odds, sign-in link), a viewer's 5
 * spins until "Sem giros hoje", and a prize going from the viewer (Twitch login) to the
 * moderation (Admin › Roleta, "Marcar como entregue") and back.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

test.describe.configure({ mode: 'serial' });

test('signed out: the wheel, the odds and a sign-in link back here', async ({ page }) => {
  await page.goto('/roleta');
  await expect(page.getByRole('heading', { level: 1, name: 'Roleta' })).toBeVisible();
  await expect(page.locator('.wf-roleta__wheel')).toBeVisible();
  await expect(page.locator('.wf-roleta__wheel .wf-roleta__slice')).toHaveCount(9);
  const odds = page.getByRole('table');
  await expect(odds.getByRole('row', { name: /Cupom de 30%/ })).toContainText('1 em 150');
  await expect(odds.getByRole('row', { name: /VIP na Twitch/ })).toContainText('1 em 2.500');
  await expect(odds.getByRole('row', { name: /^Nada/ })).toContainText('98,99%');
  await expect(page.getByRole('link', { name: 'Entrar com Google' })).toHaveAttribute(
    'href',
    /returnTo=%2Froleta/,
  );
  await expect(page.getByRole('button', { name: 'Girar' })).toHaveCount(0);
});

test('a viewer spins five times, then the button waits for 17h', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'one run is enough (data is shared)');
  const viewer = await seedUser();
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  await signIn(ctx, viewer.token);
  const page = await ctx.newPage();
  await page.goto('/roleta');
  await expect(page.locator('.wf-roleta__left strong')).toHaveText('5');
  const btn = page.getByRole('button', { name: 'Girar' });
  for (let left = 4; left >= 0; left--) {
    await btn.click();
    await expect(page.locator('.wf-roleta__left strong')).toHaveText(String(left));
    await expect(page.locator('.wf-roleta__result .wf-toast')).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Sem giros hoje' })).toBeDisabled();
  await expect(page.locator('.wf-roleta__fine')).toContainText(/Novos giros (hoje|amanhã) às 17h/);
  const n = await withDb(async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM "RoletaSpin" WHERE "userId" = $1`,
      [viewer.id],
    );
    return Number(r.rows[0]!.n);
  });
  expect(n).toBe(5);
  await ctx.close();
});

test('a won movie: the viewer gives their Twitch login, a moderator marks it delivered', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'one run is enough (data is shared)');
  const viewer = await seedUser();
  // today's period: the BRT day on which the last 17:00 fell
  await withDb((c) =>
    c.query(
      `INSERT INTO "RoletaSpin"(id, "userId", period, n, prize, slot, status, "createdAt")
       VALUES ($1, $2, ((now() AT TIME ZONE 'America/Sao_Paulo') - interval '17 hours')::date,
               1, 'FILME', 0, 'PENDING', now())`,
      [randomUUID(), viewer.id],
    ),
  );
  const vctx = await browser.newContext();
  await signIn(vctx, viewer.token);
  const page = await vctx.newPage();
  await page.goto('/roleta');
  const mine = page.getByRole('region', { name: 'Seus prêmios' });
  const prize = mine.getByRole('listitem').filter({ hasText: 'Filme grátis' });
  await expect(prize).toContainText('Aguardando entrega');
  await expect(page.locator('.wf-roleta__left strong')).toHaveText('4');
  await prize.getByLabel('Seu usuário da Twitch').fill('@Fa_Da_Iara');
  await prize.getByRole('button', { name: 'Salvar' }).click();
  await expect(prize.getByRole('status')).toContainText('Salvo!');

  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const mctx = await browser.newContext();
  await signIn(mctx, mod.token);
  const admin = await mctx.newPage();
  await admin.goto('/admin/roleta');
  const card = admin.locator('.wf-ops-card').filter({ hasText: `@${viewer.username}` });
  await expect(card).toContainText('Filme grátis');
  await expect(card).toContainText('Twitch: fa_da_iara');
  await card.getByRole('button', { name: 'Marcar como entregue' }).click();
  await expect(admin.getByRole('status')).toContainText('Prêmio entregue');
  await expect(
    admin.locator('.wf-ops-card').filter({ hasText: `@${viewer.username}` }),
  ).toHaveCount(0);

  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Seus prêmios' }).getByRole('listitem').first(),
  ).toContainText('Entregue');
  await vctx.close();
  await mctx.close();
});
