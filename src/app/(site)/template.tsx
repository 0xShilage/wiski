import type { ReactNode } from 'react';

/**
 * Tab transition (2026-11-09): a template (unlike a layout) mounts again on every navigation, so
 * the page under the header fades and rises in each time a tab is opened. Desktop only and off
 * with reduced motion (CSS `.wf-tab-enter`); no fill mode, so nothing stays applied afterwards
 * (no stacking context or containing block left on the page).
 */
export default function SiteTemplate({ children }: { children: ReactNode }) {
  return <div className="wf-tab-enter">{children}</div>;
}
