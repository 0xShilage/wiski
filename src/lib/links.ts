/**
 * The streamer's Links page (Phase 6). Shared by the server (validation) and the pages (labels).
 * The platform comes from the link's host only (never from the label), and picks the button's
 * icon (`components/links/PlatformIcon`, 2026-11-01) and the small platform name.
 */
export const LINK_MAX = 30;
export const LINK_LABEL_MAX = 40;
export const LINK_NOTE_MAX = 80;
export const LINK_URL_MAX = 300;
/** The picture at the top of /links (scripts/links-photo.ts): 256 px, shown at 120 CSS px. */
export const LINKS_PHOTO_PX = 256;
export const LINKS_PHOTO_SRC = `/brand/links-iara-${LINKS_PHOTO_PX}.webp`;

const PLATFORMS: [RegExp, string][] = [
  [/(^|\.)twitch\.tv$/, 'Twitch'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'],
  [/(^|\.)kick\.com$/, 'Kick'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'X'],
  [/(^|\.)(discord\.gg|discord\.com)$/, 'Discord'],
  [/(^|\.)threads\.(net|com)$/, 'Threads'],
  [/(^|\.)bsky\.app$/, 'Bluesky'],
  [/(^|\.)facebook\.com$/, 'Facebook'],
  [/(^|\.)spotify\.com$/, 'Spotify'],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, 'WhatsApp'],
  [/(^|\.)letterboxd\.com$/, 'Letterboxd'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)(steamcommunity\.com|steampowered\.com)$/, 'Steam'],
  // Amazon's own storefronts only (a wishlist is amazon.com.br/hz/wishlist/…); short links too
  [
    /(^|\.)(amazon\.(com|com\.br|com\.mx|ca|co\.uk|de|es|fr|it|nl|co\.jp|in|com\.au)|amzn\.to|amzn\.eu|a\.co)$/,
    'Amazon',
  ],
  [/(^|\.)cinefy\.(app|gg|com|com\.br|io|tv|me)$/, 'Cinefy'],
];

/** "Twitch", "YouTube"… from the link's host, or null for any other site. */
export function platformOf(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [re, name] of PLATFORMS) if (re.test(host)) return name;
  return null;
}

/** The host without "www." — shown under links to sites that aren't a known platform. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * A link the page may show: https only (a bare "twitch.tv/x" gets https://), no user name or
 * password in it, a real host name (no IP address, no "localhost"), at most 300 characters after
 * the WHATWG parser normalised it (IDN hosts become punycode). Returns null otherwise.
 */
export function cleanLinkUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > LINK_URL_MAX || /\s/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname;
  if (!host.includes('.') || host.endsWith('.') || IPV4.test(host) || host.startsWith('['))
    return null;
  const out = u.toString();
  return out.length <= LINK_URL_MAX ? out : null;
}
