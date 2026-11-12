'use client';
import { useId, useState } from 'react';
import { BadgeArt } from '@/components/badges/BadgeArt';
import type { Picture } from '@/lib/media';
import { UPLOAD_MAX_BYTES } from '@/lib/media-downscale';
import { adminFetch } from '@/lib/passkey-client';

/** WebM → frames: at most 8 s at 12 frames per second, 256 px squares, 8 per row. */
const FPS = 12;
const MAX_SECONDS = 8;
const TILE = 256;
const COLS = 8;

function once(el: HTMLMediaElement, ev: string): Promise<void> {
  return new Promise((ok, ko) => {
    const done = () => {
      el.removeEventListener(ev, done);
      el.removeEventListener('error', fail);
      ok();
    };
    const fail = () => {
      el.removeEventListener(ev, done);
      el.removeEventListener('error', fail);
      ko(new Error('video'));
    };
    el.addEventListener(ev, done);
    el.addEventListener('error', fail);
  });
}

/**
 * Decodes a WebM HERE, in the moderator's browser, into one still image: a grid of square frames
 * (centre-cropped, transparency kept). The server never parses video; it cuts the grid back into
 * an animated WebP (src/server/media/pipeline.ts, `sprite`).
 */
async function webmToSprite(file: File): Promise<{ blob: Blob; frames: number }> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    await once(video, 'loadeddata');
    if (!Number.isFinite(video.duration)) {
      // a WebM straight from a recorder carries no duration: seeking past the end reveals it
      video.currentTime = 1e6;
      await once(video, 'seeked');
    }
    const duration = Math.min(Number.isFinite(video.duration) ? video.duration : 0, MAX_SECONDS);
    const frames = Math.max(2, Math.min(MAX_SECONDS * FPS, Math.floor(duration * FPS)));
    const rows = Math.ceil(frames / COLS);
    const canvas = document.createElement('canvas');
    canvas.width = COLS * TILE;
    canvas.height = rows * TILE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    const side = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - side) / 2;
    const sy = (video.videoHeight - side) / 2;
    for (let i = 0; i < frames; i++) {
      video.currentTime = Math.min(i / FPS, Math.max(0, video.duration - 0.01));
      await once(video, 'seeked');
      ctx.drawImage(
        video,
        sx,
        sy,
        side,
        side,
        (i % COLS) * TILE,
        Math.floor(i / COLS) * TILE,
        TILE,
        TILE,
      );
    }
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.9));
    if (!blob) throw new Error('encode');
    return { blob, frames };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Emblemas (2026-11-12): the badge's art. PNG (still, transparency kept), GIF (animated stays
 * animated) or WebM (decoded here into frames). Square; at least 128 × 128.
 */
export function BadgeArtDrop({
  picture,
  still,
  onUploaded,
}: {
  picture: Picture | null;
  still: Picture | null;
  onUploaded: (id: string, picture: Picture | null, still: Picture | null) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      let url = '/api/v1/admin/media?role=BADGE';
      let blob: Blob = file;
      if (file.type === 'video/webm' || /\.webm$/i.test(file.name)) {
        setBusy('Lendo o vídeo…');
        const s = await webmToSprite(file);
        blob = s.blob;
        url += `&frames=${s.frames}&fps=${FPS}&cols=${COLS}`;
      }
      if (blob.size > UPLOAD_MAX_BYTES) {
        setError('Arquivo maior que 10 MB. Use uma animação mais curta ou menor.');
        return;
      }
      setBusy('Processando…');
      const res = await adminFetch<{ id: string; picture: Picture | null }>(url, {
        method: 'POST',
        blob,
      });
      if (!res.ok) {
        setError(res.problem.detail);
        return;
      }
      // the still frame (for "reduce motion") comes with the badge list; show the art now
      onUploaded(res.data.id, res.data.picture, null);
    } catch {
      setError('Não deu para ler esse vídeo aqui. Tente outro navegador ou envie um GIF.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wf-badge-drop-wrap">
      <label
        htmlFor={id}
        className={`wf-drop wf-badge-drop ${over ? 'is-dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
      >
        <BadgeArt picture={picture} still={still} name="" size={160} />
        <span className="wf-drop__label">
          {busy ?? (picture ? 'Arte do emblema · trocar' : 'Arte do emblema')}
          <span className="sr-only">
            . PNG, GIF ou WebM, quadrado, a partir de 128 × 128. Animações até 8 segundos.
          </span>
        </span>
        <input
          id={id}
          type="file"
          accept="image/png,image/gif,image/webp,video/webm"
          className="sr-only"
          disabled={!!busy}
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      <p className="wf-hint">PNG, GIF ou WebM · quadrado · animações até 8 s</p>
      {error ? (
        <p role="alert" className="wf-hint wf-hint--err">
          {error}
        </p>
      ) : null}
    </div>
  );
}
