'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** User-selectable theme preference. `system` follows the OS setting. */
export type ThemePreference = 'light' | 'dark' | 'system';
/** The theme actually applied to the DOM. */
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'lcos-theme';

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyToDocument(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
}

/**
 * Provides light/dark theming to its subtree. Persists the preference, honors the OS
 * setting when `system`, and reacts to OS changes live. Wrap a route (or the whole app)
 * with this; components use semantic Tailwind tokens and adapt automatically.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: {
  children: ReactNode;
  defaultTheme?: ThemePreference;
}) {
  const [theme, setThemeState] = useState<ThemePreference>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  // Hydrate the stored preference once on mount.
  useEffect(() => {
    const stored = (typeof localStorage !== 'undefined' &&
      localStorage.getItem(STORAGE_KEY)) as ThemePreference | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      setThemeState(stored);
    }
  }, []);

  // Resolve + apply whenever the preference changes, and follow the OS when `system`.
  useEffect(() => {
    const resolve = () => {
      const next = theme === 'system' ? systemTheme() : theme;
      setResolvedTheme(next);
      applyToDocument(next);
    };
    resolve();

    if (theme !== 'system' || typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', resolve);
    return () => mql.removeEventListener('change', resolve);
  }, [theme]);

  const setTheme = useCallback((t: ThemePreference) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* storage may be unavailable (private mode) — ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggle }),
    [theme, resolvedTheme, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a <ThemeProvider>');
  return ctx;
}

/**
 * Blocking script that applies the stored/OS theme before first paint to avoid a
 * light-to-dark flash. Render inside <head> (or before app content).
 */
export function ThemeScript() {
  const js = `(function(){try{var p=localStorage.getItem('${STORAGE_KEY}');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=(p==='dark'||((!p||p==='system')&&d))?'dark':'light';var r=document.documentElement;r.classList.toggle('dark',t==='dark');r.dataset.theme=t;}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
