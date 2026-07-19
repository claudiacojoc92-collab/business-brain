import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../api/client';
import { AppShell, Button, Field, authCard } from '../system/ui';

/**
 * A–E Wave 1 — password recovery (/recover). Always answers with the same neutral confirmation (the server
 * never reveals whether an email exists). In dev the reset link is surfaced for testing without a mailbox.
 */
export function RecoverPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await requestPasswordReset(email.trim());
      setDevLink(res.devLink ?? null);
    } catch { /* never reveal outcome */ }
    finally { setSent(true); setBusy(false); }
  };

  return (
    <AppShell actions={<Link to="/signin" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', textDecoration: 'none' }}>Sign in</Link>}>
      <div className="bb-rise" style={authCard}>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, color: 'var(--ink)', margin: '0 0 6px' }}>Reset your password</h1>
        {sent ? (
          <>
            <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: 'var(--sp-4) 0' }}>
              If that email has an account, a reset link is on its way. Check your inbox.
            </p>
            {devLink && <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>dev: <Link to={devLink.replace(/^https?:\/\/[^/]+/, '')}>open reset link</Link></p>}
            <Link to="/signin" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink)' }}>Back to sign in</Link>
          </>
        ) : (
          <>
            <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)', margin: '0 0 var(--sp-6)' }}>Enter your email and we’ll send a reset link.</p>
            <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              <Field label="Email" id="rc-email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
              <Button type="submit" variant="primary" full loading={busy}>Send reset link</Button>
            </form>
          </>
        )}
      </div>
    </AppShell>
  );
}
