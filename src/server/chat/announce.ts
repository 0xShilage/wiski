import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Role } from '@/generated/prisma/client';
import {
  ANNOUNCE_KINDS,
  type AnnounceKind,
  type AnnounceSettings,
  announceProblem,
  DEFAULT_ANNOUNCE,
  fillAnnouncement,
} from '@/lib/announce';
import { chatProblem, oneLine } from '@/lib/chat';
import { audit } from '../audit/audit';
import { db } from '../db';
import { getEnv } from '../env';
import { Problems } from '../http/problem';
import { sessionWithEntries, type QueueEntry } from '../live/schedule';
import { logger } from '../log';
import { redis } from '../redis';
import { botSay, chatBotConfigured } from './bot';
import { proximaLabel } from './say';

/**
 * Anúncios automáticos (2026-11-13, docs/phase-6/README.md §42): the bot speaks on its own when a
 * live starts, when something goes on screen ("Agora assistindo") and when an event badge opens
 * during a live. Each one can be switched off and reworded in Chat da live; they're stored in
 * AppSetting `chat.announce`. Best effort: an announcement never fails or slows the action that
 * caused it, never repeats for the same moment (Redis), and lands in the audit log as a
 * `chat.say` with no actor, so the panel's history shows it as "automático".
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

const KEY = 'chat.announce';
/** the same moment (this live started, this title went on) is announced once */
const ONCE_SECONDS = 6 * 3600;

const stored = z.object(
  Object.fromEntries(
    ANNOUNCE_KINDS.map((k) => [k, z.object({ on: z.boolean(), text: z.string() }).optional()]),
  ) as Record<AnnounceKind, z.ZodOptional<z.ZodObject<{ on: z.ZodBoolean; text: z.ZodString }>>>,
);

export async function announceSettings(): Promise<AnnounceSettings> {
  const row = await db().appSetting.findUnique({ where: { key: KEY } });
  const parsed = stored.safeParse(row?.value ?? {});
  const v = parsed.success ? parsed.data : {};
  return Object.fromEntries(
    ANNOUNCE_KINDS.map((k) => [k, v[k] ?? DEFAULT_ANNOUNCE[k]]),
  ) as AnnounceSettings;
}

const one = z.object({ on: z.boolean(), text: z.string().max(2_000) }).strict();
export const announceInput = z.object({ start: one, now: one, badge: one }).strict();

export async function setAnnounceSettings(
  ctx: Ctx,
  input: z.infer<typeof announceInput>,
): Promise<AnnounceSettings> {
  const errors: { path: string; message: string }[] = [];
  const value = Object.fromEntries(
    ANNOUNCE_KINDS.map((k) => {
      const text = oneLine(input[k].text);
      const problem = announceProblem(k, text);
      if (problem) errors.push({ path: `${k}.text`, message: problem });
      return [k, { on: input[k].on, text }];
    }),
  ) as AnnounceSettings;
  if (errors.length) throw Problems.validation(errors);
  await db().$transaction(async (t) => {
    await t.appSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value },
      update: { value },
    });
    await audit(
      {
        action: 'chat.announce.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'AppSetting',
        targetId: KEY,
        metadata: { start: value.start.on, now: value.now.on, badge: value.badge.on },
      },
      t,
    );
  });
  return value;
}

/** Posts one announcement if it's on, the bot is set up and this moment wasn't announced yet. */
async function post(kind: AnnounceKind, moment: string, vars: Record<string, string>) {
  if (!chatBotConfigured()) return;
  const setting = (await announceSettings())[kind];
  if (!setting.on) return;
  const text = fillAnnouncement(setting.text, { site: new URL(getEnv().APP_ORIGIN).host, ...vars });
  if (chatProblem(text)) return;
  const once = createHash('sha256').update(`${kind}:${moment}`).digest('base64url').slice(0, 22);
  const first = await redis()
    .set(`wf:chat:auto:${once}`, '1', 'EX', ONCE_SECONDS, 'NX')
    .catch(() => 'OK');
  if (first !== 'OK') return;
  const result = await botSay(text);
  await audit({
    action: 'chat.say',
    actor: null,
    requestId: null,
    targetType: 'Chat',
    metadata: {
      text,
      ok: result.ok,
      reason: result.ok ? null : result.reason,
      status: !result.ok && result.reason === 'rejected' ? result.status : null,
      auto: kind,
    },
  });
}

/** Runs an announcement after the action, never letting it fail the action. */
export function announceAfter(job: () => Promise<unknown>) {
  void job().catch((err: unknown) =>
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown' },
      'chat announcement failed',
    ),
  );
}

/** "Dark (T1 · E1–E3)", "Aftersun", an event's own title */
function entryTitle(e: QueueEntry): string | null {
  if (e.segment?.kind === 'EVENT') return e.segment.label;
  if (!e.item) return null;
  return e.segment ? `${e.item.title} (${e.segment.label})` : e.item.title;
}

/** "A, B e C" / "A, B, C e mais 2" */
export function programa(titles: string[], max = 3): string {
  const shown = titles.slice(0, max);
  const rest = titles.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} e mais ${rest}`;
  if (shown.length <= 1) return shown[0] ?? '';
  return `${shown.slice(0, -1).join(', ')} e ${shown.at(-1)}`;
}

export async function announceLiveStart(sessionId: string) {
  const s = await sessionWithEntries(sessionId);
  if (!s) return;
  const titles = s.entries
    .filter((e) => e.status !== 'COMPLETED' && e.status !== 'DONE')
    .map(entryTitle)
    .filter((t): t is string => !!t);
  await post('start', `start:${sessionId}`, {
    programa: titles.length ? programa(titles) : 'surpresa 🍿',
  });
}

export async function announceNow(
  sessionId: string,
  target: { kind: 'ORDER' | 'CAMPAIGN' | 'SEGMENT'; id: string },
) {
  const s = await sessionWithEntries(sessionId);
  const e = s?.entries.find((x) => x.kind === target.kind && x.id === target.id);
  if (!e) return;
  const titulo =
    e.segment?.kind === 'PART' && e.item ? `${e.item.title} · ${e.segment.label}` : entryTitle(e);
  if (!titulo) return;
  let credito = '';
  if (e.kind === 'ORDER' && e.sponsor) credito = `· patrocinado por ${e.sponsor} 💜`;
  const campaignId = e.kind === 'CAMPAIGN' ? e.id : (e.segment?.campaignId ?? null);
  if (campaignId) {
    const c = await db().campaign.findUnique({
      where: { id: campaignId },
      select: { supporterCount: true },
    });
    if (c?.supporterCount)
      credito = `· vaquinha de ${c.supporterCount} ${c.supporterCount === 1 ? 'apoiador' : 'apoiadores'} 💜`;
  }
  await post('now', `now:${sessionId}:${target.kind}:${target.id}`, { titulo, credito });
}

/**
 * Worker, every minute: an event badge that is open while a live is on gets its announcement once
 * (a badge that opened with no live is announced when the next live starts, if still open). The
 * claim word is never in it.
 */
export async function announceOpenBadges(now = new Date()) {
  if (!chatBotConfigured()) return;
  const live = await db().streamSession.count({ where: { status: 'LIVE' } });
  if (!live) return;
  const open = await db().badge.findMany({
    where: { startsAt: { lte: now }, endsAt: { gt: now }, announcedAt: null },
    orderBy: { startsAt: 'asc' },
    take: 3,
    select: { id: true, name: true, endsAt: true },
  });
  for (const b of open) {
    // claim the badge first so two workers (or a slow bot) can't announce it twice
    const r = await db().badge.updateMany({
      where: { id: b.id, announcedAt: null },
      data: { announcedAt: now },
    });
    if (r.count !== 1) continue;
    await post('badge', `badge:${b.id}`, { emblema: b.name, ate: proximaLabel(b.endsAt) });
  }
}

/** "Agora na tela" for whatever was just put on in the live session. */
export async function announceNowPlaying(target: {
  kind: 'ORDER' | 'CAMPAIGN' | 'SEGMENT';
  id: string;
}) {
  const live = await db().streamSession.findFirst({
    where: { status: 'LIVE' },
    select: { id: true },
  });
  if (live) await announceNow(live.id, target);
}
