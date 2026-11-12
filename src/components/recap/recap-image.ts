/**
 * The shareable recap (2026-11-12): a 1080×1920 PNG (Stories / WhatsApp status) drawn on a canvas
 * in the browser, like the ticket — same-origin images only (the logo, the avatar, posters from
 * /media/), nothing sent anywhere. No amounts, no e-mail: it is meant to be posted.
 */
import { load, roundRect, wrap } from '@/components/checkout/ticket-image';

export type RecapImageInput = {
  year: number;
  username: string;
  avatarSrc: string;
  persona: string;
  highlights: { value: string; label: string }[];
  posters: string[];
  host: string;
  fonts: { display: string; sans: string };
};

const W = 1080;
const H = 1920;
const INK = '#1b1225';
const LAVENDER = '#a99de0';
const LILAC = '#e5dded';

export async function drawRecap(t: RecapImageInput): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c) return null;
  await document.fonts.ready;
  const [logo, avatar, ...posters] = await Promise.all([
    load('/brand/logo-wiski-lilac.svg'),
    load(t.avatarSrc),
    ...t.posters.slice(0, 4).map(load),
  ]);

  // ink, with lavender light from the top and a plum glow at the bottom
  c.fillStyle = INK;
  c.fillRect(0, 0, W, H);
  for (const [x, y, r, a] of [
    [W / 2, 0, 1100, 0.38],
    [W / 2, H, 900, 0.22],
  ] as const) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(115, 107, 178, ${a})`);
    g.addColorStop(1, 'rgba(27, 18, 37, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  if (logo) {
    const lw = 300;
    const lh = (logo.naturalHeight / logo.naturalWidth) * lw || 110;
    c.save();
    c.shadowColor = 'rgba(169, 157, 224, 0.85)';
    c.shadowBlur = 28;
    c.drawImage(logo, (W - lw) / 2, 96, lw, lh);
    c.restore();
  }

  c.fillStyle = LAVENDER;
  c.font = `600 30px ${t.fonts.sans}`;
  c.fillText(`RETROSPECTIVA ${t.year}`, W / 2, 330);
  c.save();
  c.shadowColor = 'rgba(169, 157, 224, 0.6)';
  c.shadowBlur = 30;
  c.fillStyle = LILAC;
  c.font = `400 104px ${t.fonts.display}`;
  c.fillText('MEU ANO NA', W / 2, 450);
  c.fillText('WISKIFLIX', W / 2, 560);
  c.restore();

  // avatar + username
  const ar = 78;
  const ay = 690;
  c.save();
  c.beginPath();
  c.arc(W / 2, ay, ar, 0, Math.PI * 2);
  c.closePath();
  c.clip();
  if (avatar) c.drawImage(avatar, W / 2 - ar, ay - ar, ar * 2, ar * 2);
  c.restore();
  c.strokeStyle = 'rgba(169, 157, 224, 0.9)';
  c.lineWidth = 6;
  c.beginPath();
  c.arc(W / 2, ay, ar + 3, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = LILAC;
  c.font = `600 44px ${t.fonts.sans}`;
  c.fillText(`@${t.username}`, W / 2, ay + ar + 70);

  // the role
  c.fillStyle = LAVENDER;
  c.font = `600 26px ${t.fonts.sans}`;
  c.fillText('MEU PAPEL NA LIVE', W / 2, 960);
  c.fillStyle = LILAC;
  c.font = `400 70px ${t.fonts.display}`;
  let py = 1040;
  for (const l of wrap(c, t.persona.toUpperCase(), W - 180, 2)) {
    c.fillText(l, W / 2, py);
    py += 76;
  }

  // the numbers: two columns of cards
  const items = t.highlights.slice(0, 6);
  const cols = 2;
  const gx = 90;
  const gap = 24;
  const cw = (W - 2 * gx - gap) / cols;
  const ch = 150;
  const top = py + 10;
  items.forEach((h, i) => {
    const x = gx + (i % cols) * (cw + gap);
    const y = top + Math.floor(i / cols) * (ch + gap);
    roundRect(c, x, y, cw, ch, 26);
    c.fillStyle = 'rgba(58, 44, 83, 0.85)';
    c.fill();
    c.strokeStyle = 'rgba(169, 157, 224, 0.35)';
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = LILAC;
    c.font = `700 56px ${t.fonts.sans}`;
    c.fillText(wrap(c, h.value, cw - 40, 1)[0] ?? '', x + cw / 2, y + 74);
    c.fillStyle = 'rgba(229, 221, 237, 0.78)';
    c.font = `500 26px ${t.fonts.sans}`;
    c.fillText(wrap(c, h.label, cw - 40, 1)[0] ?? '', x + cw / 2, y + 118);
  });

  // a strip of posters, when there is room
  const used = posters.filter((p): p is HTMLImageElement => p !== null);
  const rows = Math.ceil(items.length / cols);
  const sy = top + rows * (ch + gap) + 20;
  const pw = 150;
  const ph = 225;
  if (used.length && sy + ph < H - 180) {
    const total = used.length * pw + (used.length - 1) * 22;
    used.forEach((img, i) => {
      const x = (W - total) / 2 + i * (pw + 22);
      c.save();
      roundRect(c, x, sy, pw, ph, 16);
      c.clip();
      const s = Math.max(pw / img.naturalWidth, ph / img.naturalHeight);
      c.drawImage(
        img,
        x + (pw - img.naturalWidth * s) / 2,
        sy + (ph - img.naturalHeight * s) / 2,
        img.naturalWidth * s,
        img.naturalHeight * s,
      );
      c.restore();
    });
  }

  c.fillStyle = LILAC;
  c.font = `500 34px ${t.fonts.sans}`;
  c.fillText('Vem ver o próximo na live da Iara 🍿', W / 2, H - 120);
  c.fillStyle = LAVENDER;
  c.font = `600 30px ${t.fonts.sans}`;
  c.fillText(t.host, W / 2, H - 70);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
