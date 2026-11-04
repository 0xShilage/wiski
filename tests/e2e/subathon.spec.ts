/**
 * Subathon timer (2026-11-03) end to end: the streamer creates and starts it in Admin › Subathon,
 * the OBS widget (real overlay key) counts down on its own, time added in the dashboard pops on
 * the widget over SSE, the chat command pauses it, and ending it shows "Fim do subathon!". StreamElements is off in e2e (no
 * token), which the dashboard says.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { seedUser, signIn, withDb } from './support/seed';

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop-1280', 'the dashboard and OBS are desktop tools');
});

async function overlayKey(widgets: string[]) {
  const raw = `wfo_${randomBytes(32).toString('base64url')}`;
  await withDb((c) =>
    c.query(
      `INSERT INTO "OverlayKey"(id, label, "keyHash", "keyPrefix", widgets) VALUES ($1, 'e2e', $2, $3, $4)`,
      [randomUUID(), createHash('sha256').update(raw).digest(), raw.slice(4, 10), widgets],
    ),
  );
  return raw;
}

const clock = /^(\d+d )?\d{2}:\d{2}:\d{2}$/;
const seconds = (t: string) => {
  const m = /^(?:(\d+)d )?(\d{2}):(\d{2}):(\d{2})$/.exec(t.trim())!;
  return Number(m[1] ?? 0) * 86_400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
};

test('subathon: create, start, add time, the OBS widget counts down and pops; end', async ({
  browser,
}) => {
  await withDb((c) => c.query(`DELETE FROM "Subathon"`));
  const st = await seedUser({ role: 'STREAMER', passkeyVerified: true });
  const ctx = await browser.newContext();
  await signIn(ctx, st.token);
  const admin = await ctx.newPage();
  admin.on('dialog', (d) => void d.accept());
  await admin.goto('/admin/subathon');
  await expect(admin.getByRole('heading', { name: 'Novo subathon' })).toBeVisible();
  // e2e runs no worker and has no token: the StreamElements part says it isn't connected
  await expect(admin.getByRole('region', { name: 'StreamElements' })).toContainText(
    /Desligado|Sem conexão/,
  );

  await admin.getByLabel('Nome (aparece no OBS)').fill('Subathon E2E');
  await admin.getByLabel('Horas', { exact: true }).fill('1');
  await admin.getByLabel('Minutos', { exact: true }).fill('0');
  // the R$ rule previews each event's time
  await expect(admin.getByText('Sub Tier 1: R$ 10,00 → +10:00')).toBeVisible();
  await admin.getByRole('button', { name: 'Criar subathon' }).click();
  await expect(
    admin.getByText('Subathon criado. Inicie o timer quando a live começar.'),
  ).toBeVisible();
  const big = admin.locator('.wf-subathon-admin__clock');
  await expect(big).toHaveText('01:00:00');

  // OBS: the widget, through a key limited to it
  const obsCtx = await browser.newContext();
  const obs = await obsCtx.newPage();
  await obs.goto(`/overlay/subathon#k=${await overlayKey(['subathon'])}`);
  const widget = obs.locator('.wf-subathon');
  await expect(widget.locator('.wf-subathon__label')).toHaveText('Subathon E2E');
  await expect(widget.locator('.wf-subathon__clock')).toHaveText('01:00:00');
  await expect(widget.getByText('Começa em breve')).toBeVisible();

  await admin.getByRole('button', { name: 'Iniciar timer' }).click();
  await expect(admin.getByText('Timer iniciado.')).toBeVisible();
  // it counts down on its own in OBS
  await expect(widget.getByText('Começa em breve')).toHaveCount(0);
  const first = seconds((await widget.locator('.wf-subathon__clock').textContent())!);
  await expect
    .poll(async () => seconds((await widget.locator('.wf-subathon__clock').textContent())!), {
      timeout: 6_000,
    })
    .toBeLessThan(first);

  // +5 min in the dashboard → the widget jumps up and pops "+5:00"
  await admin.getByRole('button', { name: '+5 min' }).click();
  await expect(admin.getByText('5 min adicionados.')).toBeVisible();
  await expect(widget.locator('.wf-subathon__pops li').first()).toContainText('+5:00');
  await expect(widget.locator('.wf-subathon__pops li').first()).toContainText(
    'Tempo adicionado pela streamer',
  );
  expect(seconds((await widget.locator('.wf-subathon__clock').textContent())!)).toBeGreaterThan(
    3600,
  );
  await expect(widget.locator('.wf-subathon__clock')).toHaveText(clock);
  // and the dashboard's log shows it
  await expect(
    admin
      .getByRole('region', { name: 'O que entrou no timer' })
      .getByText('Tempo adicionado pela streamer'),
  ).toBeVisible();

  // chat commands (2026-11-04): the panel makes the StreamElements responses, shown once
  await admin.getByRole('button', { name: 'Criar comandos' }).click();
  const pausar = admin.getByLabel('Resposta do comando !pausar');
  await expect(pausar).toHaveValue(
    /^\$\(customapi https:\/\/[^ ]+\/api\/v1\/subathon\/command\?a=pausar&k=wfc_[\w-]{43}\)$/,
  );
  const commandUrl = /customapi (\S+)\)$/.exec(await pausar.inputValue())![1]!;
  // what StreamElements' customapi does: a plain GET; the answer is one line of text for chat
  const res = await admin.request.get(commandUrl);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/^text\/plain/);
  expect(await res.text()).toMatch(/^⏸️ Timer pausado: faltam \d{2}:\d{2}:\d{2}\.$/);
  await expect(widget.getByText('Pausado')).toBeVisible();
  const wrong = await admin.request.get(commandUrl.replace(/k=wfc_[\w-]{4}/, 'k=wfc_AAAA'));
  expect(wrong.status()).toBe(401);
  await expect(admin.getByText('Ligado', { exact: true })).toBeVisible();
  // the dashboard catches up with the chat's pause within its 5-second refresh
  await expect(admin.locator('.wf-ops-card.is-live .wf-pill')).toHaveText('Pausado', {
    timeout: 10_000,
  });
  await admin.getByRole('button', { name: 'Encerrar' }).click();
  await expect(admin.getByText('Subathon encerrado.')).toBeVisible();
  await expect(widget.getByText('Fim do subathon!')).toBeVisible();
  await expect(widget.locator('.wf-subathon__clock')).toHaveText('00:00:00');
  await expect(admin.getByRole('heading', { name: 'Novo subathon' })).toBeVisible();
  await obsCtx.close();
  await ctx.close();
});
