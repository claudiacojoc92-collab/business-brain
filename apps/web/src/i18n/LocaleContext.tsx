import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, isLocale, translate, type Locale } from './messages';

const STORAGE_KEY = 'bb_locale';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string>) => string;
}

const LocaleContext = createContext<LocaleState | null>(null);

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
    const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : '';
    if (isLocale(nav)) return nav;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

/**
 * Interface-locale provider (Slice 0). The locale lives client-side (localStorage) for pre-login
 * and is synced to the founder record after sign-in via onLocaleChange. `<html lang>` is kept in
 * step for accessibility.
 */
export function LocaleProvider({
  children,
  onLocaleChange,
}: {
  children: React.ReactNode;
  onLocaleChange?: (locale: Locale) => void;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      onLocaleChange?.(next);
    },
    [onLocaleChange],
  );

  const t = useCallback(
    (key: string, vars?: Record<string, string>) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo<LocaleState>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
