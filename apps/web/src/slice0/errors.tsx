import { ApiError } from '../api/client';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';

/**
 * Shared load-failure semantics for the product surfaces (B2/B3). This is deliberately NOT a new
 * error framework — it is one predicate and one presentational panel, so every business-scoped page
 * distinguishes the same two cases the same way:
 *
 *   • a DEFINITIVE not-found / no-access (404 / 403) — the business truly isn't there for this founder,
 *     so the page routes away (its own <Navigate>), exactly as before; versus
 *   • a TRANSIENT failure (network drop, 5xx, timeout) — which must NEVER be mistaken for "not found"
 *     or "I don't know your business yet." It stays on the surface and offers a calm retry.
 */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 403);
}

/** Calm, branded transient-load failure with a single recovery action (Nocturne language). */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale();
  return (
    <AppShell>
      <div className="s0-panel">
        <h1 className="s0-h1">{t('load.error.title')}</h1>
        <p className="s0-lede">{t('load.error.body')}</p>
        <button type="button" className="s0-btn" style={{ maxWidth: 320, marginTop: 8 }} onClick={onRetry}>
          {t('common.retry')}
        </button>
      </div>
    </AppShell>
  );
}
