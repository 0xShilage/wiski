'use client';
import { useId, useState } from 'react';
import { MediaPicture } from '@/components/media/MediaPicture';
import type { Picture } from '@/lib/media';
import { adminFetch } from '@/lib/passkey-client';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';
const MAX = 10 * 1024 * 1024;

/**
 * Image drop zone (11 §4/§5): click or drop a file → raw upload → the server re-encodes it and
 * answers with the processed variants. Format/size hints are informative; the server decides.
 */
export function MediaDrop({
  role,
  label,
  hint,
  picture,
  onUploaded,
  onClear,
  className,
}: {
  role: 'POSTER' | 'BACKDROP' | 'LOGO';
  label: string;
  hint: string;
  picture: Picture | null;
  onUploaded: (id: string, picture: Picture | null) => void;
  onClear: () => void;
  className: string;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > MAX) {
      setError('Arquivo maior que 10 MB.');
      return;
    }
    setBusy(true);
    const res = await adminFetch<{ id: string; picture: Picture | null }>(
      `/api/v1/admin/media?role=${role}`,
      { method: 'POST', blob: file },
    );
    setBusy(false);
    if (res.ok) onUploaded(res.data.id, res.data.picture);
    else setError(res.problem.detail);
  }

  return (
    <div className="grid gap-1">
      <label
        htmlFor={id}
        className={`wf-drop ${className} ${over ? 'is-dragover' : ''}`}
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
        <MediaPicture picture={picture} alt="" sizes="240px" />
        <span className="wf-drop__label">
          {busy ? 'Processando…' : picture ? `${label} · trocar` : label}
          <span className="sr-only">. {hint}</span>
        </span>
        <input
          id={id}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {picture && !busy ? (
        <button type="button" className="wf-linkbtn text-xs" onClick={onClear}>
          Remover<span className="sr-only"> {label}</span>
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="wf-hint wf-hint--err">
          {error}
        </p>
      ) : null}
    </div>
  );
}
