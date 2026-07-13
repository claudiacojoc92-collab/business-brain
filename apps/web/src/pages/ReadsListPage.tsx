import { useCallback, useEffect, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { listReads, ApiError } from '../api/client';
import { STATE_COPY } from '../reads/copy';
import type { ReadListItem } from '../reads/types';

/**
 * The founder's Reads over time — a quiet chronological list (newest first), the "return to" target for a
 * Read. Text links only: a date per snapshot, no cards, no metrics, no attention direction. Pure read
 * (GET /reads); it never generates. Immutable snapshots, so this is honest history.
 */
type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; reads: ReadListItem[] }
  | { kind: 'error' };

const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '48px 20px 96px' };
const inner: React.CSSProperties = { maxWidth: 'var(--reading)', margin: '0 auto' };
const title: React.CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.75rem', fontWeight: 500, color: 'var(--ink)', margin: '0 0 24px' };
const rowLink: React.CSSProperties = { display: 'block', fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink)', textDecoration: 'none', padding: '14px 0', borderBottom: '1px solid var(--line)' };
const quiet: React.CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.05rem', fontStyle: 'italic', color: 'var(--ink-3)' };
const footLink: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.78rem', color: 'var(--ink-3)', textDecoration: 'none' };

export function ReadsListPage() {
  const { founderId, isLoading } = useAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await listReads();
      setState({ kind: 'ready', reads: res.reads });
    } catch (e) {
      setState({ kind: e instanceof ApiError ? 'error' : 'error' });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/login" replace />;

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div style={wrap}>
      <div style={inner}>
        <h1 style={title}>Your Reads</h1>
        {state.kind === 'loading' && <p style={quiet}>{STATE_COPY.loading}</p>}
        {state.kind === 'error' && <p style={quiet}>{STATE_COPY.corrupt}</p>}
        {state.kind === 'ready' && (
          state.reads.length === 0
            ? <p style={quiet}>No Reads to show.</p>
            : <nav>{state.reads.map((r) => <Link key={r.readId} to={`/reads/${r.readId}`} style={rowLink}>{fmt(r.createdAt)}</Link>)}</nav>
        )}
        <div style={{ marginTop: 40 }}><Link to="/account" style={footLink}>Account</Link></div>
      </div>
    </div>
  );
}
