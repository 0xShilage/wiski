import { avatarSrc, resolveAvatarKey } from '@/lib/avatars';
import type { PublicCampaign } from '@/lib/catalog/types';
import type { Picture } from '@/lib/media';
import { SEAT_AISLE_AFTER, SEAT_COLS, SEAT_ROWS, seatMap } from '@/lib/seat-map';
import { viewerSeat } from '@/server/campaigns/seat';

/* The room, seen from the back row: a curved screen with the title's art at the top, rows that
   widen and curve toward you, the projector's beam over everyone's heads. */
const W = 360;
const MID = W / 2;
const SCREEN = { left: 54, right: 306, top: 20, bottom: 98, bow: 12 };
const SEAT_W = 22;
const SEAT_H = 20;
const PITCH = 27;
const AISLE = 16;
const FRONT_Y = 132;
/** a row's size: the front row (by the screen) is the smallest, the back row the largest */
const scaleOf = (row: number) => 0.64 + 0.085 * row;
const rowY = (row: number) => {
  let y = FRONT_Y;
  for (let r = 0; r < row; r++) y += 25 * scaleOf(r) + 3;
  return y;
};
const H = Math.ceil(rowY(SEAT_ROWS - 1) + SEAT_H * scaleOf(SEAT_ROWS - 1) + 10);

function place(row: number, col: number) {
  const s = scaleOf(row);
  const half = (SEAT_COLS - 1) / 2;
  const off = (col - half) * PITCH + (col >= SEAT_AISLE_AFTER ? AISLE / 2 : -AISLE / 2);
  const t = (col - half) / half;
  const w = SEAT_W * s;
  const h = SEAT_H * s;
  return {
    x: MID + off * s - w / 2,
    // the rows curve around the screen: the ends sit a little closer to it
    y: rowY(row) - 9 * s * t * t,
    w,
    h,
  };
}

const screenPath =
  `M${SCREEN.left} ${SCREEN.top} Q${MID} ${SCREEN.top - SCREEN.bow} ${SCREEN.right} ${SCREEN.top} ` +
  `L${SCREEN.right} ${SCREEN.bottom} Q${MID} ${SCREEN.bottom - SCREEN.bow} ${SCREEN.left} ${SCREEN.bottom} Z`;

/**
 * "A sala" (2026-11-11, as a theater 2026-11-13): the campaign as a cinema seen from the back — the
 * title's art on a curved screen, the goal a full house. The money raised fills the seats with
 * people (best seats first), pending Pix shows as "reservado", and a viewer who contributed sees
 * their own avatar on their seat under a spotlight. Decorative for screen readers: the SVG's label
 * and the caption say the same in words. No names on any seat.
 */
export async function SeatMap({
  campaign,
  art,
}: {
  campaign: PublicCampaign;
  art?: Picture | null;
}) {
  const me = await viewerSeat(campaign.id);
  const map = seatMap(campaign, me?.key ?? null);
  const mineSeat = map.seats.find((s) => s.mine);
  const label =
    `Sala de cinema da campanha: ${map.percent}% da meta, ${map.taken} de ${map.total} lugares ` +
    `ocupados${map.held ? `, ${map.held} reservados` : ''}${mineSeat ? ', um deles é o seu' : ''}.`;
  // back rows first, so a nearer row's people overlap the row in front, as in a real room
  const seats = [...map.seats].sort((a, b) => a.row - b.row || a.col - b.col);
  const minePos = mineSeat ? place(mineSeat.row, mineSeat.col) : null;
  return (
    <figure className="wf-seatmap wf-seatmap--theater">
      <svg
        className="wf-seatmap__room"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        focusable="false"
      >
        <defs>
          <clipPath id="wf-seatmap-screen-shape">
            <path d={screenPath} />
          </clipPath>
          <clipPath id="wf-seatmap-me" clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
          <linearGradient id="wf-seatmap-beam" x1="0" x2="0" y1="1" y2="0">
            <stop offset="0" stopColor="#f7f2fb" stopOpacity="0.16" />
            <stop offset="1" stopColor="#a99de0" stopOpacity="0.02" />
          </linearGradient>
          <radialGradient id="wf-seatmap-spill" cx="0.5" cy="0" r="0.8">
            <stop offset="0" stopColor="#a99de0" stopOpacity="0.35" />
            <stop offset="1" stopColor="#a99de0" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="wf-seatmap-spot" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#f2c46d" stopOpacity="0.55" />
            <stop offset="1" stopColor="#f2c46d" stopOpacity="0" />
          </radialGradient>
          {/* a seat seen from behind; with a person, a head and shoulders over the backrest. The
              backrest takes the <use>'s fill, the person its color (classes can't reach inside). */}
          <symbol id="wf-seat-back" viewBox="0 0 22 20">
            <path d="M3 6h16a3 3 0 0 1 3 3v9a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V9a3 3 0 0 1 3-3z" />
          </symbol>
          <symbol id="wf-seat-person" viewBox="0 0 22 20">
            <path d="M3 6h16a3 3 0 0 1 3 3v9a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V9a3 3 0 0 1 3-3z" />
            <path fill="currentColor" d="M4 12c0-3.6 3.2-5.2 7-5.2s7 1.6 7 5.2v1H4z" />
            <circle fill="currentColor" cx="11" cy="3.6" r="3.6" />
          </symbol>
        </defs>

        {/* the screen: the title's art on a curved canvas, light spilling below */}
        <ellipse cx={MID} cy={SCREEN.bottom + 6} rx="170" ry="46" fill="url(#wf-seatmap-spill)" />
        <path className="wf-seatmap__canvas" d={screenPath} />
        {art ? (
          <image
            className="wf-seatmap__art"
            href={art.fallback}
            x={SCREEN.left}
            y={SCREEN.top - SCREEN.bow}
            width={SCREEN.right - SCREEN.left}
            height={SCREEN.bottom - SCREEN.top + SCREEN.bow}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#wf-seatmap-screen-shape)"
          />
        ) : null}
        <path className="wf-seatmap__frame" d={screenPath} />

        {/* the projector's beam, from behind the last row to the screen */}
        <path
          className="wf-seatmap__projector"
          d={`M${MID - 6} ${H} L${SCREEN.left + 8} ${SCREEN.bottom - 4} L${SCREEN.right - 8} ${SCREEN.bottom - 4} L${MID + 6} ${H} Z`}
          fill="url(#wf-seatmap-beam)"
        />

        {seats.map((s) => {
          const p = place(s.row, s.col);
          if (s.mine) return null;
          return (
            <use
              key={`${s.row}:${s.col}`}
              href={s.state === 'taken' ? '#wf-seat-person' : '#wf-seat-back'}
              x={p.x}
              y={p.y - (s.state === 'taken' ? 4 * scaleOf(s.row) : 0)}
              width={p.w}
              height={p.h + (s.state === 'taken' ? 4 * scaleOf(s.row) : 0)}
              className={`wf-seat wf-seat--${s.state}${s.state === 'free' ? '' : ` wf-seat--w${s.wave}`}`}
            />
          );
        })}

        {minePos && me ? (
          <g className="wf-seat wf-seat--mine">
            <ellipse
              cx={minePos.x + minePos.w / 2}
              cy={minePos.y + minePos.h / 2}
              rx={minePos.w * 1.6}
              ry={minePos.h * 1.3}
              fill="url(#wf-seatmap-spot)"
            />
            <use
              href="#wf-seat-back"
              x={minePos.x}
              y={minePos.y}
              width={minePos.w}
              height={minePos.h}
              className="wf-seat__mine-back"
            />
            <image
              href={avatarSrc(resolveAvatarKey(me.avatarKey), 64)}
              x={minePos.x + minePos.w / 2 - minePos.w * 0.62}
              y={minePos.y - minePos.w * 0.82}
              width={minePos.w * 1.24}
              height={minePos.w * 1.24}
              clipPath="url(#wf-seatmap-me)"
            />
            <circle
              className="wf-seat__ring"
              cx={minePos.x + minePos.w / 2}
              cy={minePos.y - minePos.w * 0.2}
              r={minePos.w * 0.64}
            />
          </g>
        ) : null}
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
          {mineSeat ? (
            <span className="wf-seatmap__key wf-seatmap__key--mine">seu lugar</span>
          ) : null}
          <span className="wf-seatmap__key wf-seatmap__key--free">livre</span>
        </span>
      </figcaption>
    </figure>
  );
}
