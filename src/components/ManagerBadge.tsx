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
    <RoleBadge
      icon="crown"
      kicker="Department Manager"
      label={`Head of ${department}`}
      accent={accent}
    />
  );
}

// The shared two-line glossy badge beside the dashboard greeting. Each tier
// has its own icon and accent: Director (brand gold, star), Department
// Manager (department colour, crown), Executive (department colour, shield).
export function RoleBadge({
  icon,
  kicker,
  label,
  accent,
}: {
  icon: 'crown' | 'star-filled' | 'shield';
  kicker: string;
  label: string;
  accent?: string | null;
}) {
  const style = accent ? ({ '--dept': accent } as React.CSSProperties) : undefined;
  return (
    <div className="mgr-badge mgr-badge-full" style={style}>
      <span className="mgr-badge-glow" aria-hidden />
      <span className="mgr-badge-crown">
        <Icon name={icon} size={18} />
      </span>
      <span className="mgr-badge-text">
        <span className="mgr-badge-kicker">{kicker}</span>
        <span className="mgr-badge-dept">{label}</span>
      </span>
      <span className="mgr-badge-shine" aria-hidden />
    </div>
  );
}

// Picks the right greeting badge for a profile: Director for the Board, the
// Manager badge for a department head, Executive for everyone else.
export function GreetingRoleBadge({
  isBoard,
  managedDepartment,
  department,
  accent,
}: {
  isBoard: boolean;
  managedDepartment: string | null;
  department: string;
  accent?: string | null;
}) {
  if (isBoard) {
    return (
      <RoleBadge
        icon="star-filled"
        kicker="Board Member"
        label="Director"
        accent="var(--color-gold-primary)"
      />
    );
  }
  if (managedDepartment) {
    return <ManagerBadge department={managedDepartment} accent={accent} />;
  }
  return (
    <RoleBadge icon="shield" kicker="Executive" label={`${department} team`} accent={accent} />
  );
}
