import 'server-only';
import { z } from 'zod';
import type { Role } from '@/generated/prisma/client';
import { chatSafe } from '@/lib/stream-safe';
import { audit } from '../audit/audit';
import { botSay } from '../chat/bot';
import { db } from '../db';
import { getEnv } from '../env';
import { logger } from '../log';
import { redis } from '../redis';

/**
 * "Novo patrocínio" extras (2026-11-09): a Brazilian Portuguese voice reads each sponsorship
 * (Google Cloud Text-to-Speech, GOOGLE_TTS_API_KEY) and the StreamElements bot thanks the sponsor
 * in chat (STREAMELEMENTS_JWT). Both can be switched off in Overlays; both only ever get text
 * that went through `streamSafe` (no links, no swear words).
 *
 * The voice is made on the server when the alert is published and kept in Redis for 10 minutes
 * under the alert's id; the overlay fetches it with its overlay cookie. The key never reaches a
 * browser. A failed synthesis or chat post is logged and skipped: the alert still shows.
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export const VOICES = [
  { id: 'pt-BR-Neural2-A', label: 'Feminina (Neural2 A)' },
  { id: 'pt-BR-Neural2-C', label: 'Feminina (Neural2 C)' },
  { id: 'pt-BR-Neural2-B', label: 'Masculina (Neural2 B)' },
  { id: 'pt-BR-Wavenet-A', label: 'Feminina (WaveNet A)' },
  { id: 'pt-BR-Wavenet-B', label: 'Masculina (WaveNet B)' },
] as const;
const voiceIds = VOICES.map((v) => v.id) as [string, ...string[]];

const SETTING = 'alerts';
export const alertSettingsSchema = z
  .object({
    voice: z.boolean(),
    voiceName: z.enum(voiceIds),
    chat: z.boolean(),
  })
  .strict();
export type AlertSettings = z.infer<typeof alertSettingsSchema>;
const DEFAULTS: AlertSettings = { voice: true, voiceName: 'pt-BR-Neural2-A', chat: true };

export async function getAlertSettings(): Promise<
  AlertSettings & { voiceReady: boolean; chatReady: boolean }
> {
  const row = await db().appSetting.findUnique({ where: { key: SETTING } });
  const parsed = alertSettingsSchema.safeParse(row?.value);
  const env = getEnv();
  return {
    ...(parsed.success ? parsed.data : DEFAULTS),
    voiceReady: !!env.GOOGLE_TTS_API_KEY,
    chatReady: !!env.STREAMELEMENTS_JWT,
  };
}

export async function setAlertSettings(ctx: Ctx, next: AlertSettings) {
  await db().$transaction(async (t) => {
    await t.appSetting.upsert({
      where: { key: SETTING },
      create: { key: SETTING, value: next },
      update: { value: next },
    });
    await audit(
      {
        action: 'alerts.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'AppSetting',
        targetId: SETTING,
        metadata: next,
      },
      t,
    );
  });
  return getAlertSettings();
}

// ── the voice ────────────────────────────────────────────────────────────────

export const TTS_TTL_SECONDS = 600;
const ttsKey = (alertId: string) => `wf:tts:${alertId}`;
const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';

/** What the voice says: "Tia Lu patrocinou Duna! Que filme lindo." */
export function spokenLine(p: {
  sponsor: string | null;
  title: string;
  message: string | null;
}): string {
  const who = p.sponsor ? p.sponsor.replace(/^@/, '') : 'Alguém anônimo';
  const msg = p.message?.trim();
  return `${who} patrocinou ${p.title}!${msg ? ` ${msg}` : ''}`.slice(0, 400);
}

/** Google TTS → MP3 bytes, or null (no key, switched off, error, slow). */
export async function synthesize(text: string, voiceName: string): Promise<Buffer | null> {
  const key = getEnv().GOOGLE_TTS_API_KEY;
  if (!key || !text.trim()) return null;
  const call = (voice: Record<string, string>) =>
    fetch(TTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'pt-BR', ...voice },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05 },
      }),
      signal: AbortSignal.timeout(5_000),
    });
  try {
    let res = await call({ name: voiceName });
    // a voice Google retired: ask for any Brazilian female voice instead
    if (res.status === 400) res = await call({ ssmlGender: 'FEMALE' });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'tts failed');
      return null;
    }
    const body = (await res.json()) as { audioContent?: unknown };
    if (typeof body.audioContent !== 'string') return null;
    const mp3 = Buffer.from(body.audioContent, 'base64');
    return mp3.length > 0 && mp3.length < 2_000_000 ? mp3 : null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'tts failed');
    return null;
  }
}

export async function storeVoice(alertId: string, mp3: Buffer): Promise<boolean> {
  try {
    await redis().set(ttsKey(alertId), mp3, 'EX', TTS_TTL_SECONDS);
    return true;
  } catch {
    return false;
  }
}

export async function voiceOf(alertId: string): Promise<Buffer | null> {
  try {
    return await redis().getBuffer(ttsKey(alertId));
  } catch {
    return null;
  }
}

// ── the chat ─────────────────────────────────────────────────────────────────

/** "Tia Lu patrocinou Duna! Muito obrigada por seu apoio 🍿🎥" */
export function chatLine(p: { sponsor: string | null; title: string }): string {
  return chatSafe(
    `${p.sponsor ?? 'Alguém'} patrocinou ${p.title}! Muito obrigada por seu apoio 🍿🎥`,
  );
}

/**
 * Posts one line through the StreamElements bot, once per `dedupeKey` (a webhook retried, or the
 * worker and the app both noticing the same payment, never thanks twice).
 */
export async function sayInChat(dedupeKey: string, line: string): Promise<boolean> {
  if (!getEnv().STREAMELEMENTS_JWT || !line) return false;
  try {
    const first = await redis().set(`wf:se:said:${dedupeKey}`, '1', 'EX', 86_400, 'NX');
    if (first !== 'OK') return false;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.name : 'unknown' }, 'chat announce failed');
    return false;
  }
  return (await botSay(line)).ok;
}
