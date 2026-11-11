import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Role } from '@/generated/prisma/client';
import {
  chatLength,
  chatProblem,
  type ChatVars,
  expand,
  oneLine,
  PRESET_LABEL_MAX,
  PRESET_MAX,
} from '@/lib/chat';
import { audit } from '../audit/audit';
import { db } from '../db';
import { getEnv } from '../env';
import { HttpError, Problems } from '../http/problem';
import { liveStatus } from '../live/public';
import { redis } from '../redis';
import { type BotResult, botSay, chatBotConfigured } from './bot';

/**
 * Chat da live (2026-11-11, docs/phase-6/README.md §34): moderators and the streamer write to the
 * Twitch chat as the StreamElements bot from the dashboard. Every message (sent or refused) is
 * in the audit log with who sent it; the panel's history is read from there. Saved messages
 * ("Mensagens prontas") live in AppSetting `chat.presets`.
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

const PRESETS_KEY = 'chat.presets';
/** the same text twice within this window is a double click, not a choice */
const DUPLICATE_SECONDS = 15;

export const ChatProblems = {
  notConfigured: () =>
    new HttpError(
      409,
      'CHAT_NOT_CONFIGURED',
      'O bot do StreamElements não está configurado no servidor (STREAMELEMENTS_JWT em app.env).',
    ),
  duplicate: () =>
    new HttpError(
      409,
      'CHAT_DUPLICATE',
      'Essa mesma mensagem acabou de ser enviada. Espere alguns segundos para repetir.',
    ),
  failed: (r: Exclude<BotResult, { ok: true }>) => {
    if (r.reason === 'rejected' && (r.status === 401 || r.status === 403))
      return new HttpError(
        502,
        'CHAT_FAILED',
        'O StreamElements recusou o JWT (expirado ou trocado). Gere outro no StreamElements e atualize o app.env.',
      );
    if (r.reason === 'rejected' && r.status === 429)
      return new HttpError(
        502,
        'CHAT_FAILED',
        'O StreamElements pediu para esperar: muitas mensagens seguidas. Tente de novo em instantes.',
      );
    if (r.reason === 'rejected')
      return new HttpError(
        502,
        'CHAT_FAILED',
        `O StreamElements recusou a mensagem (HTTP ${r.status}). Confira se o bot está no canal.`,
      );
    if (r.reason === 'no-channel')
      return new HttpError(
        502,
        'CHAT_FAILED',
        'Não deu para descobrir o canal do StreamElements com esse JWT.',
      );
    return new HttpError(502, 'CHAT_FAILED', 'O StreamElements não respondeu. Tente de novo.');
  },
};

// ── what the placeholders say right now ───────────────────────────────────────

const proximaFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

/** "quinta-feira, 12/11 às 20:00" */
export function proximaLabel(d: Date): string {
  const p = Object.fromEntries(proximaFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}

export async function chatVars(now = new Date()): Promise<ChatVars> {
  return (await chatNow(now)).vars;
}

async function chatNow(now: Date): Promise<{ vars: ChatVars; live: boolean }> {
  const [status, next] = await Promise.all([
    liveStatus(now),
    db().streamSession.findFirst({
      where: { status: 'PLANNED', startsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
      select: { startsAt: true },
    }),
  ]);
  return {
    live: status.live,
    vars: {
      site: new URL(getEnv().APP_ORIGIN).host,
      agora: status.live ? status.now : null,
      proxima: next ? proximaLabel(next.startsAt) : null,
    },
  };
}

const MISSING: Record<keyof ChatVars, string> = {
  site: 'o endereço do site',
  agora: 'nada está marcado como passando agora',
  proxima: 'não há live planejada',
};

// ── sending ──────────────────────────────────────────────────────────────────

export type ChatHistoryEntry = {
  id: string;
  at: string;
  by: string | null;
  text: string;
  ok: boolean;
};

export const chatSayInput = z.object({ text: z.string().max(2_000) }).strict();

/** Sends one message as the bot; throws a problem the panel shows when it can't. */
export async function sendChat(ctx: Ctx, raw: string, now = new Date()): Promise<ChatHistoryEntry> {
  const draft = oneLine(raw);
  const { text, missing } = expand(draft, await chatVars(now));
  if (missing.length)
    throw Problems.validation([
      {
        path: 'text',
        message: `Não dá para preencher agora: ${missing.map((k) => MISSING[k]).join('; ')}.`,
      },
    ]);
  const problem = chatProblem(text);
  if (problem) throw Problems.validation([{ path: 'text', message: problem }]);
  if (!chatBotConfigured()) throw ChatProblems.notConfigured();

  const hash = createHash('sha256').update(text).digest('base64url').slice(0, 22);
  const first = await redis()
    .set(`wf:chat:sent:${hash}`, '1', 'EX', DUPLICATE_SECONDS, 'NX')
    .catch(() => 'OK');
  if (first !== 'OK') throw ChatProblems.duplicate();

  const result = await botSay(text);
  await audit({
    action: 'chat.say',
    actor: ctx.actor,
    requestId: ctx.requestId,
    targetType: 'Chat',
    metadata: {
      text,
      ok: result.ok,
      reason: result.ok ? null : result.reason,
      status: !result.ok && result.reason === 'rejected' ? result.status : null,
    },
  });
  if (!result.ok) {
    // a failed message can be tried again right away
    await redis()
      .del(`wf:chat:sent:${hash}`)
      .catch(() => {});
    throw ChatProblems.failed(result);
  }
  const me = await db().user.findUnique({
    where: { id: ctx.actor.id },
    select: { username: true },
  });
  return { id: randomUUID(), at: now.toISOString(), by: me?.username ?? null, text, ok: true };
}

const sayMeta = z.object({ text: z.string(), ok: z.boolean() }).passthrough();

/** The last messages sent from the panel (newest first), with who sent them. */
export async function chatHistory(take = 30): Promise<ChatHistoryEntry[]> {
  const rows = await db().auditLog.findMany({
    where: { action: 'chat.say' },
    orderBy: { id: 'desc' },
    take,
    select: { id: true, at: true, actorId: true, metadata: true },
  });
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const users = ids.length
    ? await db().user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } })
    : [];
  const name = new Map(users.map((u) => [u.id, u.username]));
  return rows.flatMap((r) => {
    const m = sayMeta.safeParse(r.metadata);
    if (!m.success) return [];
    return [
      {
        id: r.id.toString(),
        at: r.at.toISOString(),
        by: r.actorId ? (name.get(r.actorId) ?? null) : null,
        text: m.data.text,
        ok: m.data.ok,
      },
    ];
  });
}

// ── saved messages ───────────────────────────────────────────────────────────

export type ChatPreset = { id: string; label: string; text: string };

const DEFAULT_PRESETS: ChatPreset[] = [
  {
    id: 'site',
    label: 'Patrocinar',
    text: '🍿 Quer escolher o que a gente assiste? Patrocine um filme, série ou anime em {site}',
  },
  { id: 'agora', label: 'Passando agora', text: '🎬 Passando agora: {agora}' },
  {
    id: 'proxima',
    label: 'Próxima live',
    text: '📅 Próxima live: {proxima}. Agenda completa em {site}/cronograma',
  },
  {
    id: 'sugestoes',
    label: 'Sugestões',
    text: '💡 Tem uma sugestão de filme, série, anime ou jogo? Mande em {site}/sugestoes',
  },
  {
    id: 'avaliar',
    label: 'Avaliar',
    text: '⭐ Já assistiu com a gente? Deixe sua avaliação no site: {site}/avaliacoes',
  },
];

const presetSchema = z
  .object({
    id: z
      .string()
      .regex(/^[\w-]{1,40}$/)
      .optional(),
    label: z.string().max(200),
    text: z.string().max(2_000),
  })
  .strict();
export const chatPresetsInput = z
  .object({ presets: z.array(presetSchema).max(PRESET_MAX) })
  .strict();
const storedPresets = z.object({
  presets: z.array(z.object({ id: z.string(), label: z.string(), text: z.string() })),
});

export async function chatPresets(): Promise<ChatPreset[]> {
  const row = await db().appSetting.findUnique({ where: { key: PRESETS_KEY } });
  if (!row) return DEFAULT_PRESETS;
  const parsed = storedPresets.safeParse(row.value);
  return parsed.success ? parsed.data.presets : DEFAULT_PRESETS;
}

/** Replaces the whole list (the panel edits, adds, removes and reorders, then saves). */
export async function setChatPresets(
  ctx: Ctx,
  input: z.infer<typeof chatPresetsInput>['presets'],
): Promise<ChatPreset[]> {
  const errors: { path: string; message: string }[] = [];
  const presets = input.map((p, i) => {
    const label = oneLine(p.label);
    const text = oneLine(p.text);
    if (!label) errors.push({ path: `presets.${i}.label`, message: 'Dê um nome curto.' });
    else if (chatLength(label) > PRESET_LABEL_MAX)
      errors.push({
        path: `presets.${i}.label`,
        message: `Use no máximo ${PRESET_LABEL_MAX} caracteres.`,
      });
    // the placeholders are checked when the message is sent; here only the shape
    const shape = chatProblem(text.replace(/\{(?:site|agora|proxima)\}/g, 'x'));
    if (shape) errors.push({ path: `presets.${i}.text`, message: shape });
    return { id: p.id ?? randomUUID(), label, text };
  });
  if (new Set(presets.map((p) => p.id)).size !== presets.length)
    errors.push({ path: 'presets', message: 'Mensagens repetidas na lista.' });
  if (errors.length) throw Problems.validation(errors);
  await db().$transaction(async (t) => {
    await t.appSetting.upsert({
      where: { key: PRESETS_KEY },
      create: { key: PRESETS_KEY, value: { presets } },
      update: { value: { presets } },
    });
    await audit(
      {
        action: 'chat.presets.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'AppSetting',
        targetId: PRESETS_KEY,
        metadata: { count: presets.length },
      },
      t,
    );
  });
  return presets;
}

// ── the panel ────────────────────────────────────────────────────────────────

export type ChatPanelData = {
  ready: boolean;
  live: boolean;
  vars: ChatVars;
  presets: ChatPreset[];
  history: ChatHistoryEntry[];
};

export async function chatPanel(now = new Date()): Promise<ChatPanelData> {
  const [{ vars, live }, presets, history] = await Promise.all([
    chatNow(now),
    chatPresets(),
    chatHistory(),
  ]);
  return {
    ready: chatBotConfigured(),
    live,
    vars,
    presets,
    history,
  };
}
