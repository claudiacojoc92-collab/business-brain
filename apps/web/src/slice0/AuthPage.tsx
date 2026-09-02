import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useSession } from './session';
import { AppShell } from './AppShell';
import { login as apiLogin, registerAccount, getGoogleSigninUrl, ApiError } from '../api/client';

type Mode = 'signin' | 'register';

export function AuthPage() {
  const { t, locale } = useLocale();
  const { login } = useSession();
  const navigate = useNavigate();

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        const r = await registerAccount({ email, name, password, interfaceLocale: locale });
        await login(r.access_token);
      } else {
        const r = await apiLogin(email, password);
        await login(r.access_token);
      }
      navigate('/home', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t('auth.error.invalid'));
      else if (err instanceof ApiError && err.status === 409) setError(err.message);
      else if (err instanceof ApiError && err.status === 400) setError(err.message);
      else setError(t('auth.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    try {
      const { authUrl } = await getGoogleSigninUrl();
      window.location.href = authUrl;
    } catch {
      setError(t('auth.error.google'));
    }
  }

  return (
    <AppShell>
      <div className="s0-panel">
        <p className="s0-eyebrow">{t('brand.name')}</p>
        <h1 className="s0-h1">{t('auth.headline')}</h1>
        <p className="s0-lede">{t('auth.sub')}</p>

        <div className="s0-tabs" role="tablist" aria-label={t('brand.name')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            className="s0-tab"
            onClick={() => { setMode('signin'); setError(null); }}
          >
            {t('auth.tab.signin')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className="s0-tab"
            onClick={() => { setMode('register'); setError(null); }}
          >
            {t('auth.tab.register')}
          </button>
        </div>

        {error && <div className="s0-error" role="alert">{error}</div>}

        <form onSubmit={submit}>
          {mode === 'register' && (
            <div className="s0-field">
              <label className="s0-label" htmlFor="s0-name">{t('auth.name')}</label>
              <input
                id="s0-name"
                className="s0-input"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}
          <div className="s0-field">
            <label className="s0-label" htmlFor="s0-email">{t('auth.email')}</label>
            <input
              id="s0-email"
              className="s0-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="s0-field">
            <label className="s0-label" htmlFor="s0-password">{t('auth.password')}</label>
            <input
              id="s0-password"
              className="s0-input"
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : undefined}
            />
            {mode === 'register' && <p className="s0-hint">{t('auth.password.hint')}</p>}
          </div>
          <button type="submit" className="s0-btn" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? t('common.loading') : mode === 'register' ? t('auth.register.cta') : t('auth.signin.cta')}
          </button>
        </form>

        <div className="s0-divider">{t('auth.or')}</div>

        <button type="button" className="s0-btn-ghost" onClick={google}>
          {t('auth.google.cta')}
        </button>
      </div>
    </AppShell>
  );
}
