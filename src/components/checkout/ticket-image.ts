/**
 * The shareable ticket (2026-11-10): a 1080×1920 PNG (the Stories / WhatsApp status size) drawn
 * on a canvas in the browser — nothing is sent to a server. Everything it draws is same-origin
 * (the logo SVG, the poster from /media/, the site's own fonts), so the canvas is not tainted.
 * No order code on it: the image is meant to be posted publicly.
 */
export type TicketImageInput = {
  title: string;
  kicker: string; // "Patrocínio" | "Apoio"
  when: string;
  nameLabel: string; // "Patrocinador" | "Apoio de"
  name: string;
  seat: string; // "03", "✓", "—"
  seatNote: string;
  posterSrc: string | null;
  host: string;
  fonts: { display: string; sans: string };
};

const W = 1080;
const H = 1920;
const INK = '#1b1225';
const PLUM = '#2e2141';
const LAVENDER = '#a99de0';
const LILAC = '#e5dded';

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Up to `max` lines of `text` that fit `width`; the last one ends in "…" when cut. */
function wrap(c: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (c.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1]!;
  while (last.length > 1 && c.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[max - 1] = `${last.trimEnd()}…`;
  return kept;
}

/** The largest WebP of a srcset ("/media/a-240.webp 240w, /media/a-960.webp 960w"). */
export function largestFromSrcset(srcset: string): string | null {
  let best: { src: string; w: number } | null = null;
  for (const part of srcset.split(',')) {
    const [src, w] = part.trim().split(/\s+/);
    const n = Number.parseInt(w ?? '', 10);
    if (src && Number.isFinite(n) && (!best || n > best.w)) best = { src, w: n };
  }
  return best?.src ?? null;
}

export async function drawTicket(t: TicketImageInput): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c) return null;
  await document.fonts.ready;
  const [logo, poster] = await Promise.all([
    load('/brand/logo-wiski-lilac.svg'),
    t.posterSrc ? load(t.posterSrc) : Promise.resolve(null),
  ]);

  // background: ink with two soft lavender lights
  c.fillStyle = INK;
  c.fillRect(0, 0, W, H);
  for (const [x, y, r, a] of [
    [W / 2, 120, 900, 0.32],
    [W / 2, H - 80, 700, 0.18],
  ] as const) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(115, 107, 178, ${a})`);
    g.addColorStop(1, 'rgba(27, 18, 37, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  // logo, with its neon glow
  if (logo) {
    const lw = 340;
    const lh = (logo.naturalHeight / logo.naturalWidth) * lw || 120;
    c.save();
    c.shadowColor = 'rgba(169, 157, 224, 0.85)';
    c.shadowBlur = 28;
    c.drawImage(logo, (W - lw) / 2, 110, lw, lh);
    c.restore();
  }

  // the ticket card: main part + stub, notches at the perforation
  const x = 90;
  const y = 330;
  const w = W - 2 * x;
  const h = 1380;
  const perf = y + h - 250;
  c.save();
  c.shadowColor = 'rgba(169, 157, 224, 0.45)';
  c.shadowBlur = 40;
  roundRect(c, x, y, w, h, 36);
  const card = c.createLinearGradient(x, y, x + w, y + h);
  card.addColorStop(0, '#3a2a55');
  card.addColorStop(1, PLUM);
  c.fillStyle = card;
  c.fill();
  c.restore();
  // the notches: painted in the background colour (not cut out — a transparent PNG would show
  // white or black once posted)
  c.fillStyle = INK;
  for (const cx of [x, x + w]) {
    c.beginPath();
    c.arc(cx, perf, 30, 0, Math.PI * 2);
    c.fill();
  }
  c.strokeStyle = 'rgba(229, 221, 237, 0.35)';
  c.lineWidth = 4;
  c.setLineDash([18, 14]);
  c.beginPath();
  c.moveTo(x + 50, perf);
  c.lineTo(x + w - 50, perf);
  c.stroke();
  c.setLineDash([]);

  // kicker
  c.fillStyle = LAVENDER;
  c.font = `600 30px ${t.fonts.sans}`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillText(`INGRESSO · ${t.kicker.toUpperCase()}`, W / 2, y + 80);

  // poster
  const pw = 440;
  const ph = 660;
  const px = (W - pw) / 2;
  const py = y + 120;
  c.save();
  roundRect(c, px, py, pw, ph, 22);
  c.clip();
  if (poster) {
    const s = Math.max(pw / poster.naturalWidth, ph / poster.naturalHeight);
    const dw = poster.naturalWidth * s;
    const dh = poster.naturalHeight * s;
    c.drawImage(poster, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
  } else {
    c.fillStyle = INK;
    c.fillRect(px, py, pw, ph);
  }
  c.restore();
  c.save();
  roundRect(c, px, py, pw, ph, 22);
  c.strokeStyle = 'rgba(169, 157, 224, 0.6)';
  c.lineWidth = 3;
  c.stroke();
  c.restore();

  // title (display face, caps)
  c.fillStyle = LILAC;
  c.font = `400 66px ${t.fonts.display}`;
  const lines = wrap(c, t.title.toUpperCase(), w - 120, 2);
  let ty = py + ph + 96;
  for (const l of lines) {
    c.fillText(l, W / 2, ty);
    ty += 72;
  }

  // fields: when + sponsor
  const fy = perf - 120;
  for (const [i, [label, value]] of (
    [
      ['SESSÃO', t.when],
      [t.nameLabel.toUpperCase(), t.name],
    ] as const
  ).entries()) {
    const cx = x + (w / 4) * (i * 2 + 1);
    c.fillStyle = LAVENDER;
    c.font = `600 24px ${t.fonts.sans}`;
    c.fillText(label, cx, fy);
    c.fillStyle = LILAC;
    c.font = `500 34px ${t.fonts.sans}`;
    const [v] = wrap(c, value, w / 2 - 40, 1);
    c.fillText(v ?? '', cx, fy + 52);
  }

  // stub: the seat
  c.fillStyle = LAVENDER;
  c.font = `600 28px ${t.fonts.sans}`;
  c.fillText('FILA', W / 2, perf + 70);
  c.save();
  c.shadowColor = 'rgba(169, 157, 224, 0.95)';
  c.shadowBlur = 24;
  c.fillStyle = LILAC;
  c.font = `700 ${t.seat === '—' ? 72 : 108}px ${t.fonts.sans}`;
  c.fillText(t.seat, W / 2, perf + 170);
  c.restore();
  c.fillStyle = 'rgba(229, 221, 237, 0.7)';
  c.font = `400 24px ${t.fonts.sans}`;
  c.fillText(t.seatNote, W / 2, perf + 224);

  // footer
  c.fillStyle = LILAC;
  c.font = `500 34px ${t.fonts.sans}`;
  c.fillText('Patrocine o próximo da live também 🍿', W / 2, H - 120);
  c.fillStyle = LAVENDER;
  c.font = `600 30px ${t.fonts.sans}`;
  c.fillText(t.host, W / 2, H - 70);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
