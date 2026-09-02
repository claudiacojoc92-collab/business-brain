import React from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { LOCALES, type Locale } from '../i18n/messages';
import { useSession } from './session';

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <select
      className="s0-lang"
      aria-label={t('lang.label')}
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

/** Product chrome: wordmark, language switcher, and (when signed in) sign out. */
export function AppShell({
  children,
  showSignOut = false,
}: {
  children: React.ReactNode;
  showSignOut?: boolean;
}) {
  const { t } = useLocale();
  const { logout } = useSession();
  return (
    <div className="s0-root">
      <header className="s0-header">
        <span className="s0-brand">
          Business <span className="s0-brand-mark">Brain</span>
        </span>
        <div className="s0-header-right">
          <LanguageSwitcher />
          {showSignOut && (
            <button type="button" className="s0-linkbtn" onClick={logout}>
              {t('shell.signout')}
            </button>
          )}
        </div>
      </header>
      <main className="s0-main">{children}</main>
    </div>
  );
}
