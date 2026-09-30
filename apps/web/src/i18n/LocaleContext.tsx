import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, isLocale, translate, type Locale } from './messages';

const STORAGE_KEY = 'bb_locale';
// Set ONLY when the founder changes the language in the UI. Once set, the account no longer overrides the
// client — their explicit choice wins. Absent it, the account locale is authoritative and seeds the client.
const EXPLICIT_KEY = 'bb_locale_explicit';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;               // an EXPLICIT founder choice (the UI switcher)
  adoptFromAccount: (locale: string) => void;        // seed from the account on session load, unless overridden
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
      try { localStorage.setItem(EXPLICIT_KEY, '1'); } catch { /* ignore */ }  // a deliberate founder choice
      setLocaleState(next);
      onLocaleChange?.(next);
    },
    [onLocaleChange],
  );

  // Seed the client locale from the AUTHORITATIVE account locale on session load. Skips when the founder has
  // explicitly chosen in the UI (their choice wins), and never posts back — the account is the source, so this
  // must NOT go through setLocale/onLocaleChange. This ends the client/server desync that mixed languages.
  const adoptFromAccount = useCallback((next: string) => {
    try { if (localStorage.getItem(EXPLICIT_KEY) === '1') return; } catch { /* ignore */ }
    if (!isLocale(next)) return;
    setLocaleState((cur) => (cur === next ? cur : next));
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string>) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo<LocaleState>(() => ({ locale, setLocale, adoptFromAccount, t }), [locale, setLocale, adoptFromAccount, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
