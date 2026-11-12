/**
 * Emblemas (2026-11-12): the team creates an event badge from the dashboard (PNG art, a WebM turned
 * into frames in the browser), a viewer claims it with the word said on stream, and it shows on the
 * home page and in their profile. Screenshots go to test-results/emblemas.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { seedUser, signIn, withDb } from './support/seed';

const SHOTS = 'test-results/emblemas';
mkdirSync(SHOTS, { recursive: true });

const clear = () =>
  withDb(async (c) => {
    await c.query(`DELETE FROM "BadgeClaim"`);
    await c.query(`DELETE FROM "Badge"`);
  });

test('the team creates a badge with PNG art and turns a WebM into an animated one', async ({
  page,
}, info) => {
  test.skip(!info.project.name.startsWith('desktop'), 'the dashboard flow runs once');
  test.setTimeout(120_000);
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await clear();
  const mod = await seedUser({ role: 'MODERATOR', passkeyVerified: true });
  await signIn(page.context(), mod.token);
  await page.goto('/admin/emblemas');
  await expect(page.getByRole('heading', { name: 'Emblemas', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Novo emblema' }).click();
  const form = page.getByRole('form', { name: 'Novo emblema' });

  // PNG: square, transparent corners
  const png = await sharp({
    create: { width: 320, height: 320, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><circle cx="160" cy="160" r="140" fill="#a99de0"/><circle cx="160" cy="160" r="90" fill="#4f3d72"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  await form.locator('input[type=file]').setInputFiles({
    name: 'emblema.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(form.locator('.wf-badge-drop img')).toHaveAttribute('src', /^\/media\//, {
    timeout: 20_000,
  });
  await form.getByLabel('Nome').fill('Maratona de Teste');
  await form.getByLabel(/História do emblema/).fill('Para quem ficou até o fim.');
  await form.getByLabel(/Palavra do evento/).fill('Pipoca Doce');
  await form.screenshot({ path: `${SHOTS}/admin-form.png` });
  await form.getByRole('button', { name: 'Criar emblema' }).click();
  await expect(page.getByText('Emblema criado')).toBeVisible();
  const row = page.locator('.wf-badge-row', { hasText: 'Maratona de Teste' });
  await expect(row).toContainText('Aberto');
  await expect(row).toContainText('com palavra');

  // WebM: recorded here, decoded by the dashboard into a grid of frames (the server gets an image)
  const webm = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    const rec = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((ok) => (rec.onstop = ok));
    rec.start();
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        ctx.fillStyle = `hsl(${(t * 300) % 360} 60% 50%)`;
        ctx.fillRect(0, 0, 200, 200);
        if (t < 1.2) requestAnimationFrame(draw);
        else done();
      };
      draw();
    });
    rec.stop();
    await stopped;
    const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let s = '';
    for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  });
  let sent: { url: string; bytes: Buffer } | null = null;
  // the real upload is covered by tests/integration/media-badge.test.ts; here: what the browser sends
  await page.route('**/api/v1/admin/media?role=BADGE&frames=*', async (route) => {
    sent = { url: route.request().url(), bytes: route.request().postDataBuffer()! };
    await route.fulfill({
      status: 422,
      contentType: 'application/problem+json',
      body: '{"title":"x","status":422,"detail":"Teste: recebido."}',
    });
  });
  await page.getByRole('button', { name: 'Novo emblema' }).click();
  await form.locator('input[type=file]').setInputFiles({
    name: 'animado.webm',
    mimeType: 'video/webm',
    buffer: Buffer.from(webm, 'base64'),
  });
  await expect(form.getByText('Teste: recebido.')).toBeVisible({ timeout: 30_000 });
  const got = sent as { url: string; bytes: Buffer } | null;
  expect(got).not.toBeNull();
  const q = new URL(got!.url).searchParams;
  const frames = Number(q.get('frames'));
  expect(frames).toBeGreaterThanOrEqual(10);
  expect(q.get('fps')).toBe('12');
  expect(q.get('cols')).toBe('8');
  const meta = await sharp(got!.bytes).metadata();
  expect(meta.format).toBe('webp');
  expect(meta.width).toBe(8 * 256);
  expect(meta.height).toBe(Math.ceil(frames / 8) * 256);
  expect(violations).toEqual([]);
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

test('a viewer claims an open badge with the word and sees it on the home page and profile', async ({
  page,
}, info) => {
  await clear();
  // the art: the dashboard's upload when the run has one, else a stand-in row
  const assetId = await withDb(async (c) => {
    const r = await c.query<{ id: string }>(
      `SELECT id FROM "MediaAsset" WHERE role = 'BADGE' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    if (r.rows[0]) return r.rows[0].id;
    const id = randomUUID();
    const hex = randomUUID().replace(/-/g, '');
    const owner = await seedUser({ role: 'MODERATOR' });
    await c.query(
      `INSERT INTO "MediaAsset"(id, sha256, role, width, height, variants, "uploadedById") VALUES ($1, $2, 'BADGE', 256, 256, $3, $4)`,
      [
        id,
        createHash('sha256').update(hex).digest(),
        JSON.stringify([
          { w: 256, h: 256, format: 'webp', path: `/media/${hex}-256.webp`, bytes: 1 },
        ]),
        owner.id,
      ],
    );
    return id;
  });
  await withDb((c) =>
    c.query(
      `INSERT INTO "Badge"(id, slug, name, description, "assetId", "startsAt", "endsAt", "codeHash", "updatedAt")
       VALUES ($1, 'noite-de-terror', 'Noite de Terror', 'Sobreviveu às três sessões.', $2, now() - interval '1 hour', now() + interval '3 hours', $3, now()),
              ($4, 'em-breve', 'Surpresa', '', $2, now() + interval '2 days', now() + interval '3 days', NULL, now())`,
      [
        randomUUID(),
        assetId,
        createHash('sha256').update('wf:badge:abobora').digest(),
        randomUUID(),
      ],
    ),
  );
  const viewer = await seedUser();
  await signIn(page.context(), viewer.token);

  await page.goto('/');
  const callout = page.getByRole('region', { name: 'Noite de Terror' });
  await expect(callout).toContainText('Resgate até');
  await callout.getByRole('link').click();
  await expect(page).toHaveURL(/\/emblemas$/);

  const card = page.getByRole('article', { name: 'Noite de Terror' });
  await expect(card).toContainText('0 pessoas têm');
  // the coming one keeps its art hidden
  const soon = page.getByRole('article', { name: 'Surpresa' });
  await expect(soon.locator('.wf-badge-art--mystery')).toBeVisible();
  await expect(soon.getByRole('button')).toHaveCount(0);

  await card.getByLabel('Palavra do evento').fill('morango');
  await card.getByRole('button', { name: 'Resgatar emblema' }).click();
  await expect(card.getByRole('alert')).toContainText(/palavra/i);
  await card.getByLabel('Palavra do evento').fill('ABÓBORA!');
  await card.getByRole('button', { name: 'Resgatar emblema' }).click();
  await expect(card.getByRole('status')).toHaveText('Resgatado! Está na sua coleção.');
  await expect(card).toContainText('1 pessoa tem');
  await page.screenshot({
    path: `${SHOTS}/emblemas-${info.project.name}.png`,
    fullPage: true,
    animations: 'disabled',
  });

  await page.goto('/perfil');
  const shelf = page.getByRole('region', { name: /^Emblemas/ });
  await expect(shelf.getByRole('listitem')).toHaveCount(1);
  await expect(shelf).toContainText('Noite de Terror');
  await shelf.screenshot({ path: `${SHOTS}/perfil-${info.project.name}.png` });

  await page.goto(`/u/${viewer.username}`);
  await expect(page.getByRole('region', { name: 'Emblemas' })).toContainText('Noite de Terror');
  await clear();
});
