import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

/** Same key as the v1 client, so a saved preference carries over. */
const STORAGE_KEY = 'pm_theme';

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage can be blocked; fall through to the default.
  }
  return 'dark';
}

// One shared value, so the top bar and the command palette always agree.
let current: Theme = readTheme();
const listeners = new Set<() => void>();

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // The theme still applies for this page view.
  }
  current = theme;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, () => current);
  const toggle = useCallback(() => applyTheme(current === 'dark' ? 'light' : 'dark'), []);
  return { theme, toggle };
}
