/**
 * Chat da live (2026-11-11): messages the team sends to the Twitch chat through the StreamElements
 * bot, from the dashboard. Shared by the panel (preview, counter) and the server (the rules).
 */

/** Twitch's own limit for one chat message. */
export const CHAT_MAX = 500;
export const PRESET_MAX = 20;
export const PRESET_LABEL_MAX = 40;

/**
 * Placeholders filled in when the message is sent, so a saved message stays right: the site's
 * address, what is on screen now and when the next live is.
 */
export const PLACEHOLDERS = [
  { key: 'site', label: 'Endereço do site', example: 'wiski.fun' },
  { key: 'agora', label: 'Passando agora', example: 'Duna' },
  { key: 'proxima', label: 'Próxima live', example: 'quinta, 12/11 às 20:00' },
] as const;
export type PlaceholderKey = (typeof PLACEHOLDERS)[number]['key'];
export type ChatVars = Record<PlaceholderKey, string | null>;

const TOKEN = /\{(site|agora|proxima)\}/g;

/** One line, as Twitch shows it: no line breaks or control characters, single spaces, trimmed. */
export function oneLine(raw: string): string {
  return (
    raw
      .normalize('NFC')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Code points, the way Twitch counts (an emoji is one). */
export function chatLength(s: string): number {
  return [...s].length;
}

/** The placeholders used in a message. */
export function placeholdersIn(text: string): PlaceholderKey[] {
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1] as PlaceholderKey))];
}

/**
 * Fills the placeholders. `missing` lists the ones with no value right now (nothing on screen,
 * no live planned): the message isn't sent with a hole in it.
 */
export function expand(text: string, vars: ChatVars): { text: string; missing: PlaceholderKey[] } {
  const missing = placeholdersIn(text).filter((k) => !vars[k]);
  return { text: text.replace(TOKEN, (_, k: PlaceholderKey) => vars[k] ?? ''), missing };
}

/**
 * Why a message can't go to chat as it is, or null. A leading "/" or "." is a Twitch chat
 * command (the bot is a moderator: "/ban", ".clear"), so those are refused; "!" commands are
 * fine (they are just text to Twitch).
 */
export function chatProblem(text: string): string | null {
  if (!text) return 'Escreva a mensagem.';
  if (/^[/.]/.test(text))
    return 'Comandos do Twitch ("/" ou "." no começo) não são enviados daqui.';
  if (chatLength(text) > CHAT_MAX) return `O chat do Twitch aceita até ${CHAT_MAX} caracteres.`;
  return null;
}
