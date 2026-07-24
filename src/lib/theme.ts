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

export function setThemePref(pref: ThemePref): ResolvedTheme {
  window.localStorage.setItem(STORAGE_KEY, pref);
  return applyTheme(pref);
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
