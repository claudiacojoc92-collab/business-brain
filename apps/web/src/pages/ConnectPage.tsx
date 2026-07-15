import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getConnectStatus, readCalendar, generateRead, ApiError } from '../api/client';
import type { ConnectStatus } from '../connect/types';
import { CONNECT_COPY } from '../connect/copy';
import { AUTH_COPY } from '../copy/auth';
import { WebsiteCard } from '../connect/WebsiteCard';
import { UploadCard } from '../connect/UploadCard';
import { CalendarCard } from '../connect/CalendarCard';
import { primaryBtn } from '../connect/styles';

/**
 * The connect surface (S1-T5b) — the Read surface's sibling. On mount it fetches GET /connect/status ONLY
 * (never POSTs). Each source stands alone; Generate is enabled by ANY single connected source. The founder
 * generates a Read with one explicit click (POST /reads once) → /reads/:readId. Calendar OAuth is a full-page
 * round-trip; on returning focus the page re-checks status and, on a fresh connection, reads the calendar once.
 */
const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '48px 20px 96px' };
const inner: React.CSSProperties = { maxWidth: 'var(--reading)', margin: '0 auto' };
const title: React.CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.9rem', fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--ink)', margin: '0 0 8px' };
const intro: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink-2)', margin: '0 0 32px', lineHeight: 1.5 };
const quiet: React.CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink-3)' };
const disabledHint: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--ink-3)', margin: '10px 0 0' };
const guidance: React.CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink-2)', lineHeight: 1.5, margin: '16px 0 0' };
const link: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.78rem', color: 'var(--ink-3)', textDecoration: 'none' };

export function ConnectPage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [generating, setGenerating] = useState(false);
  const [insufficient, setInsufficient] = useState<{ reason: string; whatToDo: string } | null>(null);
  const [genError, setGenError] = useState('');
  const [calReading, setCalReading] = useState(false);
  const prevCal = useRef<boolean | undefined>(undefined);
  const calReadDone = useRef(false);
  const firstLoad = useRef(true);

  const on401 = useCallback((e: unknown): boolean => {
    if (e instanceof ApiError && e.status === 401) { navigate('/login', { replace: true }); return true; }
    return false;
  }, [navigate]);

  const refresh = useCallback(async () => {
    try {
      const s = await getConnectStatus();
      const prev = prevCal.current;
      prevCal.current = s.calendar.connected;
      setStatus(s); setPhase('ready');
      // Calendar OAuth return: a false→true TRANSITION (not the initial load) triggers the ingest ONCE.
      if (!firstLoad.current && !prev && s.calendar.connected && !calReadDone.current) {
        calReadDone.current = true;
        setCalReading(true);
        try { await readCalendar(); const s2 = await getConnectStatus(); setStatus(s2); }
        catch (e) { if (on401(e)) return; }
        finally { setCalReading(false); }
      }
      firstLoad.current = false;
    } catch (e) { if (!on401(e)) setPhase('error'); }
  }, [on401]);

  // On mount: GET /connect/status only — NEVER a POST.
  useEffect(() => { if (founderId) void refresh(); }, [founderId, refresh]);
  // Calendar OAuth is a full-page round-trip in another tab; re-check on returning focus.
  useEffect(() => {
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/login" replace />;

  const anyConnected = !!status && (status.website.connected || status.upload.connected || status.calendar.connected);

  const generate = async () => {
    if (generating || !anyConnected) return;
    setGenerating(true); setGenError(''); setInsufficient(null);
    try {
      const r = await generateRead();
      if (r.status === 'generated') navigate(`/reads/${r.readId}`);
      else setInsufficient({ reason: r.reason, whatToDo: r.whatToDo });
    } catch (e) { if (!on401(e)) setGenError(CONNECT_COPY.generate.error); }
    finally { setGenerating(false); }
  };

  return (
    <div style={wrap}>
      <div style={inner}>
        <h1 style={title}>{CONNECT_COPY.title}</h1>
        <p style={intro}>{CONNECT_COPY.intro}</p>

        {phase === 'loading' && <p style={quiet}>Loading…</p>}
        {phase === 'error' && <p style={quiet}>{CONNECT_COPY.generate.error}</p>}

        {phase === 'ready' && status && (
          <>
            <WebsiteCard website={status.website} onChanged={refresh} />
            <UploadCard upload={status.upload} onChanged={refresh} />
            <CalendarCard calendar={status.calendar} reading={calReading} onChanged={refresh} />

            <div style={{ marginTop: 28 }}>
              <button type="button" onClick={() => void generate()} disabled={!anyConnected || generating} aria-disabled={!anyConnected || generating} aria-busy={generating} style={primaryBtn(anyConnected && !generating)}>
                {generating ? CONNECT_COPY.generate.loading : CONNECT_COPY.generate.action}
              </button>
              {!anyConnected && <p style={disabledHint}>{CONNECT_COPY.generate.disabled}</p>}
              {insufficient && (
                <p style={guidance} role="status">{CONNECT_COPY.generate.insufficient}{insufficient.whatToDo ? ` ${insufficient.whatToDo}` : ''}</p>
              )}
              {genError && <p style={{ ...guidance, color: 'var(--warn-ink)' }} role="alert">{genError}</p>}
            </div>

            <div style={{ marginTop: 40, display: 'flex', gap: 20 }}>
              <Link to="/reads" style={link}>{CONNECT_COPY.yourReads}</Link>
              <Link to="/account" style={link}>{AUTH_COPY.account}</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
