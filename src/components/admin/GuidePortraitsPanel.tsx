'use client';
import { useState } from 'react';
import { MediaDrop } from '@/components/admin/MediaDrop';
import { ERAS, type Slot } from '@/lib/guides/dark-s1';
import type { Picture } from '@/lib/media';
import { adminFetch } from '@/lib/passkey-client';

/**
 * Admin › Guia de Winden (2026-11-12): a photo slot per character version (each era has its own
 * actor). Drop a picture → it goes through the media pipeline as a PORTRAIT (3:4) and is put in the
 * slot; "Remover" takes it out. The public guide shows a photo only with its person, so it keeps
 * the same spoiler gates. This page lists every era and episode: it is the team's view.
 */
export function GuidePortraitsPanel({
  guide,
  slots,
  initial,
}: {
  guide: string;
  slots: Slot[];
  initial: Record<string, Picture>;
}) {
  const [pics, setPics] = useState(initial);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  async function put(slot: string, assetId: string | null, name: string) {
    setToast(null);
    const r = await adminFetch<{ picture: Picture | null }>(
      `/api/v1/admin/guides/${guide}/portraits`,
      { method: 'PUT', body: { slot, assetId } },
    );
    if (!r.ok) {
      setToast({ ok: false, text: r.problem.errors?.[0]?.message ?? r.problem.detail });
      return;
    }
    setPics((p) => {
      const next = { ...p };
      if (r.data.picture) next[slot] = r.data.picture;
      else delete next[slot];
      return next;
    });
    setToast({ ok: true, text: assetId ? `Foto de ${name} salva.` : `Foto de ${name} removida.` });
  }

  const filled = slots.filter((s) => pics[s.slot]).length;
  return (
    <>
      <p className="wf-muted">
        {filled} de {slots.length} fotos. Use imagens que vocês têm direito de usar; o site recorta
        em retrato (3:4) e converte. Cada época tem o seu ator, por isso a mesma pessoa aparece mais
        de uma vez.
      </p>
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}
      {ERAS.map((era) => {
        const list = slots.filter((s) => s.era === era.id);
        return (
          <section key={era.id} className="wf-ops-card" aria-labelledby={`era-${era.id}`}>
            <h2 id={`era-${era.id}`}>
              {era.id} <small className="wf-muted">· aparece a partir do episódio {era.from}</small>
            </h2>
            <ul className="wf-portraits">
              {list.map((s) => (
                <li key={s.slot} className="wf-portraits__item">
                  <MediaDrop
                    role="PORTRAIT"
                    label={s.name}
                    hint={`Retrato 3:4, pelo menos 300 × 400. No guia a partir do episódio ${s.from}.`}
                    picture={pics[s.slot] ?? null}
                    className="wf-drop--portrait"
                    onUploaded={(id) => void put(s.slot, id, s.name)}
                    onClear={() => void put(s.slot, null, s.name)}
                  />
                  <span className="wf-portraits__meta">ep. {s.from}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
