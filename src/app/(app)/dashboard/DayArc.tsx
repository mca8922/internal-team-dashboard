// Dashboard greeting's "day arc": a sun (or, after dark, a moon) sitting on
// a horizon arc at the current IST time. Day runs 6 AM to 6 PM, night runs
// 6 PM to 6 AM. Rendered on the server; the dashboard is dynamic, so every
// load shows the real time. On load the body rises along the arc to its spot.

export type DayPhase = 'morning' | 'afternoon' | 'evening' | 'night';

const DAY_START = 6 * 60; // 06:00
const DAY_END = 18 * 60; // 18:00
const SPAN = DAY_END - DAY_START; // 12h, same length for day and night

function fmtLeft(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function DayArc({ minutes }: { minutes: number }) {
  const isDay = minutes >= DAY_START && minutes < DAY_END;
  // Minutes elapsed in the current half (day or night), 0 to SPAN.
  const elapsed = isDay
    ? minutes - DAY_START
    : (minutes - DAY_END + 24 * 60) % (24 * 60);
  const t = Math.min(1, Math.max(0, elapsed / SPAN));
  const left = SPAN - Math.round(t * SPAN);
  const caption = isDay
    ? `${fmtLeft(left)} of daylight left`
    : `Sunrise in ${fmtLeft(left)}`;

  return (
    <div className={`day-arc ${isDay ? 'is-day' : 'is-night'}`}>
      <svg
        viewBox="0 0 200 108"
        role="img"
        aria-label={caption}
        className="day-arc__svg"
      >
        <defs>
          <mask id="dayArcMoonCut">
            <rect x="-20" y="-20" width="40" height="40" fill="#fff" />
            <circle cx="5" cy="-4" r="7" fill="#000" />
          </mask>
        </defs>

        {!isDay ? (
          <g className="day-arc__stars" aria-hidden="true">
            <circle cx="44" cy="30" r="1.2" />
            <circle cx="150" cy="22" r="1" style={{ animationDelay: '0.8s' }} />
            <circle cx="172" cy="58" r="1.3" style={{ animationDelay: '1.6s' }} />
            <circle cx="70" cy="12" r="0.9" style={{ animationDelay: '2.2s' }} />
            <circle cx="120" cy="46" r="1" style={{ animationDelay: '1.1s' }} />
          </g>
        ) : null}

        {/* Horizon */}
        <line x1="2" y1="100" x2="198" y2="100" className="day-arc__horizon" />
        {/* Full path, dashed */}
        <path
          d="M 16 100 A 84 84 0 0 1 184 100"
          pathLength={100}
          className="day-arc__track"
        />
        {/* Travelled part */}
        <path
          d="M 16 100 A 84 84 0 0 1 184 100"
          pathLength={100}
          className="day-arc__done"
          style={{ strokeDashoffset: 100 - t * 100 }}
        />

        {/* The body starts at the left horizon and is rotated about the arc's
            centre, so it travels along the arc when the rotation animates. */}
        <g
          className="day-arc__orbit"
          style={{ transform: `rotate(${(t * 180).toFixed(2)}deg)` }}
        >
          <g transform="translate(16 100)">
            {isDay ? (
              <>
                <circle r="15" className="day-arc__glow" />
                <circle r="7.5" className="day-arc__sun" />
              </>
            ) : (
              <>
                <circle r="13" className="day-arc__glow" />
                <circle r="7" className="day-arc__moon" mask="url(#dayArcMoonCut)" />
              </>
            )}
          </g>
        </g>
      </svg>
      <div className="day-arc__labels" aria-hidden="true">
        <span>{isDay ? '6 AM' : '6 PM'}</span>
        <span>{isDay ? '6 PM' : '6 AM'}</span>
      </div>
      <div className="day-arc__caption">{caption}</div>
    </div>
  );
}

export function dayPhase(hour: number): DayPhase {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}
