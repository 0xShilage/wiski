import type { ReactNode } from 'react';
import { Mascote } from './Mascote';

/**
 * The squirrel error pages (2026-11-10): 404, the error boundary and the last-resort one share
 * this — the mascot bobbing over a spotlight, a big neon code behind it, a line of copy and the
 * way out. Decorative art; the heading carries the message.
 */
export function Oops({
  code,
  pose,
  title,
  children,
  actions,
}: {
  code: string;
  pose: 1 | 2 | 3 | 4;
  title: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="wf-oops">
      <div className="wf-oops__art" aria-hidden="true">
        <span className="wf-oops__code">{code}</span>
        <span className="wf-oops__squirrel">
          <Mascote pose={pose} colour="lavender" />
        </span>
        <span className="wf-oops__spot" />
      </div>
      <h1 className="wf-oops__title">{title}</h1>
      <p className="wf-oops__lead">{children}</p>
      <div className="wf-oops__actions">{actions}</div>
    </div>
  );
}
