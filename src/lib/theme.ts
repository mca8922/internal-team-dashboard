// Theme handling. The user picks one of three *preferences*; the *resolved*
// theme (what actually drives the CSS) is always 'light' or 'dark'.
//
//   light   -> always light
//   dark    -> always dark
//   device  -> follows the OS via prefers-color-scheme, live
//
// The preference is stored in localStorage; the resolved value is written to
// <html data-theme="...">.

export type ThemePref = 'light' | 'dark' | 'device';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'restruc:theme';

export function getThemePref(): ThemePref {
  if (typeof window === 'undefined') return 'light';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'dark' || v === 'device' ? v : v === 'light' ? 'light' : 'device';
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'device') {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return pref;
}

// Favicon files in /public — light variant has a white background, dark
// variant a black background, so the mark always reads on the browser tab.
const FAVICON_LIGHT = '/logo-light.png';
const FAVICON_DARK = '/logo-dark.png';

// Point the <link rel="icon"> at the variant matching the resolved theme.
export function syncFavicon(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const href = resolved === 'dark' ? FAVICON_DARK : FAVICON_LIGHT;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/png';
  link.href = href;
}

export function applyTheme(pref: ThemePref): ResolvedTheme {
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  syncFavicon(resolved);
  return resolved;
}

// Every control bound to the preference — the topbar cycle button, the
// Appearance picker in Settings — has to move together. The colors always did
// (they hang off one <html data-theme>), but each control used to keep its own
// copy of the *preference*, so changing the theme in one place left the other
// showing the old choice until it remounted. setThemePref() now announces the
// change and useThemePref() (src/lib/useThemePref.ts) subscribes, so there is
// one source of truth: localStorage.
const CHANGE_EVENT = 'restruc:theme-changed';

// Calls `onChange` whenever the preference moves, in this tab or another one.
// Returns its own unsubscribe, matching what useSyncExternalStore expects.
export function subscribeThemePref(onChange: () => void): () => void {
  // A change from ANOTHER tab has not touched this document, so re-apply the
  // resolved theme here before reporting it. `key` is null when a tab calls
  // localStorage.clear(), which drops our key too — treat that as a change.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    applyTheme(getThemePref());
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function setThemePref(pref: ThemePref): ResolvedTheme {
  window.localStorage.setItem(STORAGE_KEY, pref);
  const resolved = applyTheme(pref);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return resolved;
}

// Inline script injected into <head> so the correct theme AND favicon are
// applied before first paint — avoids a flash of the wrong theme/icon.
export const NO_FLASH_SCRIPT = `
(function(){
  try {
    var p = localStorage.getItem('restruc:theme') || 'device';
    var dark = p === 'dark' || (p === 'device' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = 'image/png';
    link.href = dark ? '/logo-dark.png' : '/logo-light.png';
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;
