'use client';
import { useId, useState } from 'react';
import { niceTicks } from '@/lib/analytics';

/**
 * Admin › Análise charts (2026-11-04). Pure SVG with presentation attributes and classes only
 * (the CSP has no 'unsafe-inline'): the hover/focus tooltip is drawn inside the SVG. Single
 * series → no legend; the card title names it. Values stay reachable without hovering: the
 * column chart has a table view, the ranked bars print their value at the tip.
 */
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function axisReais(v: number): string {
  if (v >= 10_000) return `R$ ${BRL0.format(v / 1000)} mil`;
  return `R$ ${BRL0.format(v)}`;
}

/** a column with a 4px rounded top and a square base, growing from the baseline */
function columnPath(x: number, w: number, base: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  const top = base - h;
  return `M${x} ${base} V${top + r} Q${x} ${top} ${x + r} ${top} H${x + w - r} Q${x + w} ${top} ${x + w} ${top + r} V${base} Z`;
}

export function RevenueChart({
  series,
  caption,
}: {
  series: { label: string; cents: number; orders: number }[];
  caption: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 260;
  const m = { l: 64, r: 12, t: 18, b: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = Math.max(1, series.length);
  const maxReais = Math.max(0, ...series.map((s) => s.cents / 100));
  const ticks = niceTicks(maxReais);
  const top = ticks.at(-1) || 1;
  const band = pw / n;
  const bw = Math.min(24, Math.max(2, band * 0.62));
  const every = Math.ceil(n / 10);
  const base = m.t + ph;
  const y = (reais: number) => base - (reais / top) * ph;

  const tip = hover === null ? null : series[hover]!;
  const tipLines = tip
    ? [
        tip.label,
        `${brl.format(tip.cents / 100)} · ${tip.orders} ${tip.orders === 1 ? 'pedido' : 'pedidos'}`,
      ]
    : [];
  const tipW = Math.max(...tipLines.map((l) => l.length * 6.6), 60) + 16;
  const TIP_H = 44;
  // above the column when there is room; otherwise beside it (left, or right near the left edge)
  const centre = hover === null ? 0 : m.l + band * hover + band / 2;
  const barTop = tip ? y(tip.cents / 100) : 0;
  const above = barTop - TIP_H - 8 >= m.t;
  const tipX =
    hover === null
      ? 0
      : above
        ? Math.min(W - m.r - tipW, Math.max(m.l, centre - tipW / 2))
        : centre - bw / 2 - tipW - 8 >= m.l
          ? centre - bw / 2 - tipW - 8
          : Math.min(W - m.r - tipW, centre + bw / 2 + 8);
  const tipY = above ? barTop - TIP_H - 8 : m.t + 4;

  return (
    <figure className="wf-viz">
      <svg
        className="wf-viz__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={caption}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="wf-viz__grid" x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
            <text
              className="wf-viz__tick"
              x={m.l - 8}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="central"
            >
              {axisReais(t)}
            </text>
          </g>
        ))}
        {series.map((s, i) => {
          const h = (s.cents / 100 / top) * ph;
          const x = m.l + band * i + (band - bw) / 2;
          return (
            <g key={`${s.label}-${i}`}>
              <path
                className={hover === i ? 'wf-viz__bar is-hover' : 'wf-viz__bar'}
                d={columnPath(x, bw, base, h)}
              />
              {i % every === 0 ? (
                <text className="wf-viz__tick" x={x + bw / 2} y={H - 10} textAnchor="middle">
                  {s.label}
                </text>
              ) : null}
              <rect
                className="wf-viz__hit"
                x={m.l + band * i}
                y={m.t}
                width={band}
                height={ph}
                fill="transparent"
                role="img"
                tabIndex={0}
                aria-label={`${s.label}: ${brl.format(s.cents / 100)}, ${s.orders} ${s.orders === 1 ? 'pedido' : 'pedidos'}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
        <line className="wf-viz__axis" x1={m.l} x2={W - m.r} y1={base} y2={base} />
        {tip ? (
          <g
            className="wf-viz__tooltip"
            transform={`translate(${tipX} ${tipY})`}
            aria-hidden="true"
          >
            <rect width={tipW} height={TIP_H} rx={8} />
            <text x={8} y={17} className="wf-viz__tooltip-label">
              {tipLines[0]}
            </text>
            <text x={8} y={35} className="wf-viz__tooltip-value">
              {tipLines[1]}
            </text>
          </g>
        ) : null}
      </svg>
      <details className="wf-viz__table">
        <summary>Ver tabela</summary>
        <table aria-describedby={`${id}-cap`}>
          <caption id={`${id}-cap`} className="sr-only">
            {caption}
          </caption>
          <thead>
            <tr>
              <th scope="col">Período</th>
              <th scope="col">Receita</th>
              <th scope="col">Pedidos</th>
            </tr>
          </thead>
          <tbody>
            {series.map((s, i) => (
              <tr key={`${s.label}-${i}`}>
                <th scope="row">{s.label}</th>
                <td>{brl.format(s.cents / 100)}</td>
                <td>{s.orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Ranked horizontal bars, largest first, one hue; the value sits at each bar's tip. */
export function RankedBars({
  rows,
  caption,
}: {
  /** `text` is the value as shown at the bar tip (formatted by the caller) */
  rows: { label: string; value: number; text: string }[];
  caption: string;
}) {
  if (!rows.length) return <p className="wf-muted text-sm">Nada neste período.</p>;
  const W = 720;
  const rowH = 34;
  const labelW = 230;
  const valueW = 150;
  const barMax = W - labelW - valueW;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const H = rows.length * rowH + 4;
  const clip = (s: string) => (s.length > 30 ? `${s.slice(0, 29)}…` : s);
  return (
    <figure className="wf-viz">
      <svg className="wf-viz__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        {rows.map((r, i) => {
          const w = Math.max(2, (r.value / max) * barMax);
          const yy = i * rowH + 6;
          const h = 18;
          // square at the baseline (left), 4px rounded data-end (right)
          const d = `M${labelW} ${yy} H${labelW + w - 4} Q${labelW + w} ${yy} ${labelW + w} ${yy + 4} V${yy + h - 4} Q${labelW + w} ${yy + h} ${labelW + w - 4} ${yy + h} H${labelW} Z`;
          return (
            <g key={`${r.label}-${i}`}>
              <title>{`${r.label}: ${r.text}`}</title>
              <text
                className="wf-viz__label"
                x={labelW - 10}
                y={yy + h / 2}
                textAnchor="end"
                dominantBaseline="central"
              >
                {clip(r.label)}
              </text>
              <path className="wf-viz__bar" d={d} />
              <text
                className="wf-viz__value"
                x={labelW + w + 8}
                y={yy + h / 2}
                dominantBaseline="central"
              >
                {r.text}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
