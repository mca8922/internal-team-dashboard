// The Dashboard's "Log streak" card — kept deliberately simple: a fire emoji
// and the current count, no milestone ring or tier system.
export function StreakCard({ streak }: { streak: number }) {
  return (
    <div className="card">
      <div className="card-subtitle mb-3">Log streak</div>
      <div className="flex items-center gap-3">
        <span style={{ fontSize: 32 }} aria-hidden>
          🔥
        </span>
        <div>
          <div className="text-3xl fw-bold">{streak}</div>
          <div className="text-xs text-grey">
            {streak === 0
              ? 'Log today to start a streak'
              : streak === 1
                ? 'day. Keep it going.'
                : 'working days'}
          </div>
        </div>
      </div>
    </div>
  );
}
