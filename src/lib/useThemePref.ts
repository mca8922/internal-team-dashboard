'use client';

// The one way a component should read the theme preference.
//
// Kept out of theme.ts so that file stays React-free — src/app/layout.tsx is a
// server component and imports NO_FLASH_SCRIPT from it.
import * as React from 'react';
import { getThemePref, subscribeThemePref, type ThemePref } from './theme';

// localStorage is the store; this just subscribes React to it. Any component
// calling this re-renders when the preference changes anywhere — including
// from another control on the same screen, or another open tab.
export function useThemePref(): ThemePref {
  return React.useSyncExternalStore(
    subscribeThemePref,
    getThemePref,
    // Server render and hydration both report 'device'. localStorage does not
    // exist on the server, and reading it during hydration would risk a
    // mismatch with the HTML that was sent; React re-reads the real value
    // immediately after. NO_FLASH_SCRIPT has already painted the right theme
    // by then, so nothing flashes — only the control's own highlight settles.
    () => 'device' as ThemePref,
  );
}
