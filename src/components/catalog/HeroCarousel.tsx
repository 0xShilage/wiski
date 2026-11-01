'use client';
import Link from 'next/link';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { MediaPicture } from '@/components/media/MediaPicture';
import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons';
import type { PublicItem } from '@/lib/catalog/types';
import { MetaRow } from './MetaRow';
import { PriceLine, SponsorCta } from './SponsorLine';
import { TrailerButton } from './TrailerButton';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Filmes hero carousel (11 §3, design §2). Server-rendered with the first movie; this island
 * adds the ◀ ▶ buttons, ← → keys (while focus is inside the carousel), touch swipe and the
 * poster rail. No auto-rotation. The current title is announced politely after each change.
 */
export function HeroCarousel({
  items,
  label = 'Filmes para patrocinar',
  preview = false,
}: {
  items: PublicItem[];
  label?: string;
  /** dashboard "Ver como visitante": links inert */
  preview?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [announce, setAnnounce] = useState('');
  const track = useRef<HTMLUListElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const n = items.length;
  const item = items[Math.min(index, n - 1)]!;

  const select = useCallback(
    (i: number, focusCard = false) => {
      const next = ((i % n) + n) % n;
      setIndex(next);
      const it = items[next]!;
      setAnnounce(`${it.title} — filme ${next + 1} de ${n}`);
      if (focusCard) {
        requestAnimationFrame(() => {
          const visible = [
            ...document.querySelectorAll<HTMLButtonElement>(
              '.wf-rail button.wf-card[aria-current="true"]',
            ),
          ].find((b) => b.offsetParent !== null);
          visible?.focus({ preventScroll: true });
        });
      }
    },
    [items, n],
  );

  // Phones: the strip starts at the current film — scroll it back to the start on every change.
  useEffect(() => {
    track.current?.scrollTo({ left: 0 });
  }, [index]);

  // Warm the neighbours' backdrops so the next click paints immediately.
  useEffect(() => {
    for (const k of [index + 1, index - 1]) {
      const pic = items[((k % n) + n) % n]?.backdrop;
      if (!pic) continue;
      const img = new Image();
      img.sizes = '72vw';
      img.srcset = pic.webp;
    }
  }, [index, items, n]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest('dialog, input, textarea, select')) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    select(index + (e.key === 'ArrowRight' ? 1 : -1), target.classList.contains('wf-card'));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerUp = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) select(index + (dx < 0 ? 1 : -1));
  };

  const K = Math.min(Math.floor((n - 1) / 2), 9);
  const ring = Array.from({ length: 2 * K + 1 }, (_, j) => (((index - K + j) % n) + n) % n);
  const strip = Array.from({ length: n }, (_, j) => (index + j) % n);

  const card = (i: number) => {
    const it = items[i]!;
    return (
      <button
        type="button"
        className="wf-card"
        aria-current={i === index ? 'true' : undefined}
        aria-label={`${it.title}${it.state === 'SPONSORED' ? ', patrocinado' : it.state === 'RESERVED' ? ', reservado' : ''}`}
        tabIndex={i === index ? 0 : -1}
        onClick={() => select(i)}
      >
        <MediaPicture picture={it.poster} alt="" sizes="(max-width: 760px) 140px, 220px" />
        {/* WCAG 2.5.3 (label in name): title before the badge in the DOM (both are positioned)
            and a real space between them, so the visible text reads as the start of the name. */}
        {/* "Adicionar texto?" off: the poster art already carries the title */}
        {it.posterTitle ? (
          <span className="wf-card__title" aria-hidden="true">
            {it.title}
          </span>
        ) : null}{' '}
        {it.state === 'SPONSORED' ? (
          <span className="wf-badge wf-badge--sponsored" aria-hidden="true">
            Patrocinado
          </span>
        ) : it.state === 'RESERVED' ? (
          <span className="wf-badge wf-badge--reserved" aria-hidden="true">
            Reservado
          </span>
        ) : null}
      </button>
    );
  };

  const detail = `/filmes/${item.slug}`;
  return (
    <section
      className="wf-hero"
      aria-roledescription="carrossel"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      <div className="wf-hero__art" key={`art-${item.id}`}>
        <MediaPicture
          picture={item.backdrop}
          alt=""
          sizes="(max-width: 760px) 100vw, 72vw"
          priority={index === 0}
        />
      </div>
      <div className="wf-hero__shade" aria-hidden="true" />

      <div className="wf-hero__stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
        <div
          className="wf-hero__content"
          id="hero-slide"
          role="group"
          aria-roledescription="slide"
          aria-label={`${index + 1} de ${n}: ${item.title}`}
        >
          <h2 className="wf-hero__title">
            {item.logo ? (
              <span className="wf-hero__logo">
                <MediaPicture
                  picture={item.logo}
                  alt={item.title}
                  sizes="470px"
                  priority={index === 0}
                />
              </span>
            ) : (
              item.title
            )}
          </h2>
          <MetaRow
            className="wf-hero__meta"
            ageRating={item.ageRating}
            year={item.year}
            runtimeMinutes={item.runtimeMinutes}
            genres={item.genres}
          />
          <p className="wf-hero__synopsis">{item.synopsis}</p>
          {preview ? null : (
            <Link className="wf-hero__more" href={detail}>
              Ver mais<span className="sr-only"> sobre {item.title}</span>
            </Link>
          )}
          <div className="wf-hero__ctas">
            <TrailerButton youtubeId={item.trailerYoutubeId} title={item.title} />
            <SponsorCta item={item} className="wf-btn--primary-slot" />
          </div>
          <PriceLine item={item} className="wf-hero__price" />
        </div>

        {n > 1 ? (
          <div className="wf-hero__controls">
            <button
              type="button"
              className="wf-iconbtn"
              aria-label="Filme anterior"
              aria-controls="hero-slide"
              onClick={() => select(index - 1)}
            >
              <IconChevronLeft />
            </button>
            <button
              type="button"
              className="wf-iconbtn"
              aria-label="Próximo filme"
              aria-controls="hero-slide"
              onClick={() => select(index + 1)}
            >
              <IconChevronRight />
            </button>
            <p className="wf-hero__count" aria-hidden="true">
              <b>{pad2(index + 1)}</b> / {pad2(n)}
            </p>
          </div>
        ) : null}
      </div>

      {n > 1 ? (
        <>
          {/* Desktop: a ring centred on the current film (equal number of posters each side). */}
          <div className="wf-rail wf-rail--ring">
            <ul className="wf-rail__track" aria-label="Filmes próximos na lista">
              {ring.map((i) => (
                <li key={items[i]!.id}>{card(i)}</li>
              ))}
            </ul>
          </div>
          {/* Phones: a swipeable strip that starts at the current film. */}
          <div className="wf-rail wf-rail--strip">
            <ul className="wf-rail__track" ref={track} aria-label="Todos os filmes">
              {strip.map((i) => (
                <li key={items[i]!.id}>{card(i)}</li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
    </section>
  );
}
