/**
 * "Carregamento em quadros" (2026-11-14): while something loads, a strip of film frames with
 * sprocket holes and a soft projector flicker, instead of grey bars. `page` is the route-level
 * placeholder (a title card, a strip of poster frames and a few caption lines); `inline` is a small
 * strip beside a visible label, for a panel that is fetching. A polite live region says what is
 * loading; the frames themselves are decorative. Reduced motion: still frames.
 */
export function FilmLoader({
  label = 'Carregando…',
  size = 'inline',
  frames = size === 'page' ? 6 : 3,
}: {
  label?: string;
  size?: 'page' | 'inline';
  frames?: number;
}) {
  const strip = (
    <span className="wf-reel__strip" aria-hidden="true">
      {Array.from({ length: frames }, (_, i) => (
        <span key={i} className="wf-reel__frame" />
      ))}
    </span>
  );
  if (size === 'inline') {
    return (
      <span className="wf-reel wf-reel--inline" role="status">
        {strip}
        <span className="wf-reel__label">{label}</span>
      </span>
    );
  }
  return (
    <div className="wf-reel wf-reel--page" role="status">
      <span className="sr-only">{label}</span>
      <span className="wf-reel__title" aria-hidden="true" />
      {strip}
      <span className="wf-reel__lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
