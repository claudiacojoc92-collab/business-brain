import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, getCycleHistory, type CycleHistoryItem } from '../api/client';

/**
 * Past cycles — a read-only history of the founder's committed cycles, newest first, so the
 * relationship visibly accumulates. Sourced solely from the existing GET /cycles/history.
 * contentPieceCount is intentionally NOT shown (it is hardcoded 0 in the backend — not a real
 * count). Past-cycle briefs are not yet retrievable from an existing endpoint, so cycles are
 * listed but not openable in this cycle.
 */

interface ErrInfo { status: number; code: string }
function toErr(e: unknown): ErrInfo {
  if (e instanceof ApiError) return { status: e.status, code: e.code };
  return { status: 0, code: 'UNKNOWN_ERROR' };
}

const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0a0f1a', padding: '40px 20px', color: '#e8e6e1' };
const inner: React.CSSProperties = { maxWidth: 720, margin: '0 auto' };
const card: React.CSSProperties = { border: '1px solid #1f2937', borderRadius: 6, padding: 16, marginBottom: 16 };
const muted: React.CSSProperties = { color: '#6b7280' };
const linkBtn: React.CSSProperties = { background: 'none', border: '1px solid #1f2937', color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem', padding: '6px 14px', borderRadius: 4 };

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function humanize(s: string): string {
  const lower = s.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CycleHistoryItem[]>([]);
  const [err, setErr] = useState<ErrInfo | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const h = await getCycleHistory(20);
      setItems(h.items); setHasMore(h.hasMore); setErr(null);
    } catch (e) {
      setItems([]); setErr(toErr(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 500 }}>Business Brain</h1>
          <button onClick={() => navigate('/dashboard')} style={linkBtn}>Back</button>
        </div>

        <div style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 }}>
          The relationship so far
        </div>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 500, margin: '0 0 16px' }}>Past cycles</h2>

        {loading ? (
          <span style={muted}>Loading…</span>
        ) : err ? (
          <div style={card}>
            <span style={muted}>We could not load your history right now. </span>
            <button style={{ ...linkBtn, color: '#e8e6e1' }} onClick={() => void load()}>Retry</button>
          </div>
        ) : items.length === 0 ? (
          <div style={card}><span style={muted}>No past cycles yet — your history will build here as cycles complete.</span></div>
        ) : (
          <>
            {items.map((c) => (
              <div key={c.cycleId} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <strong>Cycle #{c.cycleNumber}</strong>
                  <span style={muted}>{fmtDate(c.committedAt) ?? 'committed'}</span>
                </div>
                {c.selectedMode ? <div style={muted}>Mode: {humanize(c.selectedMode)}</div> : null}
                {c.isFallback ? (
                  <div style={muted}>Fallback brief — produced with limited signal.</div>
                ) : null}
              </div>
            ))}
            {hasMore ? (
              <div style={{ ...muted, fontSize: '0.85rem' }}>Showing your most recent cycles.</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
