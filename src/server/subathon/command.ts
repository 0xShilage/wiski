import 'server-only';
import { formatClock, remainingAt } from '@/lib/subathon-time';
import { audit } from '../audit/audit';
import { db } from '../db';
import { HttpError } from '../http/problem';
import { logger } from '../log';
import { randomToken, safeEqual, sha256 } from '../security/crypto';
import { changeStatus, openSubathon, SubathonProblems } from './timer';

/**
 * Subathon chat commands (2026-11-04): `!pausar`, `!retomar` and `!tempo` in the StreamElements
 * chatbot. A StreamElements custom command calls
 *   $(customapi https://wiski.fun/api/v1/subathon/command?a=pause&k=<key>)
 * and posts the plain-text answer in chat. Who may use the command is the command's user level
 * in StreamElements (moderators for pause/resume); the site checks the key.
 *
 * The key (`wfc_` + 256 bits) is shown once in Admin › Subathon; only its SHA-256 is stored, in
 * AppSetting "subathon.commandKey". Rotating replaces it; revoking removes it. The query string
 * isn't logged (nginx logs $uri, the app logs the path only).
 */
const SETTING = 'subathon.commandKey';
export const COMMAND_KEY = /^wfc_[\w-]{43}$/;

type Stored = { hash: string; prefix: string; createdAt: string };
type Ctx = {
  actor: { id: string; role: 'USER' | 'MODERATOR' | 'STREAMER' };
  requestId: string | null;
};

async function stored(): Promise<Stored | null> {
  const row = await db().appSetting.findUnique({ where: { key: SETTING } });
  const v = row?.value as Partial<Stored> | null | undefined;
  return v && typeof v.hash === 'string' && typeof v.prefix === 'string'
    ? { hash: v.hash, prefix: v.prefix, createdAt: String(v.createdAt ?? '') }
    : null;
}

/** For the dashboard: whether a key exists (its first characters and date), never the key. */
export async function commandKeyStatus(): Promise<{ prefix: string; createdAt: string } | null> {
  const s = await stored();
  return s ? { prefix: s.prefix, createdAt: s.createdAt } : null;
}

/** Streamer: a new key (replaces the old one). Returned once; only its hash is kept. */
export async function createCommandKey(ctx: Ctx, now = new Date()): Promise<string> {
  const key = `wfc_${randomToken(32)}`;
  const value: Stored = {
    hash: sha256(key).toString('base64url'),
    prefix: key.slice(4, 10),
    createdAt: now.toISOString(),
  };
  await db().$transaction(async (t) => {
    await t.appSetting.upsert({
      where: { key: SETTING },
      create: { key: SETTING, value },
      update: { value },
    });
    await audit(
      {
        action: 'subathon.command-key',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'AppSetting',
        targetId: SETTING,
        metadata: { change: 'created' },
      },
      t,
    );
  });
  return key;
}

export async function revokeCommandKey(ctx: Ctx): Promise<void> {
  await db().$transaction(async (t) => {
    const res = await t.appSetting.deleteMany({ where: { key: SETTING } });
    if (!res.count) return;
    await audit(
      {
        action: 'subathon.command-key',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'AppSetting',
        targetId: SETTING,
        metadata: { change: 'revoked' },
      },
      t,
    );
  });
}

/** A wrong, revoked or missing key: one answer for all (no hint which). */
const badKey = () => new HttpError(401, 'BAD_COMMAND_KEY', 'Chave do comando inválida.');

export type CommandAction = 'pause' | 'resume' | 'status';

/** Run a chat command; returns the one-line answer the chatbot posts (≤ 400 bytes). */
export async function runCommand(
  key: string,
  action: CommandAction,
  now = new Date(),
): Promise<string> {
  const s = await stored();
  if (!s || !COMMAND_KEY.test(key) || !safeEqual(sha256(key).toString('base64url'), s.hash)) {
    throw badKey();
  }
  const sub = await openSubathon();
  if (!sub) return 'Nenhum subathon aberto no momento.';
  const left = () => formatClock(remainingAt(sub, now.getTime()));
  if (action === 'status') {
    if (sub.status === 'READY') return `O subathon ainda não começou: ${left()} no timer.`;
    if (sub.status === 'PAUSED') return `Subathon pausado: faltam ${left()}.`;
    return `Faltam ${left()} no subathon.`;
  }
  if (action === 'pause' && sub.status !== 'RUNNING') {
    return sub.status === 'PAUSED' ? 'O timer já está pausado.' : 'O timer ainda não começou.';
  }
  if (action === 'resume' && sub.status !== 'PAUSED') {
    return sub.status === 'RUNNING' ? 'O timer já está rodando.' : 'O timer ainda não começou.';
  }
  try {
    const done = await changeStatus(null, sub.id, action, null, now, { via: 'command' });
    const t = formatClock(remainingAt(done, now.getTime()));
    return action === 'pause'
      ? `⏸️ Timer pausado: faltam ${t}.`
      : `▶️ Timer retomado: faltam ${t}.`;
  } catch (err) {
    if (err instanceof HttpError && err.code === SubathonProblems.changed().code) {
      return 'O timer acabou de mudar. Tente de novo.';
    }
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'subathon command failed');
    throw err;
  }
}
