import { useCallback, useEffect, useState } from 'react';
import { Navigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getRead, ApiError } from '../api/client';
import { ReadDocument } from '../reads/ReadDocument';
import { STATE_COPY } from '../reads/copy';
import { SUPPORTED_SCHEMA_VERSION, type BusinessRead } from '../reads/types';

/**
 * The First Business Read (S1-T6) — one persisted, immutable snapshot rendered as the six-section document.
 * PURE READ: on mount it fetches GET /reads/:readId and renders. It NEVER generates (never POST /reads),
 * never recomputes, never re-resolves receipts, never falls back to current understanding. Not-found and
 * corrupt/unsupported both FAIL CLOSED to neutral copy — the historical Read is shown exactly as stored or
 * not at all; never partially, never repaired.
 */
type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; read: BusinessRead }
  | { kind: 'notfound' }
  | { kind: 'error' };

const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '40px 20px 96px' };
const inner: React.CSSProperties = { maxWidth: 'var(--reading)', margin: '0 auto' };
const backLink: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.78rem', color: 'var(--ink-3)', textDecoration: 'none', letterSpacing: '0.01em' };
const stateCopy: React.CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--ink-2)', marginTop: 48 };

export function FirstReadPage() {
  const { founderId, isLoading } = useAuth();
  const { readId } = useParams<{ readId: string }>();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!readId) { setState({ kind: 'notfound' }); return; }
    setState({ kind: 'loading' });
    try {
      const res = await getRead(readId);
      // Fail closed on an unknown contract version — never mis-render a changed shape.
      if (res.schemaVersion !== SUPPORTED_SCHEMA_VERSION) { setState({ kind: 'error' }); return; }
      setState({ kind: 'ready', read: res.read });
    } catch (e) {
      setState({ kind: e instanceof ApiError && e.status === 404 ? 'notfound' : 'error' });
    }
  }, [readId]);

  useEffect(() => { void load(); }, [load]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/login" replace />;

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ marginBottom: 28 }}><Link to="/reads" style={backLink}>← Your Reads</Link></div>
        {state.kind === 'loading' && <p style={stateCopy}>{STATE_COPY.loading}</p>}
        {state.kind === 'notfound' && <p style={stateCopy}>{STATE_COPY.notFound}</p>}
        {state.kind === 'error' && <p style={stateCopy}>{STATE_COPY.corrupt}</p>}
        {state.kind === 'ready' && <ReadDocument read={state.read} />}
      </div>
    </div>
  );
}
