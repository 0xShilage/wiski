'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Avatar } from '@/components/Avatar';
import { BadgeArt } from '@/components/badges/BadgeArt';
import { largestFromSrcset } from '@/components/checkout/ticket-image';
import { MediaPicture } from '@/components/media/MediaPicture';
import { avatarSrc, resolveAvatarKey } from '@/lib/avatars';
import {
  type CardId,
  type Persona,
  type Recap,
  type RecapTitle,
  hoursLabel,
  plural,
  recapHighlights,
} from '@/lib/recap';
import { drawRecap } from './recap-image';

const REDUCE = '(prefers-reduced-motion: reduce)';
function subscribeReduce(cb: () => void) {
  const mq = window.matchMedia?.(REDUCE);
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
}
const reduceNow = () => window.matchMedia?.(REDUCE).matches ?? false;

/** a press longer than this pauses (and doesn't move on when released) */
const HOLD_MS = 260;

function Posters({ items, label }: { items: RecapTitle[]; label: string }) {
  if (!items.length) return null;
  return (
    <ul className="wf-recap__posters" aria-label={label}>
      {items.map((t) => (
        <li key={t.slug} className="wf-recap__poster">
          {t.poster ? (
            <MediaPicture picture={t.poster} alt={t.title} sizes="120px" />
          ) : (
            <span className="wf-recap__poster-empty">{t.title}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Big({ value, unit }: { value: string; unit: string }) {
  return (
    <p className="wf-recap__big">
      <span className="wf-recap__num">{value}</span>
      <span className="wf-recap__unit">{unit}</span>
    </p>
  );
}

/**
 * "Seu ano na Wiskiflix" (2026-11-12): the year as story cards. Each card runs for a few seconds
 * (the bar at the top fills with a CSS animation; its end moves on); tap the right side or → for
 * the next, the left side or ← for the previous, hold or Space to pause. With reduced motion
 * nothing moves on its own. The last card makes a Stories-sized image to share.
 */
export function RecapStories({
  recap,
  cards,
  persona,
}: {
  recap: Recap;
  cards: CardId[];
  persona: Persona;
}) {
  const id = useId();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const reduce = useSyncExternalStore(subscribeReduce, reduceNow, () => false);
  const press = useRef<number | null>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const last = cards.length - 1;
  const card = cards[index]!;
  const m = recap.mine;
  const s = recap.site;

  const go = useCallback(
    (to: number) => {
      setIndex(Math.max(0, Math.min(last, to)));
      setNote(null);
    },
    [last],
  );

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const highlights = recapHighlights(recap);

  async function share() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const display = titleRef.current ? getComputedStyle(titleRef.current).fontFamily : 'serif';
      const posters = (m.sponsored.length ? m.sponsored : s.wall)
        .map((t) => (t.poster ? (largestFromSrcset(t.poster.webp) ?? t.poster.fallback) : null))
        .filter((p): p is string => p !== null);
      const blob = await drawRecap({
        year: recap.year,
        username: recap.username,
        avatarSrc: avatarSrc(resolveAvatarKey(recap.avatarKey), 128),
        persona: persona.title,
        highlights,
        posters,
        host: window.location.host,
        fonts: { display, sans: getComputedStyle(document.body).fontFamily },
      });
      if (!blob) throw new Error('no image');
      const file = new File([blob], `retrospectiva-wiski-${recap.year}.png`, { type: 'image/png' });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Meu ano na Wiskiflix ${recap.year}`,
            text: `Meu ${recap.year} na live da Iara: ${persona.title}! 🍿🎥`,
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

  const running = !paused && !held && !hidden && !reduce && index < last;

  function body(c: CardId) {
    switch (c) {
      case 'intro':
        return (
          <>
            <p className="wf-recap__eyebrow">Retrospectiva {recap.year}</p>
            <h2 className="wf-recap__title">Seu ano na Wiskiflix</h2>
            <div className="wf-recap__who">
              <Avatar avatarKey={recap.avatarKey} size={96} />
              <span>@{recap.username}</span>
            </div>
            <p className="wf-recap__hint">
              {reduce
                ? 'Use os botões abaixo para avançar.'
                : 'Toque para avançar · segure para pausar'}
            </p>
          </>
        );
      case 'live':
        return (
          <>
            <p className="wf-recap__eyebrow">A live em {recap.year}</p>
            {s.titles ? (
              <>
                <Big
                  value={s.titles.toLocaleString('pt-BR')}
                  unit={s.titles === 1 ? 'título na tela' : 'títulos na tela'}
                />
                <p className="wf-recap__line">
                  {[
                    s.movies ? plural(s.movies, 'filme', 'filmes') : null,
                    s.series ? plural(s.series, 'série ou anime', 'séries e animes') : null,
                    s.lives ? plural(s.lives, 'live', 'lives') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {s.movieMinutes ? (
                  <p className="wf-recap__line">{hoursLabel(s.movieMinutes)} de filmes juntos.</p>
                ) : null}
                <Posters items={s.wall} label="Títulos assistidos na live" />
              </>
            ) : (
              <p className="wf-recap__line wf-recap__line--lead">
                A tela ainda está esquentando: os primeiros títulos de {recap.year} aparecem aqui.
              </p>
            )}
          </>
        );
      case 'sponsored':
        return (
          <>
            <p className="wf-recap__eyebrow">Você patrocinou</p>
            <Big
              value={m.sponsorships.toLocaleString('pt-BR')}
              unit={m.sponsorships === 1 ? 'filme' : 'filmes'}
            />
            {m.minutes ? (
              <p className="wf-recap__line">{hoursLabel(m.minutes)} de live por sua causa.</p>
            ) : (
              <p className="wf-recap__line">Agora é só esperar a sessão.</p>
            )}
            <Posters items={m.sponsored} label="Filmes que você patrocinou" />
          </>
        );
      case 'supported':
        return (
          <>
            <p className="wf-recap__eyebrow">Nas vaquinhas</p>
            <Big
              value={m.contributions.toLocaleString('pt-BR')}
              unit={m.contributions === 1 ? 'cadeira sua' : 'cadeiras suas'}
            />
            <p className="wf-recap__line">
              {m.supported.length === 1
                ? `Você ajudou ${m.supported[0]!.title} a chegar à live.`
                : `Você ajudou ${m.supported.length} séries e franquias a chegar à live.`}
            </p>
            <Posters items={m.supported} label="O que você apoiou" />
          </>
        );
      case 'reviews':
        return (
          <>
            <p className="wf-recap__eyebrow">Sua crítica</p>
            <Big
              value={m.reviews.toLocaleString('pt-BR')}
              unit={m.reviews === 1 ? 'avaliação' : 'avaliações'}
            />
            {m.averageRating !== null ? (
              <p className="wf-recap__line">
                Média de {m.averageRating.toLocaleString('pt-BR')} <span aria-hidden="true">★</span>
                <span className="sr-only">estrelas</span>
              </p>
            ) : null}
            {m.likesReceived ? (
              <p className="wf-recap__line">
                {plural(m.likesReceived, 'curtida recebida', 'curtidas recebidas')}
              </p>
            ) : null}
            {m.topReview ? (
              <p className="wf-recap__quote">
                A mais curtida: <strong>{m.topReview.title}</strong> ·{' '}
                {plural(m.topReview.likes, 'curtida', 'curtidas')}
              </p>
            ) : null}
          </>
        );
      case 'suggestions':
        return (
          <>
            <p className="wf-recap__eyebrow">Suas sugestões</p>
            <Big
              value={m.suggestions.toLocaleString('pt-BR')}
              unit={m.suggestions === 1 ? 'sugestão' : 'sugestões'}
            />
            <p className="wf-recap__line">
              {m.suggestionsTaken
                ? `${plural(m.suggestionsTaken, 'entrou', 'entraram')} no radar da live.`
                : 'A moderação lê todas — continue mandando.'}
            </p>
          </>
        );
      case 'roleta':
        return (
          <>
            <p className="wf-recap__eyebrow">Na Roleta</p>
            <Big value={m.spins.toLocaleString('pt-BR')} unit={m.spins === 1 ? 'giro' : 'giros'} />
            <p className="wf-recap__line">
              {m.prizes
                ? `${plural(m.prizes, 'prêmio', 'prêmios')} no caminho.`
                : 'A sorte fica para o ano que vem.'}
            </p>
          </>
        );
      case 'badges':
        return (
          <>
            <p className="wf-recap__eyebrow">Você estava lá</p>
            <Big
              value={m.badges.length.toLocaleString('pt-BR')}
              unit={m.badges.length === 1 ? 'emblema' : 'emblemas'}
            />
            <ul className="wf-recap__badges" aria-label="Seus emblemas do ano">
              {m.badges.slice(0, 9).map((b) => (
                <li key={b.id}>
                  <BadgeArt picture={b.picture} still={b.still} name={b.name} size={88} />
                  <span>{b.name}</span>
                </li>
              ))}
            </ul>
          </>
        );
      case 'persona':
        return (
          <>
            <p className="wf-recap__eyebrow">Seu papel na live em {recap.year}</p>
            <p className="wf-recap__persona">{persona.title}</p>
            <p className="wf-recap__line wf-recap__line--lead">{persona.line}</p>
          </>
        );
      case 'final':
        return (
          <>
            <p className="wf-recap__eyebrow">Retrospectiva {recap.year}</p>
            <div className="wf-recap__who wf-recap__who--small">
              <Avatar avatarKey={recap.avatarKey} size={64} />
              <span>@{recap.username}</span>
            </div>
            <p ref={titleRef} className="wf-recap__persona wf-recap__persona--small">
              {persona.title}
            </p>
            <ul className="wf-recap__stats">
              {highlights.map((h) => (
                <li key={h.label}>
                  <span className="wf-recap__stat-value">{h.value}</span>
                  <span className="wf-recap__stat-label">{h.label}</span>
                </li>
              ))}
            </ul>
            <div className="wf-recap__actions">
              <button
                type="button"
                className="wf-btn wf-btn--neon"
                disabled={busy}
                onClick={() => void share()}
              >
                {busy ? 'Gerando…' : 'Compartilhar imagem'}
              </button>
              <button type="button" className="wf-btn wf-btn--ghost" onClick={() => go(0)}>
                Ver de novo
              </button>
            </div>
            {note ? (
              <p role="status" className="wf-recap__note">
                {note}
              </p>
            ) : null}
            <Link href="/perfil" className="wf-recap__back">
              Voltar ao perfil
            </Link>
          </>
        );
    }
  }

  return (
    <section
      className={`wf-recap${running ? '' : ' is-paused'}`}
      aria-roledescription="carrossel"
      aria-label={`Seu ano na Wiskiflix ${recap.year}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('button, a')) return;
        if (e.key === 'ArrowRight') go(index + 1);
        else if (e.key === 'ArrowLeft') go(index - 1);
        else if (e.key === ' ') {
          e.preventDefault();
          setPaused((p) => !p);
        } else return;
      }}
    >
      <ol className="wf-recap__bars" aria-hidden="true">
        {cards.map((c, i) => (
          <li
            key={c}
            className={`wf-recap__bar${i < index ? ' is-done' : i === index ? ' is-active' : ''}`}
          >
            {i === index ? (
              <span
                key={`${index}`}
                className="wf-recap__fill"
                onAnimationEnd={() => {
                  // only a bar that was really running moves on (not one finished while paused)
                  if (running) go(index + 1);
                }}
              />
            ) : (
              <span className="wf-recap__fill" />
            )}
          </li>
        ))}
      </ol>

      <div
        className="wf-recap__stage"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button, a')) return;
          press.current = e.timeStamp;
          setHeld(true);
        }}
        onPointerCancel={() => {
          press.current = null;
          setHeld(false);
        }}
        onPointerUp={(e) => {
          const started = press.current;
          press.current = null;
          if (started === null) return;
          setHeld(false);
          if (e.timeStamp - started > HOLD_MS) return;
          const box = e.currentTarget.getBoundingClientRect();
          go(e.clientX - box.left < box.width / 3 ? index - 1 : index + 1);
        }}
      >
        <article
          key={card}
          id={`${id}-card`}
          className={`wf-recap__card wf-recap__card--${card}`}
          aria-roledescription="cartão"
          aria-label={`${index + 1} de ${cards.length}`}
        >
          {body(card)}
        </article>
      </div>

      <div className="wf-recap__controls">
        <button
          type="button"
          className="wf-btn wf-btn--ghost wf-btn--sm"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-controls={`${id}-card`}
        >
          Anterior
        </button>
        {reduce || index === last ? null : (
          <button
            type="button"
            className="wf-btn wf-btn--ghost wf-btn--sm"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
          >
            {paused ? 'Continuar' : 'Pausar'}
          </button>
        )}
        <button
          type="button"
          className="wf-btn wf-btn--ghost wf-btn--sm"
          onClick={() => go(index + 1)}
          disabled={index === last}
          aria-controls={`${id}-card`}
        >
          Próximo
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        Cartão {index + 1} de {cards.length}
      </p>
    </section>
  );
}
