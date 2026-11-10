import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Role } from '@/generated/prisma/client';
import { pictureFrom } from '@/lib/media';
import { type HomePopup, type Season, SEASONS } from '@/lib/season';
import { audit } from '../audit/audit';
import { db } from '../db';
import { Problems } from '../http/problem';
import { logger } from '../log';
import { codePointLength, plainText } from '../text/sanitize';

/**
 * Appearance (2026-11-10): the seasonal theme and the home pop-up, both in AppSetting rows,
 * changed from Admin › Aparência (moderators and the streamer), audited.
 *
 * - Season: `{theme, until}`. While on (and until the end of `until`, São Paulo time), the root
 *   layout puts `data-season` on <html>: the CSS swaps the background pattern, the glow colour and
 *   the logo colour, and the header shows the season's piece next to the logo.
 * - Pop-up: shown once per visitor on the home page. Each time it is switched ON (or "mostrar de
 *   novo para todos"), it gets a new id; the browser remembers the id it closed, so editing the
 *   text of a pop-up that is already on does not show it again to people who closed it.
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

const SEASON_KEY = 'season';
const POPUP_KEY = 'popup';
const dateOnly = z.iso.date();

const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const todaySp = (now: Date) => dayKey.format(now); // YYYY-MM-DD

// ── season ───────────────────────────────────────────────────────────────────

export const seasonInput = z
  .object({
    theme: z.enum(['none', ...SEASONS]),
    /** last day it shows (São Paulo); null = until switched off */
    until: dateOnly.nullable(),
  })
  .strict();
export type SeasonSetting = z.infer<typeof seasonInput>;
const SEASON_OFF: SeasonSetting = { theme: 'none', until: null };

export async function getSeasonSetting(): Promise<SeasonSetting> {
  const row = await db().appSetting.findUnique({ where: { key: SEASON_KEY } });
  const p = seasonInput.safeParse(row?.value);
  return p.success ? p.data : SEASON_OFF;
}

export function activeTheme(s: SeasonSetting, now = new Date()): Season | null {
  if (s.theme === 'none') return null;
  if (s.until && todaySp(now) > s.until) return null;
  return s.theme;
}

/** The theme to paint now, or null (the root layout asks on every page: one primary-key read). */
export async function currentSeason(now = new Date()): Promise<Season | null> {
  try {
    return activeTheme(await getSeasonSetting(), now);
  } catch (err) {
    logger.warn({ err }, 'season unavailable');
    return null;
  }
}

export async function setSeason(ctx: Ctx, next: SeasonSetting, now = new Date()) {
  if (next.until && next.until < todaySp(now)) {
    throw Problems.validation([{ path: 'until', message: 'Escolha hoje ou uma data futura.' }]);
  }
  const value = next.theme === 'none' ? SEASON_OFF : next;
  await db().$transaction(async (t) => {
    await t.appSetting.upsert({
      where: { key: SEASON_KEY },
      create: { key: SEASON_KEY, value },
      update: { value },
    });
    await audit(
      {
        action: 'season.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'AppSetting',
        targetId: SEASON_KEY,
        metadata: value,
      },
      t,
    );
  });
  return getSeasonSetting();
}

// ── home pop-up ──────────────────────────────────────────────────────────────

const ctaHref = z
  .string()
  .trim()
  .max(300)
  .refine(
    (h) => (/^\/(?![/\\])/.test(h) && !/\s/.test(h)) || /^https:\/\/[^\s/]+(?:\/\S*)?$/i.test(h),
    'Use um endereço do site (começando com /) ou um link https://.',
  );

export const popupInput = z
  .object({
    active: z.boolean(),
    title: z.string().max(200),
    body: z.string().max(2000),
    imageId: z.uuid().nullable(),
    ctaLabel: z.string().max(100).nullable(),
    ctaHref: ctaHref.nullable(),
    until: dateOnly.nullable(),
    /** a new id even though it was already on: everyone sees it again */
    renew: z.boolean().optional(),
  })
  .strict();
export type PopupInput = z.infer<typeof popupInput>;

const popupStored = z
  .object({
    id: z.uuid(),
    active: z.boolean(),
    title: z.string(),
    body: z.string(),
    imageId: z.uuid().nullable(),
    ctaLabel: z.string().nullable(),
    ctaHref: z.string().nullable(),
    until: dateOnly.nullable(),
    shownFrom: z.iso.datetime().nullable(),
  })
  .strict();
export type PopupSetting = z.infer<typeof popupStored>;

const LIMITS = { title: 80, body: 600, ctaLabel: 30 } as const;

function clean(raw: string, field: keyof typeof LIMITS, multiline = false): string {
  const s = plainText(raw, { multiline }).trim();
  if (codePointLength(s) > LIMITS[field]) {
    throw Problems.validation([
      { path: field, message: `Use no máximo ${LIMITS[field]} caracteres.` },
    ]);
  }
  return s;
}

export async function getPopupSetting(): Promise<PopupSetting | null> {
  const row = await db().appSetting.findUnique({ where: { key: POPUP_KEY } });
  const p = popupStored.safeParse(row?.value);
  return p.success ? p.data : null;
}

/** The admin view: the setting plus its image as a picture. */
export async function popupForAdmin() {
  const s = await getPopupSetting();
  if (!s) return null;
  const image = s.imageId
    ? await db().mediaAsset.findUnique({
        where: { id: s.imageId },
        select: { width: true, height: true, variants: true },
      })
    : null;
  return { ...s, image: pictureFrom(image) };
}

export async function setPopup(ctx: Ctx, input: PopupInput, now = new Date()) {
  const title = clean(input.title, 'title');
  const body = clean(input.body, 'body', true);
  const ctaLabel = input.ctaLabel ? clean(input.ctaLabel, 'ctaLabel') || null : null;
  const href = input.ctaHref?.trim() || null;
  if (input.active && (!title || !body)) {
    throw Problems.validation([
      ...(!title ? [{ path: 'title', message: 'Escreva um título.' }] : []),
      ...(!body ? [{ path: 'body', message: 'Escreva o texto do pop-up.' }] : []),
    ]);
  }
  if (!!ctaLabel !== !!href) {
    throw Problems.validation([
      { path: ctaLabel ? 'ctaHref' : 'ctaLabel', message: 'O botão precisa de texto e link.' },
    ]);
  }
  if (input.until && input.until < todaySp(now)) {
    throw Problems.validation([{ path: 'until', message: 'Escolha hoje ou uma data futura.' }]);
  }
  if (input.imageId) {
    const a = await db().mediaAsset.findUnique({
      where: { id: input.imageId },
      select: { role: true },
    });
    if (!a || a.role !== 'BACKDROP') {
      throw Problems.validation([
        { path: 'imageId', message: 'Envie a imagem pelo campo do pop-up.' },
      ]);
    }
  }
  const prev = await getPopupSetting();
  const switchedOn = input.active && (!prev?.active || !!input.renew);
  const value: PopupSetting = {
    id: switchedOn || !prev ? randomUUID() : prev.id,
    active: input.active,
    title,
    body,
    imageId: input.imageId,
    ctaLabel,
    ctaHref: href,
    until: input.until,
    shownFrom: input.active
      ? switchedOn
        ? now.toISOString()
        : (prev?.shownFrom ?? now.toISOString())
      : null,
  };
  await db().$transaction(async (t) => {
    await t.appSetting.upsert({
      where: { key: POPUP_KEY },
      create: { key: POPUP_KEY, value },
      update: { value },
    });
    await audit(
      {
        action: 'popup.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'AppSetting',
        targetId: POPUP_KEY,
        metadata: { active: value.active, renewed: switchedOn, image: !!value.imageId },
      },
      t,
    );
  });
  return popupForAdmin();
}

/** What the home page shows (null = nothing): on, and not past its last day. */
export async function homePopup(now = new Date()): Promise<HomePopup | null> {
  try {
    const s = await getPopupSetting();
    if (!s?.active || !s.title || !s.body) return null;
    if (s.until && todaySp(now) > s.until) return null;
    const image = s.imageId
      ? await db().mediaAsset.findUnique({
          where: { id: s.imageId },
          select: { width: true, height: true, variants: true },
        })
      : null;
    return {
      id: s.id,
      title: s.title,
      body: s.body,
      image: pictureFrom(image),
      cta: s.ctaLabel && s.ctaHref ? { label: s.ctaLabel, href: s.ctaHref } : null,
    };
  } catch (err) {
    logger.warn({ err }, 'home pop-up unavailable');
    return null;
  }
}
