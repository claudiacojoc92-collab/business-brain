import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useSession } from './session';
import { AppShell } from './AppShell';
import { createBusiness, ApiError } from '../api/client';

export function BusinessHomePage() {
  const { t, locale } = useLocale();
  const { account, businesses, refresh } = useSession();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const firstName = (account?.name ?? '').trim().split(/\s+/)[0] ?? '';
  const hasBusinesses = businesses.length > 0;
  const showForm = !hasBusinesses || creating;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const b = await createBusiness({ name, defaultConversationLanguage: locale });
      await refresh();
      navigate(`/b/${b.id}`);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? err.message : t('auth.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell showSignOut>
      <div className="s0-panel s0-panel-wide">
        <h1 className="s0-h1">{t('home.greeting', { name: firstName })}</h1>
        <p className="s0-lede">{t('home.understand')}</p>

        {hasBusinesses && !creating && (
          <>
            <div className="s0-biz-list">
              {businesses.map((b) => (
                <div key={b.id} className="s0-biz-row">
                  <span className="s0-biz-name">{b.name}</span>
                  <button type="button" className="s0-open" onClick={() => navigate(`/b/${b.id}`)}>
                    {t('home.open')}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="s0-btn-ghost" onClick={() => setCreating(true)}>
              {t('home.add.another')}
            </button>
          </>
        )}

        {showForm && (
          <form onSubmit={create} style={{ maxWidth: 460 }}>
            {error && <div className="s0-error" role="alert">{error}</div>}
            <div className="s0-field">
              <label className="s0-label" htmlFor="s0-bizname">{t('home.business.name')}</label>
              <input
                id="s0-bizname"
                className="s0-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="s0-stack">
              <button type="submit" className="s0-btn" disabled={busy}>
                {busy ? t('common.loading') : t('home.create.cta')}
              </button>
              {hasBusinesses && (
                <button
                  type="button"
                  className="s0-linkbtn"
                  onClick={() => { setCreating(false); setName(''); setError(null); }}
                >
                  {t('start.back')}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}
