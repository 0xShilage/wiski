import type { PublicCampaign } from '@/lib/catalog/types';
import { SEAT_AISLE_AFTER, SEAT_COLS, SEAT_ROWS, seatMap } from '@/lib/seat-map';
import { viewerSeatKey } from '@/server/campaigns/seat';

const SEAT_W = 20;
const SEAT_H = 18;
const GAP = 6;
const AISLE = 16;
const PAD = 8;
const TOP = 42;
const ROW_PITCH = 26;
const WIDTH = PAD * 2 + SEAT_COLS * SEAT_W + (SEAT_COLS - 1) * GAP + AISLE;
const HEIGHT = TOP + (SEAT_ROWS - 1) * ROW_PITCH + SEAT_H + 4;
const seatX = (col: number) => PAD + col * (SEAT_W + GAP) + (col >= SEAT_AISLE_AFTER ? AISLE : 0);
const seatY = (row: number) => TOP + row * ROW_PITCH;

/**
 * "A sala" (2026-11-11): the campaign as a little cinema — the goal is a full house, the money
 * raised fills the seats (best seats first), pending Pix shows as "reservado", and a viewer who
 * contributed sees one gold "seu lugar". The picture is decorative for screen readers: the SVG's
 * label and the caption say the same in words. No names on any seat.
 */
export async function SeatMap({ campaign }: { campaign: PublicCampaign }) {
  const map = seatMap(campaign, await viewerSeatKey(campaign.id));
  const mine = map.seats.some((s) => s.mine);
  const label =
    `Sala de cinema da campanha: ${map.percent}% da meta, ${map.taken} de ${map.total} lugares ` +
    `ocupados${map.held ? `, ${map.held} reservados` : ''}${mine ? ', um deles é o seu' : ''}.`;
  return (
    <figure className="wf-seatmap">
      <svg
        className="wf-seatmap__room"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        focusable="false"
      >
        <defs>
          <linearGradient id="wf-seatmap-screen" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#a99de0" stopOpacity="0.15" />
            <stop offset="0.5" stopColor="#f7f2fb" stopOpacity="0.95" />
            <stop offset="1" stopColor="#a99de0" stopOpacity="0.15" />
          </linearGradient>
          <symbol id="wf-seat-shape" viewBox={`0 0 ${SEAT_W} ${SEAT_H}`}>
            <path d="M3 1h14a2 2 0 0 1 2 2v8H1V3a2 2 0 0 1 2-2z" opacity="0.8" />
            <path d="M0 11h20v4a3 3 0 0 1-3 3H3a3 3 0 0 1-3-3z" />
          </symbol>
        </defs>
        <path
          className="wf-seatmap__beam"
          d={`M${PAD + 14} 24 Q${WIDTH / 2} 6 ${WIDTH - PAD - 14} 24`}
          fill="none"
          stroke="url(#wf-seatmap-screen)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d={`M${PAD + 14} 24 Q${WIDTH / 2} 6 ${WIDTH - PAD - 14} 24`}
          fill="none"
          stroke="url(#wf-seatmap-screen)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <text className="wf-seatmap__screen" x={WIDTH / 2} y="33" textAnchor="middle">
          TELA
        </text>
        {map.seats.map((s) => (
          <use
            key={`${s.row}:${s.col}`}
            href="#wf-seat-shape"
            x={seatX(s.col)}
            y={seatY(s.row)}
            width={SEAT_W}
            height={SEAT_H}
            className={`wf-seat wf-seat--${s.state}${s.mine ? ' wf-seat--mine' : ''}${
              s.state === 'free' ? '' : ` wf-seat--w${s.wave}`
            }`}
          />
        ))}
      </svg>
      <figcaption className="wf-seatmap__caption">
        <span className="wf-seatmap__pct">
          Sala <strong>{map.percent}%</strong> cheia
        </span>
        <span className="wf-seatmap__legend" aria-hidden="true">
          <span className="wf-seatmap__key wf-seatmap__key--taken">ocupado</span>
          {map.held ? (
            <span className="wf-seatmap__key wf-seatmap__key--held">reservado</span>
          ) : null}
          {mine ? <span className="wf-seatmap__key wf-seatmap__key--mine">seu lugar</span> : null}
          <span className="wf-seatmap__key wf-seatmap__key--free">livre</span>
        </span>
      </figcaption>
    </figure>
  );
}
