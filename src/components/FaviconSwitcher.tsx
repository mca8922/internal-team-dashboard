'use client';

// Keeps the browser-tab favicon in sync with the theme on every page.
//
// First paint + manual theme changes are already handled (NO_FLASH_SCRIPT
// and applyTheme). This component covers the remaining case: the user is in
// "device" mode and flips their OS light/dark setting while the app is open.
import * as React from 'react';
import { getThemePref, resolveTheme, syncFavicon } from '@/lib/theme';

export function FaviconSwitcher() {
  React.useEffect(() => {
    // Make sure the icon matches on mount (covers SPA navigations too).
    syncFavicon(resolveTheme(getThemePref()));

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (getThemePref() === 'device') {
        syncFavicon(mq.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return null;
}
