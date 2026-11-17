import 'server-only';
import { placeText } from '@/lib/bingo';
import { chatSafe } from '@/lib/stream-safe';
import { getAlertSettings, sayInChat } from '../overlay/alerts';
import { bingoEvent } from '../overlay/events';
import { publishOverlay } from '../overlay/publish';

/** at most this many winners of one call get their own alert; the rest are summed up in chat */
export const BINGO_ANNOUNCED = 3;

/** "BINGO! @tialu completou uma linha e é o 1º lugar de hoje! 🎉" */
export function bingoChatLine(username: string, place: number): string {
  return chatSafe(
    `BINGO! @${username.replace(/^@/, '')} completou uma linha e é o ${placeText(place)} lugar de hoje! 🎉`,
  );
}

/**
 * After a call (or a late card) made bingos: "BINGO!" on the alert widget and a line in chat
 * (when chat alerts are on in Overlays), once per viewer and day.
 */
export async function announceBingo(
  day: Date,
  wins: { userId: string; username: string | null; place: number }[],
  now = new Date(),
): Promise<void> {
  const named = wins.filter((w): w is typeof w & { username: string } => !!w.username);
  if (!named.length) return;
  const settings = await getAlertSettings();
  const chat = settings.chat && settings.chatReady;
  const dayKey = day.toISOString().slice(0, 10);
  for (const w of named.slice(0, BINGO_ANNOUNCED)) {
    const e = bingoEvent(w.username, w.place, now);
    if (e) await publishOverlay('patrocinio', e);
    if (chat) await sayInChat(`bingo:${dayKey}:${w.userId}`, bingoChatLine(w.username, w.place));
  }
  const rest = named.length - BINGO_ANNOUNCED;
  if (rest > 0 && chat) {
    const first = named[BINGO_ANNOUNCED]!;
    await sayInChat(
      `bingo:${dayKey}:more:${first.place}`,
      chatSafe(
        `E mais ${rest} ${rest === 1 ? 'pessoa também fez' : 'pessoas também fizeram'} bingo agora! 🎉`,
      ),
    );
  }
}
