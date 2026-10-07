import React from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';

/**
 * B4 — one minimal app-level boundary around the product route surface. It exists so that an
 * unexpected render throw (an API shape a page didn't expect, a null deref) never becomes a blank
 * white screen for a founder. It is intentionally the ONLY boundary; it is not a per-page pattern.
 *
 * The visible fallback is a calm Nocturne product state — not a generic React error page and never a
 * stack trace. It offers exactly two ways forward: Retry (re-mount the surface) and return Home.
 */

/** Nocturne fallback. A function component so it can speak the founder's language via useLocale;
 *  it renders inside the providers, so both AppShell and the locale/router context are available. */
function ProductErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale();
  return (
    <AppShell>
      <div className="s0-panel">
        <h1 className="s0-h1">{t('app.error.title')}</h1>
        <p className="s0-lede">{t('app.error.body')}</p>
        <div className="s0-strat-actions" style={{ marginTop: 6 }}>
          <button type="button" className="s0-btn" style={{ maxWidth: 320 }} onClick={onRetry}>
            {t('common.retry')}
          </button>
          <Link to="/home" className="s0-linkbtn" onClick={onRetry}>{t('app.error.home')}</Link>
        </div>
      </div>
    </AppShell>
  );
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    // Console only — never surface raw errors to the founder.
    // eslint-disable-next-line no-console
    console.error('[BusinessBrain] render error captured by ErrorBoundary:', error);
  }

  private reset = (): void => this.setState({ hasError: false });

  render(): React.ReactNode {
    if (this.state.hasError) return <ProductErrorFallback onRetry={this.reset} />;
    return this.props.children;
  }
}
