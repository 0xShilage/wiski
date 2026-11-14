/**
 * Anúncios automáticos (2026-11-13): messages the StreamElements bot posts on its own when the
 * live starts, when something goes on screen, and when an event badge opens. Shared by the panel
 * (Chat da live › Anúncios automáticos) and the server.
 */
import { chatProblem, oneLine } from './chat';

export const ANNOUNCE_KINDS = ['start', 'now', 'badge'] as const;
export type AnnounceKind = (typeof ANNOUNCE_KINDS)[number];

export type Announcement = { on: boolean; text: string };
export type AnnounceSettings = Record<AnnounceKind, Announcement>;

/** What each announcement can say; `{site}` works in all of them. */
export const ANNOUNCE_PLACEHOLDERS: Record<
  AnnounceKind,
  readonly { key: string; label: string; example: string }[]
> = {
  start: [
    { key: 'programa', label: 'O que tem hoje', example: 'Aftersun, Dark (T1 · E1–E3) e mais 2' },
    { key: 'site', label: 'Endereço do site', example: 'wiski.fun' },
  ],
  now: [
    { key: 'titulo', label: 'O que está na tela', example: 'Dark · T1 · E1–E3' },
    { key: 'credito', label: 'Quem trouxe', example: '· patrocinado por @fulano 💜' },
    { key: 'site', label: 'Endereço do site', example: 'wiski.fun' },
  ],
  badge: [
    { key: 'emblema', label: 'Nome do emblema', example: 'Maratona de Terror' },
    { key: 'ate', label: 'Até quando', example: 'sábado, 14/11 às 23:59' },
    { key: 'site', label: 'Endereço do site', example: 'wiski.fun' },
  ],
};

export const ANNOUNCE_LABEL: Record<AnnounceKind, string> = {
  start: 'Quando a live começa',
  now: 'Quando algo entra na tela',
  badge: 'Quando um emblema abre',
};

export const DEFAULT_ANNOUNCE: AnnounceSettings = {
  start: { on: true, text: '🔴 A live começou! Hoje tem: {programa}. Agenda em {site}/cronograma' },
  now: { on: true, text: '🎬 Agora na tela: {titulo} {credito}' },
  badge: {
    on: true,
    text: '🏅 Emblema aberto: {emblema}! Resgate até {ate} em {site}/emblemas',
  },
};

const TOKEN = /\{([a-z]+)\}/g;

/** Placeholders a text uses that its announcement doesn't know. */
export function unknownPlaceholders(kind: AnnounceKind, text: string): string[] {
  const known = new Set(ANNOUNCE_PLACEHOLDERS[kind].map((p) => p.key));
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]!))].filter((k) => !known.has(k));
}

/** Fills an announcement (an empty value just disappears, spaces tidied). */
export function fillAnnouncement(text: string, vars: Record<string, string>): string {
  return oneLine(text.replace(TOKEN, (_, k: string) => vars[k] ?? ''));
}

/** Why a template can't be saved, or null. */
export function announceProblem(kind: AnnounceKind, text: string): string | null {
  const unknown = unknownPlaceholders(kind, text);
  if (unknown.length) return `Não existe {${unknown[0]}} neste anúncio.`;
  return chatProblem(oneLine(text.replace(TOKEN, 'x')));
}
