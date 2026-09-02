import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useSession } from './session';

/**
 * Google sign-in return: the API redirected here with the minted token in the URL FRAGMENT
 * (not a query param, so it never reached a server). Read it, establish the session, land home.
 */
export function SigninCallbackPage() {
  const { login } = useSession();
  const { t } = useLocale();
  const navigate = useNavigate();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const token = new URLSearchParams(hash).get('access_token');
    if (token) {
      void login(token).then(() => navigate('/home', { replace: true }));
    } else {
      navigate('/signin?error=google_signin_failed', { replace: true });
    }
  }, [login, navigate]);

  return <div className="s0-loading">{t('common.loading')}</div>;
}
