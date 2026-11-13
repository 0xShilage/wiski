/**
 * Super Moderador (2026-11-13): the streamer names one from Pessoas; a Super Moderador gets the
 * streamer's pages (refunds, roles) under its own tag, but can't name another or touch a peer.
 * Screenshots go to test-results/super-moderador.
 */
import { mkdirSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { seedUser, signIn } from './support/seed';

const SHOTS = 'test-results/super-moderador';
mkdirSync(SHOTS, { recursive: true });

async function find(page: Page, username: string) {
  await page.getByLabel('Nome de usuário').fill(username);
  await page.getByRole('button', { name: 'Buscar' }).click();
  const row = page.locator('.wf-ops-row', { hasText: `@${username}` });
  await expect(row).toHaveCount(1);
  return row;
}

test('the streamer names a Super Moderador; one has the streamer pages but not over peers', async ({
  page,
  context,
}, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'the dashboard flow runs once');
  page.on('dialog', (d) => void d.accept());

  const streamer = await seedUser({ role: 'STREAMER', passkeyVerified: true });
  const mod = await seedUser({ role: 'MODERATOR' });
  await signIn(context, streamer.token);
  await page.goto('/admin/pessoas');
  let row = await find(page, mod.username!);
  await row.getByRole('button', { name: 'Tornar Super Moderador' }).click();
  await expect(page.getByRole('status')).toContainText('Papel alterado');
  await expect(row.locator('.wf-role-tag--super')).toHaveText('✦Super Moderador');
  await expect(row.getByRole('button', { name: 'Voltar para moderação' })).toBeVisible();

  // now as a Super Moderador
  await context.clearCookies();
  const sup = await seedUser({ role: 'SUPER_MODERATOR', passkeyVerified: true });
  await signIn(context, sup.token);
  await page.goto('/admin/pessoas');
  await expect(page.locator('.wf-admin__me .wf-role-tag--super')).toBeVisible();
  // a peer: no buttons that change the account
  row = await find(page, mod.username!);
  await expect(row.getByRole('button', { name: /Tornar|Tirar|Voltar|Suspender|VIP/ })).toHaveCount(
    0,
  );
  // a moderator: in and out of moderation, never "Super Moderador"
  const other = await seedUser({ role: 'MODERATOR' });
  row = await find(page, other.username!);
  await expect(row.getByRole('button', { name: 'Tirar da moderação' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Tornar Super Moderador' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/pessoas.png`, animations: 'disabled' });

  // the dashboard pages with the streamer's tools open
  for (const path of ['/admin/pedidos', '/admin/configuracoes']) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
  }
});
