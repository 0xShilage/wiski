'use client';
import { useRef, useState } from 'react';
import { LogoWiskiLilac } from '@/components/brand/generated';
import { MediaPicture } from '@/components/media/MediaPicture';
import type { OrderView } from '@/lib/checkout/types';
import { drawTicket, largestFromSrcset } from './ticket-image';

type Order = OrderView['order'];

const whenFmt = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

function when(o: Order): string {
  if (o.status === 'COMPLETED') return 'Assistido ✓';
  if (o.status === 'WATCHING') return 'Passando agora!';
  if (o.session && o.session.status !== 'CANCELLED')
    return whenFmt.format(new Date(o.session.startsAt)).replace(/\./g, '');
  return 'Data a definir';
}

/**
 * The cinema ticket (2026-11-10) on a paid order's page: poster, title, session, the public
 * sponsor name and the "seat" — the place in the Fila tab (Fila 03 = third in line). "Compartilhar
 * ingresso" makes a Stories-sized PNG in the browser (ticket-image.ts) and opens the phone's
 * share sheet, or downloads it where sharing files isn't supported (most desktops).
 */
export function Ticket({ order }: { order: Order }) {
  const t = order.ticket!;
  const contribution = order.kind === 'CONTRIBUTION';
  const kicker = contribution ? 'Apoio' : 'Patrocínio';
  const nameLabel = contribution ? 'Apoio de' : 'Patrocinador';
  const name = t.name ?? 'Anônimo';
  const seat = t.seat ? String(t.seat).padStart(2, '0') : t.watched ? '✓' : '—';
  const seatNote = t.seat
    ? t.seat === 1
      ? 'é o próximo da Fila!'
      : 'sua posição na Fila'
    : t.watched
      ? 'já assistido na live'
      : contribution
        ? 'entra na Fila com a meta'
        : 'entrando na Fila';
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function share() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const display = titleRef.current ? getComputedStyle(titleRef.current).fontFamily : 'serif';
      const blob = await drawTicket({
        title: order.item.title,
        kicker,
        when: when(order),
        nameLabel,
        name,
        seat,
        seatNote,
        posterSrc: t.poster ? (largestFromSrcset(t.poster.webp) ?? t.poster.fallback) : null,
        host: window.location.host,
        fonts: { display, sans: getComputedStyle(document.body).fontFamily },
      });
      if (!blob) throw new Error('no image');
      const file = new File([blob], `ingresso-wiski-${order.item.slug}.png`, { type: 'image/png' });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Ingresso: ${order.item.title}`,
            text: `${contribution ? 'Apoiei' : 'Patrocinei'} ${order.item.title} na live da Iara! 🍿🎥`,
          });
        } catch (err) {
          if ((err as Error).name !== 'AbortError') throw err;
        }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setNote('Imagem salva — poste nos stories ou no status do WhatsApp!');
      }
    } catch {
      setNote('Não deu para gerar a imagem agora. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wf-ticket-wrap">
      <div className="wf-ticket-glow">
        <section className="wf-ticket" aria-label={`Ingresso: ${order.item.title}`}>
          <div className="wf-ticket__main">
            <div className="wf-ticket__poster">
              <MediaPicture picture={t.poster} alt="" sizes="120px" />
            </div>
            <div className="wf-ticket__body">
              <p className="wf-ticket__brand">
                <LogoWiskiLilac className="wf-ticket__logo" aria-hidden="true" focusable="false" />
                <span>Ingresso · {kicker}</span>
              </p>
              <h2 ref={titleRef} className="wf-ticket__title">
                {order.item.title}
              </h2>
              <dl className="wf-ticket__fields">
                <div>
                  <dt>Sessão</dt>
                  <dd>{when(order)}</dd>
                </div>
                <div>
                  <dt>{nameLabel}</dt>
                  <dd>{name}</dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="wf-ticket__stub">
            <span className="wf-ticket__seat-label">Fila</span>
            <span className="wf-ticket__seat">{seat}</span>
            <span className="wf-ticket__seat-note">{seatNote}</span>
            <span className="wf-ticket__code">{order.code}</span>
          </div>
        </section>
      </div>
      <div className="wf-ticket__actions">
        <button
          type="button"
          className="wf-btn wf-btn--neon wf-btn--sm"
          disabled={busy}
          onClick={() => void share()}
        >
          {busy ? 'Gerando imagem…' : 'Compartilhar ingresso'}
        </button>
        {note ? (
          <p className="wf-hint" role="status">
            {note}
          </p>
        ) : null}
      </div>
    </div>
  );
}
