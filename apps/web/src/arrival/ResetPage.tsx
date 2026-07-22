import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AppShell, Button, Field, authCard } from '../system/ui';

/**
 * A–E Wave 1 — set a new password from a reset link (/reset?token=…). On success the session is set and we
 * enter the welcome. Invalid/expired tokens fail closed with a clear, non-technical message.
 */
export function ResetPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!token) return <Navigate to="/recover" replace />;

  const submit = async () => {
    setError(''); setBusy(true);
    try {
      await resetPassword(token, password);
      await refresh();
      navigate('/home', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) setError('That reset link is invalid or has expired. Request a new one.');
      else setError('Something went wrong. Please try again.');
    } finally { setBusy(false); }
  };

  return (
    <AppShell>
      <div className="bb-rise" style={authCard}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, color: 'var(--ink)', margin: '0 0 6px' }}>Choose a new password</h1>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)', margin: '0 0 var(--sp-6)' }}>At least 8 characters.</p>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <Field label="New password" id="rs-password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus error={Boolean(error)} />
          {error && <p role="alert" style={{ margin: 0, color: 'var(--warn-ink)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)' }}>{error} <Link to="/recover" style={{ color: 'var(--ink)' }}>Try again</Link></p>}
          <Button type="submit" variant="primary" full loading={busy}>Set password &amp; continue</Button>
        </form>
      </div>
    </AppShell>
  );
}
