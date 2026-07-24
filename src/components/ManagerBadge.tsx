// The "Department Manager" badge — a cool, aesthetic marker shown on the
// dashboard (and a compact variant in the sidebar) when the signed-in member
// heads a department. Tinted with the department's accent colour when known.
import * as React from 'react';
import { Icon } from './Icon';

export function ManagerBadge({
  department,
  accent,
  variant = 'full',
}: {
  department: string;
  accent?: string | null;
  variant?: 'full' | 'compact';
}) {
  const style = accent ? ({ '--dept': accent } as React.CSSProperties) : undefined;

  if (variant === 'compact') {
    return (
      <span className="mgr-badge mgr-badge-compact" style={style} title={`Head of ${department}`}>
        <Icon name="crown" size={12} />
        <span>Head of {department}</span>
      </span>
    );
  }

  return (
    <div className="mgr-badge mgr-badge-full" style={style}>
      <span className="mgr-badge-glow" aria-hidden />
      <span className="mgr-badge-crown">
        <Icon name="crown" size={18} />
      </span>
      <span className="mgr-badge-text">
        <span className="mgr-badge-kicker">Department Manager</span>
        <span className="mgr-badge-dept">Head of {department}</span>
      </span>
      <span className="mgr-badge-shine" aria-hidden />
    </div>
  );
}
