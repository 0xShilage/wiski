'use client';
import { useEffect, useRef, useState } from 'react';
import { IconClose, IconPlay } from '@/components/ui/icons';
import { trailerEmbedUrl } from '@/lib/catalog/youtube';

/**
 * "Assistir trailer" + the trailer modal (11 §6, design §4). The YouTube player (privacy-enhanced
 * youtube-nocookie.com host) is created only after the click — nothing loads from Google before.
 * Native <dialog>: focus is trapped, Esc closes, focus returns to the button.
 */
export function TrailerButton({
  youtubeId,
  title,
  className = 'wf-btn wf-btn--ghost',
}: {
  youtubeId: string | null;
  title: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  if (!youtubeId) {
    return (
      <button
        type="button"
        className={className}
        aria-disabled="true"
        title="Trailer ainda não disponível"
      >
        <IconPlay />
        Assistir trailer
        <span className="sr-only"> (indisponível)</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <IconPlay />
        Assistir trailer
      </button>
      <dialog
        ref={dialog}
        className="wf-modal"
        aria-label={`Trailer: ${title}`}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // click on the backdrop (outside the content) closes
          if (e.target === dialog.current) setOpen(false);
        }}
      >
        <div className="wf-modal__bar">
          <p className="wf-modal__title">Trailer · {title}</p>
          <button
            type="button"
            className="wf-btn wf-btn--ghost wf-btn--sm"
            onClick={() => setOpen(false)}
          >
            Fechar <IconClose />
          </button>
        </div>
        <div className="wf-player">
          {open ? (
            <iframe
              src={trailerEmbedUrl(youtubeId)}
              title={`Trailer: ${title}`}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : null}
        </div>
      </dialog>
    </>
  );
}
