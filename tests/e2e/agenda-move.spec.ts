/**
 * Agenda QoL (2026-11-13): an event dragged from one live onto another (and back with "Mover
 * para…"), and "Dias sem live" marked in the dashboard and shown on the Cronograma. Screenshots
 * go to test-results/agenda-move.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/agenda-move';
mkdirSync(SHOTS, { recursive: true });
test.describe.configure({ mode: 'serial' });

const spDay = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));

test('an event is dragged to another live and moved back with "Mover para…"', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the agenda is a desktop tool');
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const a = randomUUID();
  const b = randomUUID();
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO "StreamSession"(id, "startsAt", "capacityMinutes", "updatedAt")
       VALUES ($1, now() + interval '50 days', 300, now()), ($2, now() + interval '51 days', 277, now())`,
      [a, b],
    );
    await c.query(
      `INSERT INTO "LiveSegment"(id, "sessionId", kind, label, minutes) VALUES ($1, $2, 'EVENT', 'Karaokê da Iara', 40)`,
      [randomUUID(), a],
    );
    await c.query(`UPDATE "StreamSession" SET "bookedMinutes" = 40 WHERE id = $1`, [a]);
  });
  const ctx = await browser.newContext();
  await signIn(ctx, mod.token);
  const admin = await ctx.newPage();
  await admin.goto('/admin/agenda');

  const cards = admin.getByRole('region', { name: /Sessão de/ });
  const withEvent = cards.filter({ hasText: 'Karaokê da Iara' });
  await expect(withEvent).toHaveCount(1);
  const from = withEvent.first();
  await expect(from).toContainText('40 de 300 min agendados');
  const fromLabel = await from.getAttribute('aria-label');
  // the other new session (an unusual capacity to find it among the seeded ones)
  const target = cards.filter({ hasText: '0 de 277 min agendados' });
  await expect(target).toHaveCount(1);
  const toLabel = await target.getAttribute('aria-label');

  const row = from.locator('li', { hasText: 'Karaokê da Iara' });
  await expect(row).toHaveAttribute('draggable', 'true');
  // grab the row by its title (the picker in the middle of the row is a form control)
  await row.locator('.wf-ops-row__title').dragTo(target.getByRole('heading', { level: 3 }));
  await expect(admin.getByText(/^Movido para .*: feito\.$/)).toBeVisible();
  const moved = admin.getByRole('region', { name: toLabel! });
  await expect(moved).toContainText('Karaokê da Iara');
  await expect(moved).toContainText('40 de 277 min agendados');
  await expect(admin.getByRole('region', { name: fromLabel! })).not.toContainText('Karaokê');
  await moved.screenshot({ path: `${SHOTS}/agenda-depois-de-arrastar.png` });

  // back with the picker (no mouse needed)
  const picker = moved.getByLabel('Mover “Karaokê da Iara” para outra live');
  const back = await picker
    .locator('option', { hasText: fromLabel!.replace('Sessão de ', '') })
    .getAttribute('value');
  await picker.selectOption(back!);
  await moved.getByRole('button', { name: 'Mover', exact: true }).click();
  await expect(admin.getByText(/^Movido para .*: feito\.$/)).toBeVisible();
  await expect(admin.getByRole('region', { name: fromLabel! })).toContainText('Karaokê da Iara');

  await withDb((c) => c.query(`DELETE FROM "StreamSession" WHERE id = ANY($1)`, [[a, b]]));
  await ctx.close();
});

test('a trip is marked in the dashboard and shows on the Cronograma with its note', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the agenda is a desktop tool');
  await withDb((c) => c.query(`DELETE FROM "LiveDayOff"`));
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, mod.token);
  const admin = await ctx.newPage();
  await admin.goto('/admin/agenda');

  const card = admin.getByRole('region', { name: 'Dias sem live' });
  await expect(card).toContainText('Nenhum dia sem live marcado.');
  const form = card.getByRole('form', { name: 'Marcar dia sem live' });
  await form.getByLabel('Dia', { exact: true }).fill(spDay(20));
  await form.getByLabel(/^Até/).fill(spDay(23));
  await form.getByLabel('Motivo').selectOption('VIAGEM');
  await form.getByLabel(/Recado público/).fill('Show em São Paulo, volto com maratona!');
  await form.getByRole('button', { name: 'Marcar sem live' }).click();
  await expect(admin.getByText('Dia sem live marcado: feito.')).toBeVisible();
  await expect(card.getByRole('listitem')).toHaveCount(1);
  await expect(card.getByRole('listitem')).toContainText('Viagem · de ');
  await card.screenshot({ path: `${SHOTS}/agenda-dias-sem-live.png` });

  // the same days again → refused, the list stays
  await form.getByLabel('Dia', { exact: true }).fill(spDay(22));
  await form.getByLabel(/^Até/).fill('');
  await form.getByRole('button', { name: 'Marcar sem live' }).click();
  await expect(admin.getByText('Já existe um dia sem live marcado nessas datas.')).toBeVisible();

  const pub = await (await browser.newContext()).newPage();
  await pub.goto('/cronograma');
  const off = pub.getByRole('article', { name: 'Sem live: Viagem' });
  await expect(off).toContainText('Sem live · Viagem');
  await expect(off).toContainText('(4 dias)');
  await expect(off).toContainText('“Show em São Paulo, volto com maratona!”');

  await card.getByRole('button', { name: 'Tirar' }).click();
  await expect(admin.getByText('Dia sem live removido: feito.')).toBeVisible();
  await expect(card).toContainText('Nenhum dia sem live marcado.');
  await ctx.close();
});

test('the Cronograma shows a day off among the lives', async ({ page }, info) => {
  const owner = await seedUser({ role: 'MODERATOR' });
  await withDb(async (c) => {
    await c.query(`DELETE FROM "LiveDayOff"`);
    await c.query(
      `INSERT INTO "LiveDayOff"(id, "startsOn", "endsOn", reason, note, "createdById")
       VALUES ($1, $2::date, $2::date, 'FOLGA', 'Descansando a voz, até amanhã!', $3)`,
      [randomUUID(), spDay(1), owner.id],
    );
  });
  await page.goto('/cronograma');
  const off = page.getByRole('article', { name: 'Sem live: Folga' });
  await expect(off).toContainText('Neste dia');
  await expect(off).toContainText('Descansando a voz');
  await off.locator('xpath=..').screenshot({
    path: `${SHOTS}/cronograma-folga-${info.project.name}.png`,
  });
  await withDb((c) => c.query(`DELETE FROM "LiveDayOff"`));
});
