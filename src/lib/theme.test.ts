// @vitest-environment jsdom
//
// The theme preference has two controls — the topbar cycle button and the
// Appearance picker in Settings. They used to hold separate copies of it, so
// changing one left the other showing the old choice. These pin the broadcast
// that keeps them in step.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getThemePref, setThemePref, subscribeThemePref } from './theme';

// jsdom ships no matchMedia; 'device' resolution needs one.
function stubMatchMedia(prefersDark: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: prefersDark,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia(false);
  document.documentElement.removeAttribute('data-theme');
});

describe('theme preference sync', () => {
  it('tells every subscriber when the preference changes', () => {
    const topbar = vi.fn();
    const settings = vi.fn();
    subscribeThemePref(topbar);
    subscribeThemePref(settings);

    setThemePref('dark');

    // The regression: one control moved, the other never heard about it.
    expect(topbar).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledTimes(1);
    // ...and both now read the same value back out of the one store.
    expect(getThemePref()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reports the resolved theme, not the preference', () => {
    stubMatchMedia(true);
    expect(setThemePref('device')).toBe('dark');
    expect(getThemePref()).toBe('device');
  });

  it('follows a change made in another tab, painting it first', () => {
    const onChange = vi.fn();
    subscribeThemePref(onChange);

    // What the browser delivers when a second tab writes the key: the value is
    // already in localStorage, but this document was never repainted.
    localStorage.setItem('restruc:theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'restruc:theme' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores storage writes for other keys', () => {
    const onChange = vi.fn();
    subscribeThemePref(onChange);

    window.dispatchEvent(new StorageEvent('storage', { key: 'restruc:sidebar' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops listening once unsubscribed', () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeThemePref(onChange);

    unsubscribe();
    setThemePref('dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'restruc:theme' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
