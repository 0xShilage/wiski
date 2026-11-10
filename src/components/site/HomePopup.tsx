'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { MediaPicture } from '@/components/media/MediaPicture';
import type { HomePopup as Popup } from '@/lib/season';

const SEEN_KEY = 'wf:popup-seen';

function seen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function remember(id: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, id);
  } catch {
    // private mode / blocked storage: it may show again next time, nothing worse
  }
}

/**
 * The home pop-up (2026-11-10, Admin › Aparência): a modal <dialog> that fades in once per
 * visitor for each time the pop-up is switched on — the browser remembers the id it closed
 * (Esc, ✕, "Fechar", the button, a click outside).
 */
export function HomePopup({ popup }: { popup: Popup }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d || seen() === popup.id) return;
    const t = setTimeout(() => {
      try {
        d.showModal();
      } catch {
        // already open
      }
    }, 700);
    const onClose = () => remember(popup.id);
    d.addEventListener('close', onClose);
    return () => {
      clearTimeout(t);
      d.removeEventListener('close', onClose);
    };
  }, [popup.id]);

  const close = () => ref.current?.close();

  return (
    <dialog
      ref={ref}
      className="wf-popup"
      aria-labelledby="wf-popup-title"
      onClick={(e) => {
        // a click on the backdrop lands on the dialog element itself
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="wf-popup__card">
        <button type="button" className="wf-popup__x" aria-label="Fechar" onClick={close}>
          <span aria-hidden="true">✕</span>
        </button>
        {popup.image ? (
          <div className="wf-popup__img">
            <MediaPicture picture={popup.image} alt="" sizes="(max-width: 560px) 92vw, 520px" />
          </div>
        ) : null}
        <div className="wf-popup__body">
          <h2 id="wf-popup-title" className="wf-popup__title">
            {popup.title}
          </h2>
          <p className="wf-popup__text">{popup.body}</p>
          <div className="wf-popup__actions">
            {popup.cta ? (
              popup.cta.href.startsWith('/') ? (
                <Link
                  href={popup.cta.href}
                  className="wf-btn wf-btn--neon"
                  prefetch={false}
                  onClick={close}
                >
                  {popup.cta.label}
                </Link>
              ) : (
                <a
                  href={popup.cta.href}
                  className="wf-btn wf-btn--neon"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                >
                  {popup.cta.label}
                </a>
              )
            ) : null}
            <button type="button" className="wf-btn wf-btn--ghost" onClick={close}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
