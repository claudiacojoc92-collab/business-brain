import React from 'react';
import { Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { LOCALES, type Locale } from '../i18n/messages';
import { useSession } from './session';
import { useTalk } from './TalkDrawer';
import { useAddContext } from './AddContextDrawer';

/** Talk to BB — the persistent global action. Opens the conversation drawer over the current surface. */
function TalkButton({ label }: { label: string }) {
  const { open } = useTalk();
  return <button type="button" className="s0-talk" onClick={open}>{label}</button>;
}

/** Add context — the persistent "something changed / add material / add a link" global action. */
function AddContextButton({ label }: { label: string }) {
  const { open } = useAddContext();
  return <button type="button" className="s0-addctx" onClick={open}>{label}</button>;
}

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

function Wordmark({ to }: { to: string }) {
  return (
    <Link to={to} className="s0-brand">
      Business <span className="s0-brand-mark">Brain</span>
    </Link>
  );
}

/** The five persistent product destinations (frozen IA: Home · Business · Strategy · Today · Create).
 *  Home is its own surface ("what BB sees"), distinct from Today ("the one move"). `match` decides the
 *  active (you-are-here) state; Talk to BB is a separate global action, never one of these tabs. */
function navItems(base: string, t: (k: string) => string) {
  return [
    { to: `${base}/home`, label: t('nav.home'), match: (p: string) => p.startsWith(`${base}/home`) },
    { to: base, label: t('nav.business'), match: (p: string) => p === base },
    { to: `${base}/strategy`, label: t('nav.strategy'), match: (p: string) => p.startsWith(`${base}/strategy`) || p.startsWith(`${base}/voice`) },
    { to: `${base}/today`, label: t('nav.today'), match: (p: string) => p.startsWith(`${base}/today`) || p.startsWith(`${base}/plan`) },
    { to: `${base}/create`, label: t('nav.create'), match: (p: string) => p.startsWith(`${base}/create`) || p.startsWith(`${base}/photos`) || p.startsWith(`${base}/reel`) },
  ];
}

/**
 * Product chrome. In a business context (`/b/:id/...`) it renders the persistent
 * product shell: wordmark, current business, top-level nav (Home / Business /
 * Strategy / Today / Create), the Talk-to-BB global action, and an account menu —
 * plus a mobile bottom tab bar. Outside a business (entry / auth / business list) it renders
 * the minimal chrome: wordmark + language (+ optional sign out).
 */
export function AppShell({
  children,
  showSignOut = false,
  home = false,
}: {
  children: React.ReactNode;
  showSignOut?: boolean;
  /** The strategist home surface: a tab-free presence — wordmark + "Talk to BB · Account" only, no nav/tabbar. */
  home?: boolean;
}) {
  const { t } = useLocale();
  const { logout, businesses } = useSession();
  const { id } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { open: openTalk } = useTalk();
  const { open: openAdd } = useAddContext();

  // The strategist home: no tabs, no dashboard chrome — just the wordmark and the "Talk to BB · Account"
  // escape hatch top-right. The founder sees a presence, not a menu.
  if (id && home) {
    return (
      <div className="s0-root">
        <header className="s0-topbar s0-topbar-home">
          <Wordmark to="/home" />
          <div className="s0-topbar-right">
            <TalkButton label={t('nav.talk')} />
            <details className="s0-acct">
              <summary>{t('shell.account')}</summary>
              <div className="s0-acct-menu">
                <LanguageSwitcher />
                <button type="button" className="s0-linkbtn" onClick={logout}>{t('shell.signout')}</button>
              </div>
            </details>
          </div>
        </header>
        <main className="s0-main s0-main-home">{children}</main>
      </div>
    );
  }

  if (id) {
    const base = `/b/${id}`;
    const business = businesses.find((b) => b.id === id);
    const items = navItems(base, t);
    return (
      <div className="s0-root">
        <header className="s0-topbar">
          <div className="s0-topbar-left">
            <Wordmark to="/home" />
            <span className="s0-topbar-sep" aria-hidden="true" />
            <button type="button" className="s0-biz-current" onClick={() => navigate('/home')} title={t('shell.switch')}>
              {business?.name ?? '…'}
              <span className="s0-caret" aria-hidden="true">▾</span>
            </button>
            <nav className="s0-nav" aria-label={t('brand.name')}>
              {items.map((i) => (
                <Link key={i.to} to={i.to} className={i.match(pathname) ? 'active' : ''}>
                  {i.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="s0-topbar-right">
            <AddContextButton label={t('nav.addctx')} />
            <TalkButton label={t('nav.talk')} />
            {/* /talk direct route preserved for deep-links/refresh (renders the full-page ConversationPage). */}
            <details className="s0-acct">
              <summary>{t('shell.account')}</summary>
              <div className="s0-acct-menu">
                <button type="button" className="s0-linkbtn s0-acct-add" onClick={openAdd}>{t('nav.addctx')}</button>
                <LanguageSwitcher />
                <button type="button" className="s0-linkbtn" onClick={logout}>
                  {t('shell.signout')}
                </button>
              </div>
            </details>
          </div>
        </header>

        <main className="s0-main s0-main-shell">{children}</main>

        <nav className="s0-tabbar" aria-label={t('brand.name')}>
          {items.map((i) => (
            <Link key={i.to} to={i.to} className={i.match(pathname) ? 'active' : ''}>
              <span className="s0-tabdot" aria-hidden="true" />
              {i.label}
            </Link>
          ))}
        </nav>

        {/* Mobile: Talk is hidden in the topbar, so surface it as a floating strategist action. */}
        <button type="button" className="s0-talk-fab" onClick={openTalk} aria-label={t('nav.talk')}>{t('nav.talk')}</button>
      </div>
    );
  }

  // Minimal chrome — entry / auth / business list.
  return (
    <div className="s0-root">
      <header className="s0-header">
        <Wordmark to="/" />
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
