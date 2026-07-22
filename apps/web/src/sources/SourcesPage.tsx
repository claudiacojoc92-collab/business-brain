import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getSourcesStatus, type SourceState, type SourceStatus } from '../api/client';
import { AppShell, Button } from '../system/ui';

/**
 * Sources (Phase 1) — every place Business Brain can learn from, each shown with its TRUE state. No source is
 * ever dressed up: Meta appears as "access pending" with no metrics, no simulated connection, and no invented
 * data. Statuses are factual (not added / connected / processing / needs review / error / unavailable), and
 * each source offers only the action that actually exists for it.
 */
const STATUS_META: Record<SourceStatus, { text: string; dot: string; tone: string }> = {
  not_added:      { text: 'Not added',      dot: 'var(--line-2)',   tone: 'var(--ink-3)' },
  connected:      { text: 'Connected',      dot: 'var(--ok, #2e7d5b)', tone: 'var(--ink-2)' },
  processing:     { text: 'Processing',     dot: 'var(--gold)',     tone: 'var(--ink-2)' },
  needs_review:   { text: 'Needs review',   dot: 'var(--gold)',     tone: 'var(--ink-2)' },
  error:          { text: 'Error',          dot: 'var(--warn-line, #c0392b)', tone: 'var(--ink-2)' },
  unavailable:    { text: 'Unavailable',    dot: 'var(--line-2)',   tone: 'var(--ink-3)' },
  access_pending: { text: 'Access pending', dot: 'var(--line-2)',   tone: 'var(--ink-3)' },
};

// The one real action a source offers, when it has one. Meta/future have none (nothing to connect yet).
const ACTION_ROUTE: Record<string, { to: string; label: string }> = {
  founder:   { to: '/declare',  label: 'Describe your business' },
  website:   { to: '/understand', label: 'Add a website' },
  documents: { to: '/connect',  label: 'Add materials' },
  market:    { to: '/market',   label: 'Manage positioning' },
};

export function SourcesPage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [sources, setSources] = useState<SourceState[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!founderId) return;
    let alive = true;
    void getSourcesStatus().then((s) => { if (alive) { setSources(s); setLoaded(true); } }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [founderId]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/start" replace />;
  if (!loaded) return <AppShell><div style={{ color: 'var(--ink-3)', fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)' }}>Loading sources…</div></AppShell>;

  return (
    <AppShell max="var(--reading-wide, 760px)">
      <div style={{ padding: '2vh 0 0' }}>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 var(--sp-3)' }}>Sources</p>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, lineHeight: 'var(--lh-tight)', color: 'var(--ink)', margin: '0 0 var(--sp-3)' }}>Where I learn from</h1>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-6)', maxWidth: '64ch' }}>
          Each source is shown exactly as it stands. The more you connect, the more grounded my reading of your business becomes.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          {(sources ?? []).map((s) => {
            const m = STATUS_META[s.status] ?? STATUS_META.not_added;
            const action = s.status === 'access_pending' || s.status === 'unavailable' ? undefined : ACTION_ROUTE[s.key];
            return (
              <div key={s.key} data-testid={`source-${s.key}`} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', display: 'flex', gap: 'var(--sp-4)', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
                    <span style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-3)', color: 'var(--ink)' }}>{s.name}</span>
                    <span data-testid={`source-${s.key}-status`} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', letterSpacing: '0.04em', textTransform: 'uppercase', color: m.tone }}>{m.text}</span>
                  </div>
                  <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-body)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: 0, maxWidth: '58ch' }}>{s.detail}</p>
                </div>
                {action && (
                  <Button variant={s.status === 'not_added' ? 'secondary' : 'ghost'} onClick={() => navigate(action.to)}>{action.label}</Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
