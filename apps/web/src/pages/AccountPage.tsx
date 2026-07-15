import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getAccountExport, deleteAccount, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { AUTH_COPY } from '../copy/auth';

/**
 * Account page (S0-T4, Article XIII — "leave as easily as you stay"). Two actions, both neutral:
 *   • Download my data — the complete export (GET /account/export) as a JSON file.
 *   • Delete account — permanent, irreversible. A single genuine confirmation (type your email); NO
 *     retention friction, NO "here's what you'll lose", NO guilt. Leaving is as easy as staying.
 */
export function AccountPage() {
  const { founderId, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportError, setExportError] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/login" replace />;

  const handleExport = async () => {
    setExportError(''); setExported(false); setExporting(true);
    try {
      const data = await getAccountExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'business-brain-export.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setExported(true);
    } catch {
      setExportError('Could not prepare your download. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const handleLogout = async () => {
    await logout();                        // GW-FIX logoutSession → 204, session ends + client state cleared
    navigate('/login', { replace: true });
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteError(''); setDeleting(true);
    try {
      await deleteAccount(confirmEmail);
      await logout();                       // clear client session state
      navigate('/login', { replace: true }); // logged out
    } catch (err) {
      setDeleteError(
        err instanceof ApiError && err.status === 400
          ? "That didn't match your email. Please try again."
          : 'Something went wrong. Please try again.',
      );
      setDeleting(false);
    }
  };

  const label = { color: 'var(--ink-3)', fontSize: '0.875rem' } as const;
  const input = { background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 10, color: 'var(--ink)', fontSize: '1rem', padding: '12px 14px', outline: 'none', fontFamily: 'inherit' } as const;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', padding: '48px 20px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 40 }}>
        <h1 style={{ fontFamily: 'var(--serif)', color: 'var(--ink)', fontSize: '1.75rem', fontWeight: 500, margin: 0 }}>Account</h1>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontFamily: 'var(--serif)', color: 'var(--ink)', fontSize: '1.15rem', fontWeight: 500, margin: 0 }}>Your data</h2>
          <p style={{ color: 'var(--ink-2)', fontSize: '0.9375rem', margin: 0 }}>
            Download everything Business Brain holds for your account as a JSON file.
          </p>
          <button
            type="button" onClick={handleExport} disabled={exporting}
            style={{ alignSelf: 'flex-start', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 10, cursor: exporting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 500, fontSize: '0.9375rem', padding: '12px 20px', opacity: exporting ? 0.4 : 1 }}
          >
            {exporting ? 'Preparing…' : 'Download my data'}
          </button>
          {exported && <p style={{ color: 'var(--ok-ink)', fontSize: '0.875rem', margin: 0 }}>Your download has started.</p>}
          {exportError && <p style={{ color: 'var(--warn-ink)', fontSize: '0.875rem', margin: 0 }}>{exportError}</p>}
        </section>

        {/* Log out — a quiet action (the foot-link idiom), between the data section and the destructive
            delete. No confirmation: logout is reversible by signing in again (GW-FIX). */}
        <button
          type="button" onClick={() => void handleLogout()}
          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: '0.78rem', color: 'var(--ink-3)', textDecoration: 'none' }}
        >
          {AUTH_COPY.logout}
        </button>

        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: 0 }} />

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontFamily: 'var(--serif)', color: 'var(--ink)', fontSize: '1.15rem', fontWeight: 500, margin: 0 }}>Delete account</h2>
          <p style={{ color: 'var(--ink-2)', fontSize: '0.9375rem', margin: 0 }}>
            Deleting your account permanently removes your account and all your data. This can’t be undone.
          </p>
          <form onSubmit={handleDelete} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label htmlFor="confirmEmail" style={label}>Type your email to confirm</label>
            <input id="confirmEmail" type="email" autoComplete="off" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} style={input} />
            {deleteError && <p style={{ color: 'var(--warn-ink)', fontSize: '0.875rem', margin: 0 }}>{deleteError}</p>}
            <button
              type="submit" disabled={deleting || !confirmEmail}
              style={{ alignSelf: 'flex-start', background: 'var(--warn-ink)', color: '#fff', border: 'none', borderRadius: 10, cursor: deleting || !confirmEmail ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 500, fontSize: '0.9375rem', padding: '12px 20px', opacity: deleting || !confirmEmail ? 0.4 : 1 }}
            >
              {deleting ? 'Deleting…' : 'Delete account'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
