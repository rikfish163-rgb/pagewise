'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';

type ThemeChoice = 'system' | 'light' | 'dark';
const ThemeContext = createContext<{ theme: ThemeChoice; setTheme: (theme: ThemeChoice) => void }>({ theme: 'system', setTheme: () => {} });

function subscribeTheme(change: () => void) {
  window.addEventListener('pagewise:theme-changed', change);
  return () => window.removeEventListener('pagewise:theme-changed', change);
}

function readTheme(): ThemeChoice {
  const stored = window.localStorage.getItem('pagewise:theme');
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function serverTheme(): ThemeChoice { return 'system'; }

export function useTheme() {
  return useContext(ThemeContext);
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
  const setTheme = useCallback((next: ThemeChoice) => {
    window.localStorage.setItem('pagewise:theme', next);
    window.dispatchEvent(new Event('pagewise:theme-changed'));
  }, []);

  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme; };
    apply();
    if (theme !== 'system') return;
    system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
