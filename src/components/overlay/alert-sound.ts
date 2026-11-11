/**
 * "Novo patrocínio" sound (2026-11-10): the chime is an mp3 served from the site (/sounds/chime.mp3),
 * then the spoken version from the server, if there is one. OBS plays it when "Control audio via
 * OBS" is ticked on the browser source; for Iara to hear it herself, the source's audio monitoring
 * must be "Monitor and Output" in OBS. A normal browser may block it until a click.
 */
const CHIME_URL = '/sounds/chime.mp3';

/** Plays the chime once; resolves when it ends, fails, or after `maxMs`. */
export function chime(maxMs = 6_000): Promise<void> {
  if (typeof Audio === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      const el = new Audio(CHIME_URL);
      el.addEventListener('ended', finish);
      el.addEventListener('error', finish);
      void el.play().catch(finish);
      setTimeout(finish, maxMs);
    } catch {
      finish();
    }
  });
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Plays the spoken alert; resolves when it ended, failed, or after `maxMs`. */
export function speak(url: string, maxMs = 40_000): Promise<void> {
  return new Promise((resolve) => {
    const el = new Audio(url);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.pause();
      resolve();
    };
    el.addEventListener('ended', finish);
    el.addEventListener('error', finish);
    void el.play().catch(finish);
    setTimeout(finish, maxMs);
  });
}

/**
 * How long an alert stays: the chime, then the voice (if any) and a moment after it — never
 * shorter than `minMs`.
 */
export async function playAlert(
  a: { id?: string | undefined; voice?: boolean | undefined },
  minMs: number,
): Promise<void> {
  const started = Date.now();
  void chime();
  if (a.voice && a.id) {
    await wait(1_300); // let the chime mostly ring out before the voice
    await speak(`/api/v1/overlay/tts?id=${encodeURIComponent(a.id)}`);
    await wait(1_500);
  }
  const left = minMs - (Date.now() - started);
  if (left > 0) await wait(left);
}
