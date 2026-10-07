import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, getCycleHistory, getCycleBrief, type CycleHistoryItem, type CycleBrief } from '../api/client';

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

const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', padding: '40px 20px', color: 'var(--ink)' };
const inner: React.CSSProperties = { maxWidth: 720, margin: '0 auto' };
const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 10, padding: 18, marginBottom: 16, boxShadow: 'var(--shadow-soft)' };
const muted: React.CSSProperties = { color: 'var(--ink-3)' };
const linkBtn: React.CSSProperties = { background: 'none', border: '1px solid var(--line-2)', color: 'var(--ink-3)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem', padding: '6px 14px', borderRadius: 8 };

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

// Quiet link accent (was decorative blue). Gold stays reserved for decisions.
const accent = 'var(--ink-2)';

/** Founder-facing message for a brief load failure, via existing API codes. */
function briefMessage(err: ErrInfo): string {
  switch (err.code) {
    case 'CYCLE_NOT_COMMITTED': return 'This cycle’s brief is not available yet.';
    case 'CYCLE_NOT_FOUND':     return 'This cycle could not be found.';
    case 'BRIEF_NOT_FOUND':     return 'No brief is available for this cycle.';
    default:                    return 'We could not load this brief right now.';
  }
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CycleHistoryItem[]>([]);
  const [err, setErr] = useState<ErrInfo | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // Expand-in-place: at most one cycle's brief is open at a time.
  const [openId, setOpenId] = useState<string | null>(null);
  const [brief, setBrief] = useState<CycleBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefErr, setBriefErr] = useState<ErrInfo | null>(null);

  const toggleBrief = useCallback(async (cycleId: string) => {
    if (openId === cycleId) { setOpenId(null); return; } // collapse
    setOpenId(cycleId); setBrief(null); setBriefErr(null); setBriefLoading(true);
    try { setBrief(await getCycleBrief(cycleId)); }
    catch (e) { setBriefErr(toErr(e)); }
    finally { setBriefLoading(false); }
  }, [openId]);

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
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: '1.35rem', fontWeight: 500, letterSpacing: '0.01em' }}>Business Brain</h1>
          <button onClick={() => navigate('/dashboard')} style={linkBtn}>Back</button>
        </div>

        <div style={{ fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
          The relationship so far
        </div>
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, letterSpacing: '-0.01em', margin: '0 0 16px' }}>Past cycles</h2>

        {loading ? (
          <span style={muted}>Loading…</span>
        ) : err ? (
          <div style={card}>
            <span style={muted}>We could not load your history right now. </span>
            <button style={{ ...linkBtn, color: 'var(--ink)' }} onClick={() => void load()}>Retry</button>
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
                <div style={muted}>{c.contentPieceCount} content piece{c.contentPieceCount === 1 ? '' : 's'}</div>
                {c.isFallback ? (
                  <div style={muted}>Fallback brief — produced with limited signal.</div>
                ) : null}

                <button
                  onClick={() => void toggleBrief(c.cycleId)}
                  aria-expanded={openId === c.cycleId}
                  style={{ marginTop: 10, background: 'none', border: 'none', color: accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', padding: 0 }}
                >
                  {openId === c.cycleId ? 'Hide brief' : 'View brief'}
                </button>

                {openId === c.cycleId ? (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                    {briefLoading ? (
                      <span style={muted}>Loading brief…</span>
                    ) : briefErr ? (
                      <span style={muted}>{briefMessage(briefErr)}</span>
                    ) : brief ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <strong>{humanize(brief.mode)}</strong>
                          <span style={muted}>{brief.isFallback ? 'Fallback brief' : humanize(brief.validationResult)}</span>
                        </div>
                        <p style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', lineHeight: 1.55, color: 'var(--ink)', margin: '0 0 8px' }}>{brief.strategicPurpose}</p>
                        <div style={muted}>Audience: {brief.audienceSegment}</div>
                      </>
                    ) : null}
                  </div>
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
