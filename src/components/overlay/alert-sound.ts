/**
 * "Novo patrocínio" sound (2026-11-09): a short chime made with the Web Audio API (no file to
 * load), then the spoken version from the server, if there is one. OBS plays it when "Control
 * audio via OBS" is ticked on the browser source; a normal browser may block it until a click.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

/** Three bell-like notes (C6, E6, G6), about 1.2 s. */
export function chime(): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + 0.02;
  [1046.5, 1318.5, 1568].forEach((freq, i) => {
    const start = t0 + i * 0.14;
    for (const [mult, level] of [
      [1, 0.22],
      [2.01, 0.05],
    ] as const) {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
      osc.connect(gain).connect(a.destination);
      osc.start(start);
      osc.stop(start + 1.15);
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
  chime();
  if (a.voice && a.id) {
    await wait(900);
    await speak(`/api/v1/overlay/tts?id=${encodeURIComponent(a.id)}`);
    await wait(1_500);
  }
  const left = minMs - (Date.now() - started);
  if (left > 0) await wait(left);
}
