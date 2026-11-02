'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { IconClose } from '@/components/ui/icons';
import { apiFetch } from '@/lib/api-fetch';
import {
  REPORT_NOTE_MAX,
  REPORT_REASON_LABEL,
  REPORT_REASONS,
  type ReportReason,
} from '@/lib/reviews/types';
import { codePoints } from './format';

/**
 * "Denunciar" (03 §5.4): a reason, an optional note, sent once. Native <dialog> (focus trapped,
 * Esc closes, focus goes back to the button). The server decides account age and repeats.
 */
export function ReportDialog({
  reviewId,
  author,
  onClose,
}: {
  reviewId: string;
  author: string;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const tooLong = codePoints(note.trim()) > REPORT_NOTE_MAX;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || busy || tooLong) return;
    setBusy(true);
    setError(null);
    const r = await apiFetch<{ received: true }>(`/api/v1/reviews/${reviewId}/reports`, {
      method: 'POST',
      body: { reason, ...(note.trim() ? { note } : {}) },
    });
    setBusy(false);
    if (r.ok) setDone(true);
    else setError(r.problem.detail);
  }

  return (
    <dialog
      ref={dialog}
      className="wf-modal wf-modal--form"
      aria-labelledby={`${id}-t`}
      onClose={onClose}
      onCancel={onClose}
    >
      <div className="wf-panel">
        <div className="wf-modal__bar">
          <h2 id={`${id}-t`} className="m-0">
            Denunciar avaliação de @{author}
          </h2>
          <button type="button" className="wf-iconbtn" onClick={onClose} aria-label="Fechar">
            <IconClose />
          </button>
        </div>
        {done ? (
          <>
            <p className="wf-toast wf-toast--ok" role="status">
              Obrigado! A moderação vai dar uma olhada.
            </p>
            <button type="button" className="wf-btn wf-btn--ghost" onClick={onClose}>
              Fechar
            </button>
          </>
        ) : (
          <form className="wf-co" onSubmit={submit} noValidate>
            <fieldset>
              <legend>O que há de errado?</legend>
              {REPORT_REASONS.map((r) => (
                <label key={r} className="wf-check">
                  <input
                    type="radio"
                    name={`${id}-reason`}
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                  />
                  <span>{REPORT_REASON_LABEL[r]}</span>
                </label>
              ))}
            </fieldset>
            <label className="wf-field" htmlFor={`${id}-note`}>
              <span>Detalhes (opcional)</span>
              <textarea
                id={`${id}-note`}
                className="wf-input"
                rows={3}
                value={note}
                maxLength={REPORT_NOTE_MAX * 2}
                onChange={(e) => setNote(e.target.value)}
                aria-invalid={tooLong ? 'true' : undefined}
                aria-describedby={`${id}-note-hint`}
              />
              <span id={`${id}-note-hint`} className={tooLong ? 'wf-hint wf-hint--err' : 'wf-hint'}>
                {codePoints(note.trim())}/{REPORT_NOTE_MAX}. Não inclua dados pessoais.
              </span>
            </label>
            {error ? (
              <p className="wf-co__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="wf-co__row wf-co__row--end">
              <button type="button" className="wf-btn wf-btn--ghost" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="submit"
                className="wf-btn wf-btn--neon"
                disabled={!reason || busy || tooLong}
              >
                {busy ? 'Enviando…' : 'Enviar denúncia'}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
