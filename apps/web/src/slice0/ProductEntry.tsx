import { Link, Navigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useSession } from './session';
import { AppShell } from './AppShell';

/**
 * U1 — the founder entry at `/`. Business Brain's own identity (Nocturne), low
 * text density, one obvious action. Signed-in founders go straight to the product;
 * the Meta reviewer/compliance surface lives on its own route (`/verify`).
 */
export function ProductEntry() {
  const { t } = useLocale();
  const { account, isLoading } = useSession();

  if (isLoading) return <div className="s0-loading">{t('common.loading')}</div>;
  if (account) return <Navigate to="/home" replace />;

  return (
    <AppShell>
      <div className="s0-entry">
        <p className="s0-eyebrow">{t('brand.name')}</p>
        <h1 className="s0-entry-h1">{t('entry.tagline')}</h1>
        <p className="s0-lede">{t('entry.sub')}</p>
        <Link to="/signin" className="s0-btn s0-entry-cta">
          {t('entry.cta')}
        </Link>
      </div>
    </AppShell>
  );
}
