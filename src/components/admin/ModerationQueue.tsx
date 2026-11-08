'use client';
import Link from 'next/link';
import { useState } from 'react';
import { KIND_PATH } from '@/lib/catalog/kinds';
import { adminFetch } from '@/lib/passkey-client';
import {
  REPORT_REASON_LABEL,
  type ModerationAction,
  type ModerationQueue as Queue,
  type QueueEntry,
} from '@/lib/reviews/types';
import { reviewDate } from '@/components/reviews/format';
import { Stars } from '@/components/reviews/Stars';

const STATUS_LABEL = {
  VISIBLE: 'Visível',
  AUTO_HIDDEN: 'Escondida automaticamente',
  HIDDEN: 'Oculta pela moderação',
  REMOVED: 'Removida',
} as const;

const ACTION_LABEL: Record<ModerationAction, string> = {
  HIDE: 'Ocultar',
  RESTORE: 'Restaurar',
  DISMISS: 'Dispensar denúncias',
  REMOVE: 'Remover de vez',
};

function actionsFor(e: QueueEntry): ModerationAction[] {
  const s = e.review.status;
  const out: ModerationAction[] = [];
  if (s === 'VISIBLE') out.push('HIDE', ...(e.openReports.length ? (['DISMISS'] as const) : []));
  if (s === 'AUTO_HIDDEN') out.push('RESTORE', 'HIDE');
  if (s === 'HIDDEN') out.push('RESTORE');
  if (s !== 'REMOVED') out.push('REMOVE');
  return out;
}

function Entry({
  e,
  busy,
  onAct,
}: {
  e: QueueEntry;
  busy: boolean;
  onAct: (e: QueueEntry, a: ModerationAction) => void;
}) {
  const r = e.review;
  return (
    <li className={r.status === 'AUTO_HIDDEN' ? 'wf-mod__entry is-held' : 'wf-mod__entry'}>
      <div className="grid gap-2">
        <p className="m-0 text-sm">
          <span className="wf-chip">{STATUS_LABEL[r.status]}</span>{' '}
          {r.heldReason === 'LINKS'
            ? 'mais de 2 links'
            : r.heldReason === 'REPORTS'
              ? '3+ denúncias'
              : ''}
        </p>
        <p className="m-0 font-semibold">
          <Link href={`/${KIND_PATH[r.item.kind]}/${r.item.slug}`} target="_blank">
            {r.item.title}
          </Link>
        </p>
        <div className="wf-review__meta">
          <Stars rating={r.rating} size="sm" />
          <span className="wf-muted text-xs">
            @{r.author.username} · conta de {r.authorAccountDays} dias · {r.authorReviewCount}{' '}
            {r.authorReviewCount === 1 ? 'avaliação' : 'avaliações'} · {reviewDate(r.createdAt)}
            {r.editedAt ? ' · editado' : ''}
            {r.containsSpoilers ? ' · marcou spoiler' : ''}
          </span>
        </div>
        <p className="wf-review__body">{r.body}</p>
      </div>
      <div className="grid content-start gap-2">
        <p className="m-0 text-sm font-semibold">
          {e.openReports.length
            ? `${e.openReports.length} ${e.openReports.length === 1 ? 'denúncia aberta' : 'denúncias abertas'}`
            : 'Sem denúncias abertas'}
        </p>
        {e.openReports.length ? (
          <ul className="wf-mod__reports">
            {e.openReports.map((p) => (
              <li key={p.id}>
                <strong>{REPORT_REASON_LABEL[p.reason]}</strong>
                <span className="wf-muted">
                  {' '}
                  · @{p.reporter.username ?? 'sem-nome'} (conta de {p.reporter.accountDays} dias)
                </span>
                {p.note ? <span className="block">{p.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="wf-mod__actions">
          {actionsFor(e).map((a) => (
            <button
              key={a}
              type="button"
              className={
                a === 'REMOVE'
                  ? 'wf-btn wf-btn--sm wf-btn--danger'
                  : a === 'RESTORE' || a === 'DISMISS'
                    ? 'wf-btn wf-btn--sm wf-btn--ghost'
                    : 'wf-btn wf-btn--sm wf-btn--neon'
              }
              disabled={busy}
              onClick={() => onAct(e, a)}
            >
              {ACTION_LABEL[a]}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}

/**
 * Moderation queue (03 §5.6, Q15): held reviews first, then reported ones, with every open report
 * (reason, note, reporter's account age); the moderator acts on the status they see — if someone
 * else acted first, the server answers 409 and the queue reloads.
 */
export function ModerationQueue({ initial }: { initial: Queue; role: 'MODERATOR' | 'STREAMER' }) {
  const [queue, setQueue] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  async function reload() {
    const r = await adminFetch<Queue>('/api/v1/admin/moderation/queue');
    if (r.ok) setQueue(r.data);
  }

  async function act(e: QueueEntry, action: ModerationAction) {
    if (
      action === 'REMOVE' &&
      !window.confirm('Remover esta avaliação de vez? Não dá para desfazer.')
    ) {
      return;
    }
    setBusy(e.review.id);
    setToast(null);
    const r = await adminFetch<{ status: string; resolvedReports: number }>(
      `/api/v1/admin/moderation/reviews/${e.review.id}`,
      { method: 'POST', body: { action, expectedStatus: e.review.status } },
    );
    setBusy(null);
    setToast(
      r.ok
        ? {
            ok: true,
            text: `${ACTION_LABEL[action]}: feito (avaliação de @${e.review.author.username}).`,
          }
        : { ok: false, text: r.problem.detail },
    );
    await reload();
  }

  return (
    <>
      {toast ? (
        <p role="status" className={toast.ok ? 'wf-toast wf-toast--ok' : 'wf-toast wf-toast--err'}>
          {toast.text}
        </p>
      ) : null}

      {queue.anomalies.length ? (
        <section className="wf-panel" aria-labelledby="sinais">
          <h2 id="sinais">Sinais de brigada (últimas 24 h)</h2>
          <ul className="wf-mod__signals">
            {queue.anomalies.map((a, i) =>
              a.kind === 'LIKE_BURST' ? (
                <li key={i}>
                  {a.likes24h} curtidas numa avaliação de “{a.title}” — {a.fromNewAccounts} de
                  contas com menos de 7 dias.
                </li>
              ) : (
                <li key={i}>
                  @{a.username ?? 'sem-nome'} fez {a.reports24h} denúncias.
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="fila">
        <h2 className="wf-h2" id="fila">
          Fila{queue.total ? ` · ${queue.total}` : ''}
        </h2>
        {queue.entries.length ? (
          <ul className="wf-mod__list mt-4">
            {queue.entries.map((e) => (
              <Entry
                key={e.review.id}
                e={e}
                busy={busy === e.review.id}
                onAct={(x, a) => void act(x, a)}
              />
            ))}
          </ul>
        ) : (
          <p className="wf-muted mt-4">Nada esperando a moderação. 🎉</p>
        )}
      </section>

      {queue.hidden.length ? (
        <section aria-labelledby="ocultas">
          <h2 className="wf-h2" id="ocultas">
            Ocultas recentemente
          </h2>
          <ul className="wf-mod__list mt-4">
            {queue.hidden.map((e) => (
              <Entry
                key={e.review.id}
                e={e}
                busy={busy === e.review.id}
                onAct={(x, a) => void act(x, a)}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
