'use client';

// Lets a page name its own URL segment in the top bar's breadcrumb.
//
// The top bar builds the breadcrumb from the pathname, which is fine for
// fixed sections ("Team / Requests") but printed a raw id for a record page:
// "Team / 85e2c7ac-9cea-4678-aae7-2aaeebe9ee84". Only the page knows whose
// record that is, so it renders <CrumbLabel segment={id} label={name} /> and
// the Shell, which owns the top bar, picks it up through this context.
//
// A segment that looks like an id but has no label yet renders as a blank
// placeholder rather than the id itself, so the id never flashes on screen
// while the page mounts.
import * as React from 'react';

export interface CrumbInfo {
  label: string;
  // Secondary text beside the label, e.g. a person's job title.
  detail?: string;
}

type Registry = {
  labels: Record<string, CrumbInfo>;
  set: (segment: string, info: CrumbInfo | null) => void;
};

const CrumbCtx = React.createContext<Registry>({ labels: {}, set: () => {} });

export function CrumbLabelProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = React.useState<Record<string, CrumbInfo>>({});
  const set = React.useCallback((segment: string, info: CrumbInfo | null) => {
    setLabels((prev) => {
      const cur = prev[segment];
      if (info && cur && cur.label === info.label && cur.detail === info.detail) return prev;
      if (!info && !cur) return prev;
      const next = { ...prev };
      if (info) next[segment] = info;
      else delete next[segment];
      return next;
    });
  }, []);
  const value = React.useMemo(() => ({ labels, set }), [labels, set]);
  return <CrumbCtx.Provider value={value}>{children}</CrumbCtx.Provider>;
}

export function useCrumbLabels(): Record<string, CrumbInfo> {
  return React.useContext(CrumbCtx).labels;
}

// UUIDs and similar opaque ids: long, and made of hex digits and dashes.
export function looksLikeId(segment: string): boolean {
  return /^[0-9a-f-]{16,}$/i.test(segment);
}

// Layout effect in the browser, so the name is in place before the browser
// paints after a client-side navigation; plain effect on the server, where
// React 18 warns about layout effects.
const useIsoLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export function CrumbLabel({ segment, label, detail }: { segment: string } & CrumbInfo) {
  const { set } = React.useContext(CrumbCtx);
  useIsoLayoutEffect(() => {
    set(segment, { label, detail });
    return () => set(segment, null);
  }, [segment, label, detail, set]);
  return null;
}
