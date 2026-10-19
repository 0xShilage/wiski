/**
 * YouTube trailer links (11 §6): the moderator pastes a link; only the 11-character video id is
 * kept. Accepted: youtube.com/watch?v=…, youtu.be/…, youtube.com/embed/…, /shorts/…, /live/…,
 * youtube-nocookie.com/embed/…, or the bare id. Anything else → null.
 */
const ID = /^[\w-]{11}$/;
const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
]);

export function parseYoutubeId(input: string): string | null {
  const s = input.trim();
  if (ID.test(s)) return s;
  if (s.length > 300) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;
  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = url.pathname.split('/')[1] ?? null;
  } else if (url.pathname === '/watch') {
    candidate = url.searchParams.get('v');
  } else {
    const m = /^\/(?:embed|shorts|live|v)\/([^/]+)\/?$/.exec(url.pathname);
    candidate = m?.[1] ?? null;
  }
  return candidate && ID.test(candidate) ? candidate : null;
}

/** The player URL used by the trailer modal (privacy-enhanced host, no related videos). */
export function trailerEmbedUrl(id: string): string {
  if (!ID.test(id)) throw new Error('invalid YouTube id');
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
}
