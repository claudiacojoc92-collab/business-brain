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

/**
 * The i18n key for a failed FOUNDER ACTION (a mutation), branched on the cause. A TRANSIENT failure (network,
 * 5xx, 408, 429, or a non-ApiError) keeps the "try again in a moment" copy. A DETERMINISTIC client error
 * (409/403/422, other 4xx) retrying with the same input can never fix — so the copy says what happened and what
 * the founder can actually do, and the caller must NOT offer a blind retry for these. Mirrors the classify.ts
 * code→t() move: the backend already carries the status; the web maps it to founder language.
 */
export function actionErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return 'action.stale';       // superseded / changed under the founder
    if (err.status === 403) return 'action.forbidden';   // no access to this action
    if (err.status === 422) return 'action.rejected';    // fail-closed (e.g. claim-safety) — input must change
    if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) return 'action.failed';
  }
  return 'common.actionFailed'; // transient
}

/** True when retrying the SAME action cannot help (deterministic) — so no retry affordance should be shown. */
export function isDeterministic(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
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
