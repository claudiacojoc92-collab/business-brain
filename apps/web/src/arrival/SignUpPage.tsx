import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { signUp, ApiError, GOOGLE_LOGIN_URL } from '../api/client';
import { AppShell, Button, GoogleButton, Field, authCard } from '../system/ui';
import { useGoogleLoginAvailable } from './useGoogleLogin';

/**
 * A–E Wave 1 — create account (/signup). Email/password + Continue with Google. On success the session
 * cookie is set by the API and we enter the personal welcome. Clear sign-up vs sign-in.
 */
export function SignUpPage() {
  const { founderId, isLoading, refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const googleAvailable = useGoogleLoginAvailable();

  if (!isLoading && founderId) return <Navigate to="/welcome" replace />;

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      await signUp(email.trim(), password);
      await refresh();
      navigate('/welcome', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError('That email is already registered — sign in instead.');
      else if (e instanceof ApiError && e.status === 400) setError('Enter a valid email and a password of at least 8 characters.');
      else setError('Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <AppShell actions={<Link to="/signin" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', textDecoration: 'none' }}>Sign in</Link>}>
      <div className="bb-rise" style={authCard}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, color: 'var(--ink)', margin: '0 0 6px' }}>Create your account</h1>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)', margin: '0 0 var(--sp-6)' }}>Begin the relationship. It takes a moment.</p>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <Field label="Email" id="su-email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
          <Field label="Password" id="su-password" type="password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="at least 8 characters" error={Boolean(error)} />
          {error && <p role="alert" style={{ margin: 0, color: 'var(--warn-ink)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)' }}>{error}</p>}
          <Button type="submit" variant="primary" full loading={busy}>Create account</Button>
        </form>
        {googleAvailable && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: 'var(--sp-5) 0' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /><span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>or</span><span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>
            <GoogleButton onClick={() => { window.location.href = GOOGLE_LOGIN_URL; }} />
          </>
        )}
        <p style={{ textAlign: 'center', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)', margin: 'var(--sp-6) 0 0' }}>
          Already have an account? <Link to="/signin" style={{ color: 'var(--ink)' }}>Sign in</Link>
        </p>
      </div>
    </AppShell>
  );
}
