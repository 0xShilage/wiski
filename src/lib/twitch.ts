/** Iara's channel (twitch.tv/iarawiski): the home page's live block. */
export const TWITCH_CHANNEL = 'iarawiski';
export const TWITCH_URL = `https://www.twitch.tv/${TWITCH_CHANNEL}`;

/**
 * The embedded player. Twitch requires `parent` = the embedding page's host name (the site's
 * own, e.g. wiski.fun); it starts muted so the browser lets it autoplay after the click.
 */
export function twitchPlayerUrl(parent: string): string {
  const q = new URLSearchParams({
    channel: TWITCH_CHANNEL,
    parent,
    muted: 'true',
    autoplay: 'true',
  });
  return `https://player.twitch.tv/?${q.toString()}`;
}
