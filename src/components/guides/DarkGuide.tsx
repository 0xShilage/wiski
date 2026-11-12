'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  clampEpisode,
  EPISODE_COUNT,
  EPISODES,
  type Era,
  ERAS,
  erasUnlocked,
  FAMILIES,
  peopleAt,
  peopleFor,
  placesFor,
  placesOf,
} from '@/lib/guides/dark-s1';
import { WindenMap } from './WindenMap';

const STORE = 'wf:guia:dark:ep';

/**
 * Guia de Winden (2026-11-11): the first season of "Dark" without spoilers. The viewer says how
 * far they have watched; the map, the eras and the families only ever show what the series has
 * shown up to there. The choice is remembered in this browser (and kept in the address as ?ep=,
 * so a link from the chat opens at the same point).
 */
export function DarkGuide({ initialEp, fromUrl }: { initialEp: number; fromUrl: boolean }) {
  const [ep, setEp] = useState(initialEp);
  const [eraPick, setEraPick] = useState<Era>('2019');
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  // the episode remembered in this browser, unless the link says one
  useEffect(() => {
    if (fromUrl) return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORE);
    } catch {
      /* storage blocked: start at episode 1 */
    }
    if (saved) {
      const n = clampEpisode(saved);
      queueMicrotask(() => setEp(n));
    }
  }, [fromUrl]);

  function choose(n: number) {
    setEp(n);
    setFocus(null);
    try {
      window.localStorage.setItem(STORE, String(n));
    } catch {
      /* not remembered: fine */
    }
    const url = new URL(window.location.href);
    url.searchParams.set('ep', String(n));
    window.history.replaceState(null, '', url);
  }

  const unlocked = erasUnlocked(ep);
  const era: Era = unlocked.includes(eraPick) ? eraPick : '2019';
  const places = useMemo(() => placesFor(era, ep), [era, ep]);
  const people = useMemo(() => peopleFor(era, ep), [era, ep]);
  const place = places.find((p) => p.id === selected) ?? null;
  const here = place ? peopleAt(place.id, era, ep) : [];
  const focused = people.find((s) => s.person.id === focus) ?? null;
  const highlighted = useMemo(
    () => new Set(focused ? placesOf(focused, era, ep) : []),
    [focused, era, ep],
  );

  function pickPlace(id: string) {
    setSelected(id);
    setFocus(null);
  }
  function pickPerson(id: string) {
    setFocus(id);
    setSelected(null);
    document
      .getElementById(`pessoa-${id}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  return (
    <div className="wf-guide">
      <section className="wf-guide__controls" aria-labelledby="guia-ep">
        <h2 id="guia-ep" className="wf-guide__label">
          Já assisti até o episódio
        </h2>
        <div className="wf-guide__eps" role="radiogroup" aria-labelledby="guia-ep">
          {EPISODES.map((title, i) => {
            const n = i + 1;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === ep}
                aria-label={`Episódio ${n}`}
                className={
                  n === ep ? 'wf-guide__ep is-on' : n < ep ? 'wf-guide__ep is-seen' : 'wf-guide__ep'
                }
                onClick={() => choose(n)}
              >
                {n}
              </button>
            );
          })}
        </div>
        <p className="wf-guide__now" aria-live="polite">
          <strong>Episódio {ep}</strong> · <span lang="de">{EPISODES[ep - 1]}</span>
          {ep === EPISODE_COUNT ? ' · fim da 1ª temporada' : ''}
        </p>
      </section>

      <div className="wf-guide__eras" role="tablist" aria-label="Época">
        {ERAS.filter((e) => unlocked.includes(e.id)).map((e) => (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={e.id === era}
            className={e.id === era ? 'wf-guide__era is-on' : 'wf-guide__era'}
            onClick={() => {
              setEraPick(e.id);
              setSelected(null);
              setFocus(null);
            }}
          >
            {e.id}
          </button>
        ))}
        {unlocked.length < ERAS.length ? (
          <span className="wf-guide__more">Mais coisas aparecem conforme você assiste.</span>
        ) : null}
      </div>

      <div className="wf-guide__main" role="tabpanel" aria-label={`Winden em ${era}`}>
        <div className="wf-guide__map">
          <WindenMap
            era={era}
            places={places}
            selected={selected}
            highlighted={highlighted}
            onSelect={pickPlace}
          />
          <p className="wf-guide__note">Mapa ilustrativo: as posições são aproximadas.</p>
        </div>

        <aside className="wf-guide__panel" aria-live="polite">
          {place ? (
            <>
              <p className="wf-guide__kicker">{era}</p>
              <h2 className="wf-guide__place">{place.name}</h2>
              <p>{place.text}</p>
              {here.length ? (
                <>
                  <h3 className="wf-guide__sub">Quem aparece por aqui</h3>
                  <ul className="wf-guide__who">
                    {here.map((s) => (
                      <li key={s.person.id}>
                        <button type="button" onClick={() => pickPerson(s.person.id)}>
                          {s.person.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          ) : focused ? (
            <>
              <p className="wf-guide__kicker">{era}</p>
              <h2 className="wf-guide__place">{focused.person.name}</h2>
              <p>{focused.text}</p>
              <p className="wf-guide__hint">
                {highlighted.size
                  ? 'Os lugares ligados a essa pessoa estão acesos no mapa.'
                  : 'Nenhum lugar do mapa ligado a essa pessoa por enquanto.'}
              </p>
            </>
          ) : (
            <>
              <h2 className="wf-guide__place">Bem-vindo a Winden</h2>
              <p>
                Uma cidadezinha alemã cercada por floresta, com uma usina nuclear e um sistema de
                cavernas. Toque num lugar do mapa ou numa pessoa abaixo.
              </p>
            </>
          )}
          <h3 className="wf-guide__sub">Lugares</h3>
          <ul className="wf-guide__places">
            {places.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={p.id === selected}
                  className={highlighted.has(p.id) ? 'is-lit' : undefined}
                  onClick={() => pickPlace(p.id)}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <section className="wf-guide__families" aria-labelledby="guia-familias">
        <h2 id="guia-familias" className="wf-guide__title">
          As famílias em {era}
        </h2>
        <div className="wf-guide__grid">
          {FAMILIES.map((f) => {
            const members = people.filter((s) => s.person.family === f.id);
            if (!members.length) return null;
            return (
              <section key={f.id} className={`wf-family wf-family--${f.id}`} aria-label={f.label}>
                <h3 className="wf-family__name">{f.label}</h3>
                <ul className="wf-family__list">
                  {members.map((s) => (
                    <li key={s.person.id} id={`pessoa-${s.person.id}`}>
                      <button
                        type="button"
                        className={focus === s.person.id ? 'wf-person is-on' : 'wf-person'}
                        aria-pressed={focus === s.person.id}
                        onClick={() => pickPerson(s.person.id)}
                      >
                        <span className="wf-person__name">{s.person.name}</span>
                        <span className="wf-person__text">{s.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}
