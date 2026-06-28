import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  ApiError,
  getFounderProfile,
  getOffer,
  getCurrentCycle,
  getCurrentBrief,
  getCycleHistory,
  getMemoryConfidence,
  getCurrentContent,
  type FounderProfile,
  type OfferSummary,
  type CurrentCycle,
  type CycleBrief,
  type CycleHistory,
  type MemoryConfidence,
  type ContentPieceForApproval,
} from '../api/client';

/**
 * Home v1 — the first visible body of Business Brain.
 *
 * A read-only projection of state the backend already holds, organised around the five
 * questions a founder has: what is understood, what is happening now, what happens next,
 * what is NOT yet known, and whether they need to act. Every value traces to a real
 * endpoint; absent data renders as honest absence, never as a fabricated default.
 */

interface ErrInfo { status: number; code: string }
function toErr(e: unknown): ErrInfo {
  if (e instanceof ApiError) return { status: e.status, code: e.code };
  return { status: 0, code: 'UNKNOWN_ERROR' };
}

// ─── Styling (matches the existing inline-style dark theme) ───────────────────
const wrap: React.CSSProperties = { minHeight: '100vh', background: '#0a0f1a', padding: '40px 20px', color: '#e8e6e1' };
const inner: React.CSSProperties = { maxWidth: 720, margin: '0 auto' };
const muted: React.CSSProperties = { color: '#6b7280' };
const section: React.CSSProperties = { marginBottom: 36 };
const kicker: React.CSSProperties = { fontSize: '0.7rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 };
const h2: React.CSSProperties = { fontSize: '1.05rem', fontWeight: 500, margin: '0 0 14px' };
const card: React.CSSProperties = { border: '1px solid #1f2937', borderRadius: 6, padding: '14px 16px' };
const rowBase: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0', lineHeight: 1.55 };
const accent = '#5b8db8';

// ─── Honesty primitives: a KNOWN fact vs an UNKNOWN gap are visually distinct ──
function Known({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div style={rowBase}>
      <span aria-hidden style={{ color: accent, fontSize: '0.7rem', lineHeight: 1.9 }}>●</span>
      <span>
        {label && <span style={muted}>{label}: </span>}
        <span style={{ color: '#e8e6e1' }}>{children}</span>
      </span>
    </div>
  );
}
function Unknown({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...rowBase, color: '#6b7280' }}>
      <span aria-hidden style={{ color: '#475569', fontSize: '0.7rem', lineHeight: 1.9 }}>○</span>
      <span>
        {children} <span style={{ color: '#475569' }}>· not yet known</span>
      </span>
    </div>
  );
}
function Plain({ children }: { children: React.ReactNode }) {
  return <p style={{ ...muted, lineHeight: 1.6, margin: '4px 0' }}>{children}</p>;
}

// ─── Formatting helpers (display-only; no derived intelligence) ────────────────
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
/** Teaser truncation — the full text is shown when the brief is opened. */
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

export function DashboardPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<FounderProfile | null>(null);
  const [profileErr, setProfileErr] = useState<ErrInfo | null>(null);
  const [offer, setOffer] = useState<OfferSummary | null>(null);
  const [offerErr, setOfferErr] = useState<ErrInfo | null>(null);
  const [current, setCurrent] = useState<CurrentCycle | null>(null);
  const [currentErr, setCurrentErr] = useState<ErrInfo | null>(null);
  const [brief, setBrief] = useState<CycleBrief | null>(null);
  const [briefErr, setBriefErr] = useState<ErrInfo | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [history, setHistory] = useState<CycleHistory | null>(null);
  const [memory, setMemory] = useState<MemoryConfidence | null>(null);
  const [content, setContent] = useState<ContentPieceForApproval[]>([]);
  const [contentErr, setContentErr] = useState<ErrInfo | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [p, o, cu, b, h, m, c] = await Promise.allSettled([
      getFounderProfile(),
      getOffer(),
      getCurrentCycle(),
      getCurrentBrief(),
      getCycleHistory(5),
      getMemoryConfidence(),
      getCurrentContent(),
    ]);
    if (p.status === 'fulfilled') { setProfile(p.value); setProfileErr(null); } else { setProfile(null); setProfileErr(toErr(p.reason)); }
    if (o.status === 'fulfilled') { setOffer(o.value); setOfferErr(null); } else { setOffer(null); setOfferErr(toErr(o.reason)); }
    if (cu.status === 'fulfilled') { setCurrent(cu.value); setCurrentErr(null); } else { setCurrent(null); setCurrentErr(toErr(cu.reason)); }
    if (b.status === 'fulfilled') { setBrief(b.value); setBriefErr(null); } else { setBrief(null); setBriefErr(toErr(b.reason)); }
    if (h.status === 'fulfilled') { setHistory(h.value); } else { setHistory(null); }
    if (m.status === 'fulfilled') { setMemory(m.value); } else { setMemory(null); }
    if (c.status === 'fulfilled') { setContent(c.value); setContentErr(null); } else { setContent([]); setContentErr(toErr(c.reason)); }
    setLoading(false);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const lastCommitted = history?.items?.[0] ?? null;
  const offerMissing = offerErr?.code === 'NO_ACTIVE_OFFER';
  const briefMissing = briefErr?.code === 'CYCLE_NOT_FOUND' || briefErr?.code === 'BRIEF_NOT_FOUND';

  return (
    <div style={wrap}>
      <div style={inner}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 500 }}>Business Brain</h1>
          <button
            onClick={logout}
            style={{ background: 'none', border: '1px solid #1f2937', color: '#6b7280', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.875rem', padding: '6px 14px', borderRadius: 4 }}
          >
            Sign out
          </button>
        </div>

        {loading ? (
          <span style={muted}>Reading what Business Brain knows…</span>
        ) : (
          <>
            {/* Legend — makes the known/unknown distinction explicit */}
            <div style={{ ...muted, fontSize: '0.8rem', display: 'flex', gap: 18, marginBottom: 28 }}>
              <span><span style={{ color: accent }}>●</span> known</span>
              <span><span style={{ color: '#475569' }}>○</span> not yet known</span>
            </div>

            {/* ── Section 1 — Understanding ─────────────────────────────────── */}
            <div style={section}>
              <div style={kicker}>What Business Brain understands</div>
              <h2 style={h2}>About you and your business</h2>
              <div style={card}>
                {profileErr ? (
                  <Unknown>Your profile could not be loaded right now</Unknown>
                ) : profile ? (
                  <>
                    <Known label="Business">{profile.businessName}</Known>
                    <Known label="Founder">{profile.name}</Known>
                    {fmtDate(profile.activatedAt)
                      ? <Known label="Active since">{fmtDate(profile.activatedAt)}</Known>
                      : <Unknown>Activation date</Unknown>}
                    <Known label="Timezone">{profile.timezone}</Known>
                  </>
                ) : null}

                <div style={{ height: 1, background: '#1f2937', margin: '12px 0' }} />

                {offerMissing ? (
                  <Unknown>Your offer isn’t defined</Unknown>
                ) : offerErr ? (
                  <Unknown>Your offer could not be loaded right now</Unknown>
                ) : offer ? (
                  <>
                    <Known label="Offer">{offer.name}</Known>
                    <Known label="Promise">{offer.primaryPromise}</Known>
                    <Known label="Price tier">{humanize(offer.priceTier)}</Known>
                    <Known label="Maturity">{humanize(offer.maturity)}</Known>
                    <Known label="Availability">{humanize(offer.availability)}</Known>
                  </>
                ) : null}

                <div style={{ height: 1, background: '#1f2937', margin: '12px 0' }} />

                {briefMissing ? (
                  <Unknown>A strategic read of your audience and positioning</Unknown>
                ) : briefErr ? (
                  <Unknown>The latest strategic read could not be loaded right now</Unknown>
                ) : brief ? (
                  <>
                    <div style={kicker}>Latest strategic read{fmtDate(brief.committedAt) ? ` · ${fmtDate(brief.committedAt)}` : ''}</div>
                    <Known label="Mode">{humanize(brief.mode)}</Known>
                    {brief.strategicPurpose
                      ? <Known label="Strategy">{briefOpen ? brief.strategicPurpose : truncate(brief.strategicPurpose, 110)}</Known>
                      : null}
                    {brief.audienceSegment
                      ? <Known label="Audience">{briefOpen ? brief.audienceSegment : truncate(brief.audienceSegment, 110)}</Known>
                      : null}

                    {briefOpen && (
                      <>
                        {brief.validationResult ? <Known label="Status">{humanize(brief.validationResult)}</Known> : null}
                        {brief.isFallback ? (
                          <Plain>This was a fallback brief — produced with limited signal, so it’s a starting read rather than a fully-confident strategic call.</Plain>
                        ) : null}
                      </>
                    )}

                    <button
                      onClick={() => setBriefOpen((o) => !o)}
                      aria-expanded={briefOpen}
                      style={{ marginTop: 10, background: 'none', border: 'none', color: accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.85rem', padding: 0 }}
                    >
                      {briefOpen ? 'Close brief' : 'Open full brief'}
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            {/* ── Section 2 — Now ───────────────────────────────────────────── */}
            <div style={section}>
              <div style={kicker}>What’s happening now</div>
              <h2 style={h2}>Right now</h2>
              <div style={card}>
                {currentErr ? (
                  <Plain>The current status could not be loaded right now.</Plain>
                ) : current ? (
                  <>
                    <Known label="In progress">Cycle #{current.cycleNumber} — {humanize(current.status)}</Known>
                    {fmtDate(current.startedAt) ? <Known label="Started">{fmtDate(current.startedAt)}</Known> : null}
                  </>
                ) : (
                  <>
                    <Plain>No cycle is running right now — Business Brain is between cycles.</Plain>
                    {lastCommitted
                      ? <Known label="Most recent cycle">#{lastCommitted.cycleNumber} completed {fmtDate(lastCommitted.committedAt)}{lastCommitted.isFallback ? ' (fallback)' : ''}</Known>
                      : <Unknown>No cycles have run yet</Unknown>}
                  </>
                )}
              </div>
            </div>

            {/* ── Section 3 — Next ──────────────────────────────────────────── */}
            <div style={section}>
              <div style={kicker}>What happens next</div>
              <h2 style={h2}>Next</h2>
              <div style={card}>
                {current ? (
                  <>
                    <Known label="Upcoming">Cycle #{current.cycleNumber} is {humanize(current.status)}</Known>
                    {fmtDate(current.contentDeliverBy)
                      ? <Known label="Content expected by">{fmtDate(current.contentDeliverBy)}</Known>
                      : <Unknown>Delivery timing</Unknown>}
                  </>
                ) : (
                  <>
                    <Unknown>The timing of your next brief</Unknown>
                    <Plain>No upcoming cycle is currently scheduled. When Business Brain schedules the next one, it will appear here — with its real timing, not a guess.</Plain>
                  </>
                )}
              </div>
            </div>

            {/* ── Section 4 — Not Yet Known ─────────────────────────────────── */}
            <div style={section}>
              <div style={kicker}>What Business Brain doesn’t know yet</div>
              <h2 style={h2}>Still learning</h2>
              <div style={{ ...card, borderColor: '#26303f' }}>
                <Plain>This is what Business Brain learns from your behavior as you review and act — it accumulates over cycles, and is separate from the strategic read above.</Plain>
                {memory ? (
                  <>
                    {memory.compositeConfidence > 0
                      ? <Known label="Behavioral learning confidence">{Math.round(memory.compositeConfidence * 100)}%</Known>
                      : <Unknown>Behavioral learning confidence is not yet established</Unknown>}
                    <div style={{ height: 1, background: '#1f2937', margin: '12px 0' }} />
                    {memory.layers.map((l) =>
                      l.dataPoints > 0 ? (
                        <Known key={l.layer} label={humanize(l.layer)}>
                          {Math.round(l.confidence * 100)}% · {l.dataPoints} data point{l.dataPoints === 1 ? '' : 's'}
                        </Known>
                      ) : (
                        <Unknown key={l.layer}>{humanize(l.layer)}</Unknown>
                      ),
                    )}
                  </>
                ) : (
                  <Plain>The learning state could not be loaded right now.</Plain>
                )}

                {/* Structural gaps surfaced from other sources, so absences are never hidden */}
                {offerMissing ? <Unknown>Your offer isn’t defined</Unknown> : null}
                {briefMissing ? <Unknown>No strategic brief has been produced</Unknown> : null}
              </div>
            </div>

            {/* ── Section 5 — Your Move ─────────────────────────────────────── */}
            <div style={section}>
              <div style={kicker}>Whether you need to act</div>
              <h2 style={h2}>Your move</h2>
              <div style={card}>
                {contentErr ? (
                  <Plain>Whether anything is waiting on you could not be loaded right now.</Plain>
                ) : content.length > 0 ? (
                  <>
                    <Known>{content.length} piece{content.length === 1 ? '' : 's'} awaiting your review.</Known>
                    <button
                      onClick={() => navigate('/review')}
                      style={{ marginTop: 10, fontFamily: 'inherit', fontSize: '0.875rem', padding: '8px 16px', borderRadius: 4, cursor: 'pointer', background: '#16243a', border: `1px solid ${accent}`, color: '#cfe0f0' }}
                    >
                      Open review
                    </button>
                  </>
                ) : (
                  <Plain>Nothing right now — Business Brain is working.</Plain>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
