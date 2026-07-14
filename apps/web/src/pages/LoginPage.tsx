import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { requestMagicLink, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

/**
 * Magic-link sign-in (S0-T2). Email only — no password. Submitting requests a link; the response is
 * ALWAYS a neutral "check your email" (the API never reveals whether an address exists). In dev the
 * API returns the link directly (devLink) so the flow is testable without a real mailbox — clicking it
 * hits GET /auth/verify, which sets the bb_session cookie and redirects home.
 */
export function LoginPage() {
  const { founderId, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  // Already signed in → the connect surface is the authenticated landing (S1-T5b).
  if (!authLoading && founderId) return <Navigate to="/connect" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await requestMagicLink(email);
      setSent(true);
      setDevLink(res.devLink ?? null); // dev convenience only; undefined in prod
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not send the link. Try again.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--paper)',
      padding: '24px 20px',
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        <h1 style={{ fontFamily: 'var(--serif)', color: 'var(--ink)', fontSize: '1.75rem', fontWeight: 500, letterSpacing: '0.01em', marginBottom: 8 }}>
          Business Brain
        </h1>

        {sent ? (
          <>
            <p style={{ color: 'var(--ink)', fontSize: '1rem', margin: 0 }}>
              Check your email
            </p>
            <p style={{ color: 'var(--ink-3)', fontSize: '0.875rem', margin: 0 }}>
              If <strong>{email}</strong> can sign in, a link is on its way. Open it to continue.
            </p>
            {devLink && (
              <p style={{ color: 'var(--ink-3)', fontSize: '0.8125rem', margin: 0, wordBreak: 'break-all' }}>
                Dev link: <a href={devLink} style={{ color: 'var(--accent, #3b6)' }}>{devLink}</a>
              </p>
            )}
            <button
              type="button"
              onClick={() => { setSent(false); setDevLink(null); }}
              style={{
                background: 'transparent',
                border: '1px solid var(--line-2)',
                borderRadius: 10,
                color: 'var(--ink-3)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '0.875rem',
                padding: '10px',
              }}
            >
              Use a different email
            </button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label htmlFor="email" style={{ color: 'var(--ink-3)', fontSize: '0.875rem' }}>Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 10,
                  color: 'var(--ink)',
                  fontSize: '1rem',
                  padding: '12px 14px',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {error && (
              <p style={{ color: 'var(--warn-ink)', fontSize: '0.875rem', margin: 0 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              style={{
                background: 'var(--ink)',
                opacity: isLoading ? 0.4 : 1,
                border: 'none',
                borderRadius: 10,
                color: 'var(--paper)',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                fontWeight: 500,
                fontSize: '0.9375rem',
                padding: '12px',
                transition: 'opacity 150ms, transform 140ms',
              }}
            >
              {isLoading ? 'Sending…' : 'Send me a link'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
