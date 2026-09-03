'use client';

// The Board's flat, department-grouped results list — shown in place of the
// cascade whenever a search / department / status / due filter is active.
// Extracted verbatim from GoalsView. No behaviour change.
import { EmptyState } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { STATUS, deriveGoalStatus } from './goal-ui';
import { GoalCard } from './GoalCard';
import type { CardCtx } from './card-context';
import type { Goal } from '@/lib/types';

// ── Board management results: matching goals grouped by department ──────────
export function BoardGoalsResults({
  groups,
  total,
  ctx,
  onClear,
}: {
  groups: [string, Goal[]][];
  total: number;
  ctx: CardCtx;
  onClear: () => void;
}) {
  if (total === 0) {
    return (
      <EmptyState
        icon="search"
        title="No tasks match"
        hint="Try a different search, department or status, or clear the filters."
      />
    );
  }
  return (
    <div className="gb-results">
      <div className="gb-results-head">
        <span className="gb-results-count">
          {total} task{total !== 1 ? 's' : ''} · {groups.length} department
          {groups.length !== 1 ? 's' : ''}
        </span>
        <button type="button" className="gb-results-clear" onClick={onClear}>
          Clear filters
        </button>
      </div>
      {groups.map(([dept, gs]) => {
        // Counted on the DERIVED status (deriveGoalStatus), the same one the
        // cards below show — a stored "Completed" that the checklist doesn't
        // back up must not inflate this tally.
        const st = gs.map(deriveGoalStatus);
        const active = st.filter((s) => s === 'active').length;
        const achieved = st.filter((s) => s === 'achieved').length;
        const inactive = st.filter((s) => s === 'inactive').length;
        const notMet = st.filter((s) => s === 'not_met').length;
        return (
          <div key={dept} className="gb-dept-group">
            <div className="gb-dept-head">
              <span className="gb-dept-name">
                <Icon name="building" size={15} />
                {dept}
                <span className="gb-dept-count">{gs.length}</span>
              </span>
              <span className="gb-dept-tally">
                {active > 0 ? (
                  <span className={`badge ${STATUS.active.cls}`}>{active} {STATUS.active.label}</span>
                ) : null}
                {achieved > 0 ? (
                  <span className={`badge ${STATUS.achieved.cls}`}>
                    {achieved} {STATUS.achieved.label}
                  </span>
                ) : null}
                {notMet > 0 ? (
                  <span className={`badge ${STATUS.not_met.cls}`}>
                    {notMet} {STATUS.not_met.label}
                  </span>
                ) : null}
                {inactive > 0 ? (
                  <span className={`badge ${STATUS.inactive.cls}`}>
                    {inactive} {STATUS.inactive.label}
                  </span>
                ) : null}
              </span>
            </div>
            <div className="grid gap-3">
              {gs.map((g) => (
                <GoalCard key={g.id} goal={g} ctx={ctx} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
