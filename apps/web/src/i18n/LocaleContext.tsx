import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { translate, type Locale } from './messages';

/**
 * UI LANGUAGE RULE (operator, 2026-10-07): the product UI is ALWAYS English. Buttons, labels, navigation and every
 * fixed string render in English for every founder; there is no in-app language switcher and the account locale no
 * longer drives the UI. What the MODEL writes (understanding, strategy, plan, conversation, pages…) follows the
 * business's CONTENT language, decided server-side (packages/application/src/business/content-language.ts) — never
 * this locale. The RO/IT message tables are kept for a possible translated marketing page; nothing in the app
 * selects them. `setLocale` is in-memory only (tests render a specific table); it never persists or syncs.
 */
export const UI_LOCALE: Locale = 'en';

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string>) => string;
}

const LocaleContext = createContext<LocaleState | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(UI_LOCALE);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback(
    (key: string, vars?: Record<string, string>) => translate(locale, key, vars),
    [locale],
  );

  const value = useMemo<LocaleState>(() => ({ locale, setLocale, t }), [locale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
