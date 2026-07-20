import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { logoutSession } from '../api/client';
import { AppShell, Button } from '../system/ui';

/**
 * A–E Wave 1 — the personal welcome (/welcome). Not a "connect your sources" utility page: a warm opening
 * that frames the relationship and what happens next. Session-guarded. The forward action begins Stage B
 * (business understanding) — for now it bridges to the existing connect step; Wave 2 replaces that surface.
 */
export function WelcomePage() {
  const { founderId, isLoading, refresh } = useAuth();
  const navigate = useNavigate();
  if (isLoading) return null;
  if (!founderId) return <Navigate to="/start" replace />;

  const signOut = async () => { try { await logoutSession(); } catch { /* ignore */ } await refresh(); navigate('/start', { replace: true }); };

  return (
    <AppShell actions={<button type="button" onClick={() => void signOut()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>Sign out</button>}>
      <div style={{ padding: '4vh 0 0' }}>
        <p className="bb-rise" style={{ ['--i' as string]: 0, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 var(--sp-4)' }}>Welcome</p>
        <h1 className="bb-rise" style={{ ['--i' as string]: 1, fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, lineHeight: 'var(--lh-tight)', color: 'var(--ink)', margin: '0 0 var(--sp-5)', maxWidth: 560 }}>
          Good to meet you. Let’s get to know each other.
        </h1>
        <div style={{ maxWidth: 560 }}>
          <p className="bb-rise" style={{ ['--i' as string]: 2, fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-4)' }}>
            Here’s how this works. First, I’ll read your business from the outside — starting with your website —
            and tell you what I actually understand, in plain terms.
          </p>
          <p className="bb-rise" style={{ ['--i' as string]: 3, fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-4)' }}>
            Then we’ll talk — properly — so I understand not just the business, but how you think about it.
            From there, we work together on positioning, content, and growth.
          </p>
          <p className="bb-rise" style={{ ['--i' as string]: 4, fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-3)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-7)' }}>
            No forms to fill for their own sake. Nothing you tell me is wasted. You can leave, export, or delete
            everything at any time.
          </p>
          <div className="bb-rise" style={{ ['--i' as string]: 5, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => navigate('/understand')}>Start with my business →</Button>
            <button type="button" onClick={() => navigate('/market')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>Positioning context</button>
            <button type="button" onClick={() => navigate('/strategy')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>Decide a priority</button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
