'use client';

// The Launchpad UI. Each department's apps render as square (1:1) tiles whose
// backdrop is the transparent image the Board framed for them, with the name
// overlaid. Tiles open the (independently deployed) tool in a new tab. The Board
// gets a "Manage apps" entry point; everyone else sees only the apps they may
// open, grouped by department.
import * as React from 'react';
import { Button } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';
import type { DepartmentApp } from '@/lib/types';
import { ManageAppsModal } from './ManageAppsModal';
import { AppAnalytics } from './AppAnalytics';
import { logAppClick } from '@/lib/actions';
import type { AppAnalyticsResult } from './app-analytics';

// Icon used when a tile has no image yet.
export function appIconName(icon: string): IconName {
  const known: IconName[] = [
    'monitor', 'bolt', 'chart', 'target', 'mail', 'calendar',
    'list', 'layers', 'star', 'sparkles', 'flag', 'building',
  ];
  return (known as string[]).includes(icon) ? (icon as IconName) : 'monitor';
}

const COMPANY_WIDE = '__company__';

// Lets us set a CSS custom property in an inline style object without TS noise.
function accentStyle(name: string, accent: string | null): React.CSSProperties | undefined {
  return accent ? ({ [name]: accent } as React.CSSProperties) : undefined;
}

function AppCard({ app, accent }: { app: DepartmentApp; accent: string | null }) {
  const handleClick = () => {
    void logAppClick(app.id);
  };
  return (
    <a
      href={app.url}
      target="_blank"
      rel="noopener noreferrer"
      className="app-tile"
      style={accentStyle('--app-accent', accent)}
      onClick={handleClick}
    >
      {app.image_url ? (
        <div className="app-tile-img">
          <img src={app.image_url} alt="" />
        </div>
      ) : (
        <div className="app-tile-fallback">
          <Icon name={appIconName(app.icon)} size={52} stroke={1.25} />
        </div>
      )}
      <div className="app-tile-tint" />
      <span className="app-tile-open" aria-hidden>
        <Icon name="arrow-right" size={15} />
      </span>
      <div className="app-tile-bar">
        <div className="app-tile-name">{app.name}</div>
      </div>
    </a>
  );
}

function Group({
  label,
  accent,
  apps,
}: {
  label: string;
  accent: string | null;
  apps: DepartmentApp[];
}) {
  return (
    <section className="launchpad-section">
      <div className="launchpad-head" style={accentStyle('--lp-accent', accent)}>
        <span className="dot" aria-hidden />
        <h2>{label}</h2>
        <span className="count">{apps.length}</span>
      </div>
      <div className="launchpad-grid">
        {apps.map((a) => (
          <AppCard key={a.id} app={a} accent={accent} />
        ))}
      </div>
    </section>
  );
}

export function AppsView({
  apps,
  isBoard,
  myDepartment,
  deptColors,
  allApps,
  departments,
  initialAnalytics,
}: {
  apps: DepartmentApp[];
  isBoard: boolean;
  myDepartment: string;
  deptColors: Record<string, string>;
  allApps: DepartmentApp[];
  departments: string[];
  initialAnalytics?: AppAnalyticsResult;
}) {
  const [manageOpen, setManageOpen] = React.useState(false);

  // Group the visible apps: company-wide first, then each department, with the
  // viewer's own department floated to the top of the department groups.
  const groups = React.useMemo(() => {
    const byDept = new Map<string, DepartmentApp[]>();
    for (const a of apps) {
      const key = a.department ?? COMPANY_WIDE;
      const list = byDept.get(key) ?? [];
      list.push(a);
      byDept.set(key, list);
    }
    const out: { key: string; label: string; accent: string | null; apps: DepartmentApp[] }[] = [];
    const company = byDept.get(COMPANY_WIDE);
    if (company) out.push({ key: COMPANY_WIDE, label: 'Company-wide', accent: null, apps: company });
    const deptKeys = [...byDept.keys()].filter((k) => k !== COMPANY_WIDE);
    deptKeys.sort((a, b) => {
      if (a === myDepartment) return -1;
      if (b === myDepartment) return 1;
      return a.localeCompare(b);
    });
    for (const k of deptKeys) {
      out.push({ key: k, label: k, accent: deptColors[k] ?? null, apps: byDept.get(k)! });
    }
    return out;
  }, [apps, deptColors, myDepartment]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Apps</h1>
          <p className="page-subtitle">Your department&rsquo;s dedicated tools, all in one place.</p>
        </div>
        {isBoard && (
          <div className="page-header-actions">
            <Button variant="secondary" icon="settings" onClick={() => setManageOpen(true)}>
              Manage apps
            </Button>
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <Icon name="monitor" size={36} stroke={1.2} />
          <h3>No apps yet</h3>
          <p>
            {isBoard
              ? 'Register your teams’ tools so everyone can find them here.'
              : 'Your department’s tools will appear here once the Board adds them.'}
          </p>
          {isBoard && (
            <div style={{ marginTop: 16 }}>
              <Button icon="plus" onClick={() => setManageOpen(true)}>Add an app</Button>
            </div>
          )}
        </div>
      ) : (
        groups.map((g) => <Group key={g.key} label={g.label} accent={g.accent} apps={g.apps} />)
      )}

      {isBoard && (
        <ManageAppsModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          apps={allApps}
          departments={departments}
          deptColors={deptColors}
        />
      )}

      {isBoard && initialAnalytics && (
        <AppAnalytics initial={initialAnalytics} deptColors={deptColors} />
      )}
    </>
  );
}
