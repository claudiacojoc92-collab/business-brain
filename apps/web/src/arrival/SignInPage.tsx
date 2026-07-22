import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { signIn, ApiError, GOOGLE_LOGIN_URL } from '../api/client';
import { AppShell, Button, GoogleButton, Field, authCard } from '../system/ui';
import { useGoogleLoginAvailable } from './useGoogleLogin';

/**
 * A–E Wave 1 — sign in (/signin). Email/password + Continue with Google. Failures are generic (the server
 * never reveals whether an email exists). Clear path to recovery and to sign-up.
 */
export function SignInPage() {
  const { founderId, isLoading, refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const googleAvailable = useGoogleLoginAvailable();

  if (!isLoading && founderId) return <Navigate to="/home" replace />;

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      await signIn(email.trim(), password);
      await refresh();
      navigate('/home', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError('Invalid email or password.');
      else setError('Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <AppShell actions={<Link to="/signup" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', textDecoration: 'none' }}>Create account</Link>}>
      <div className="bb-rise" style={authCard}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, color: 'var(--ink)', margin: '0 0 6px' }}>Welcome back</h1>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)', margin: '0 0 var(--sp-6)' }}>Sign in to continue where you left off.</p>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <Field label="Email" id="si-email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
          <Field label="Password" id="si-password" type="password" value={password} onChange={setPassword} autoComplete="current-password" error={Boolean(error)} />
          {error && <p role="alert" style={{ margin: 0, color: 'var(--warn-ink)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)' }}>{error}</p>}
          <Button type="submit" variant="primary" full loading={busy}>Sign in</Button>
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', margin: 'var(--sp-4) 0 var(--sp-5)' }}>
          <Link to="/recover" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>Forgot password?</Link>
          <Link to="/login" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>Use a magic link</Link>
        </div>
        {googleAvailable && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 var(--sp-5)' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--line)' }} /><span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--faint)' }}>or</span><span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            </div>
            <GoogleButton onClick={() => { window.location.href = GOOGLE_LOGIN_URL; }} />
          </>
        )}
        <p style={{ textAlign: 'center', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)', margin: 'var(--sp-6) 0 0' }}>
          New here? <Link to="/signup" style={{ color: 'var(--ink)' }}>Create an account</Link>
        </p>
      </div>
    </AppShell>
  );
}
