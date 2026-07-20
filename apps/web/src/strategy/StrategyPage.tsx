import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  createStrategySession, getStrategySession, listStrategySessions, retryStrategySession, respondToStrategy, ApiError,
  type StrategySessionView, type StrategyBoundary, type StrategicRecommendation, type InsufficientStrategicEvidence,
  type StrategyResponseType, type EpistemicKind, type Band,
} from '../api/client';
import { AppShell, Button, Thinking } from '../system/ui';

const ACTIVE: ReadonlySet<string> = new Set(['QUEUED', 'PROCESSING']);
const STAGE: Record<string, string> = { QUEUED: 'Getting your context together…', PROCESSING: 'Reasoning it through with your business + positioning…' };

// Founder-legible label per epistemic kind — the reasoning NEVER flattens these into one "fact".
const KIND_LABEL: Record<EpistemicKind, string> = {
  OBSERVED_BUSINESS_EVIDENCE: 'From your business', BUSINESS_UNDERSTANDING_INFERENCE: 'My reading of your business',
  PUBLIC_POSITIONING_OBSERVATION: 'From a public site', MARKET_INFERENCE: 'My reading (not a market fact)',
  FOUNDER_DECLARATION: 'You told me', FOUNDER_CORRECTION: 'You corrected me', FOUNDER_RELEVANCE_DECISION: 'You judged relevance',
  UNKNOWN: 'Not known yet', CONVERSATION_HYPOTHESIS: 'A tentative idea', STRATEGIC_RECOMMENDATION: 'My recommendation',
};
const SUBTYPE_LABEL: Record<string, string> = {
  CHANNEL_PRIORITY: 'Channel priority', POSITIONING_PRIORITY: 'Positioning priority', OFFER_PRIORITY: 'Offer priority',
  ACQUISITION_PRIORITY: 'Acquisition priority', WEBSITE_PRIORITY: 'Website priority', LAUNCH_PRIORITY: 'Launch priority',
  GENERAL_30_DAY_PRIORITY: '30-day priority',
};
const RESPONSES: Array<{ v: StrategyResponseType; label: string }> = [
  { v: 'ACCEPT', label: 'This is right' }, { v: 'QUALIFY', label: 'Partly — with a caveat' }, { v: 'REJECT', label: 'I disagree' },
  { v: 'NEEDS_MORE_EVIDENCE', label: 'I need more to decide' }, { v: 'NOT_RELEVANT_NOW', label: 'Not the priority now' },
];

/**
 * Wave 4 — Founder Strategy (/strategy). ONE bounded job: help decide the next business/marketing priority. The
 * result is a STRUCTURED, epistemic-tagged recommendation (not a chat bubble): the call, why, what it's based on,
 * unknowns, alternatives, what would change it, and one next step. Insufficient evidence is a valid, honest
 * outcome. Out-of-scope questions get a boundary, not a guess. Founder responses are append-only; ACCEPT records
 * a decision — it does not execute anything or write to memory. Session-guarded; refresh/reconnect safe.
 */
export function StrategyPage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [boundary, setBoundary] = useState<StrategyBoundary | null>(null);
  const [session, setSession] = useState<StrategySessionView | null>(null);
  const [history, setHistory] = useState<StrategySessionView[]>([]);
  const [busy, setBusy] = useState(false);

  const on401 = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) navigate('/signin', { replace: true }); }, [navigate]);

  const poll = useCallback(async (id: string) => {
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      let s: StrategySessionView;
      try { s = await getStrategySession(id); } catch (e) { on401(e); return; }
      setSession(s);
      if (!ACTIVE.has(s.status)) { void listStrategySessions().then(setHistory).catch(() => {}); return; }
    }
  }, [on401]);

  // Mount: load history and RECONNECT to the most recent session (so a refresh restores the in-flight or last
  // result — polling resumes for an active one). Nothing is lost across a reload.
  useEffect(() => {
    if (!founderId) return;
    let live = true;
    (async () => {
      let sessions: StrategySessionView[];
      try { sessions = await listStrategySessions(); } catch (e) { on401(e); return; }
      if (!live) return;
      setHistory(sessions);
      const latest = sessions[0];
      if (latest) {
        try { const full = await getStrategySession(latest.sessionId); if (live) { setSession(full); if (ACTIVE.has(full.status)) void poll(full.sessionId); } } catch (e) { on401(e); }
      }
    })();
    return () => { live = false; };
  }, [founderId, on401, poll]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/signin" replace />;

  const ask = async () => {
    if (!question.trim() || busy) return;
    setBusy(true); setBoundary(null); setSession(null);
    try {
      const res = await createStrategySession(question.trim());
      if ('outOfScope' in res && res.outOfScope) { setBoundary(res.boundary); }
      else { const s = res as StrategySessionView; setSession(s); if (ACTIVE.has(s.status)) void poll(s.sessionId); }
    } catch (e) { on401(e); } finally { setBusy(false); }
  };
  const retry = async () => {
    if (!session) return;
    try { const s = await retryStrategySession(session.sessionId); setSession(s); if (ACTIVE.has(s.status)) void poll(s.sessionId); } catch (e) { on401(e); }
  };
  const openHistory = async (id: string) => {
    setBoundary(null);
    try { const s = await getStrategySession(id); setSession(s); if (ACTIVE.has(s.status)) void poll(s.sessionId); } catch (e) { on401(e); }
  };
  const onResponded = (updated: StrategySessionView) => setSession(updated);

  const active = session != null && ACTIVE.has(session.status);
  return (
    <AppShell actions={<button type="button" onClick={() => navigate('/welcome')} style={backBtn}>Back</button>}>
      <div style={{ maxWidth: 680 }}>
        <p style={eyebrow}>Founder strategy</p>
        <h1 style={h1}>What should you prioritise next?</h1>
        <p style={lede}>
          Ask me one priority question — which channel to focus on, whether to fix positioning before ads, whether to
          launch now, what to prioritise in the next 30 days. I’ll reason it through with your business and public-positioning
          context, show you exactly what it’s based on, and tell you what I <em>don’t</em> know. I won’t pretend to be certain.
        </p>

        <div style={{ marginBottom: 'var(--sp-6)' }}>
          <textarea
            value={question} onChange={(e) => setQuestion(e.target.value)} rows={3}
            placeholder="e.g. Should I prioritise LinkedIn or a newsletter for the next 30 days?"
            style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 'var(--r-2)', border: '1px solid var(--line-2)', fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical' }}
          />
          <div style={{ marginTop: 'var(--sp-3)' }}><Button variant="primary" loading={busy} onClick={() => void ask()}>Reason it through</Button></div>
        </div>

        {boundary && <BoundaryCard boundary={boundary} />}

        {session && (
          <div style={{ marginBottom: 'var(--sp-6)' }}>
            <p style={{ ...meta, marginBottom: 'var(--sp-3)' }}>{SUBTYPE_LABEL[session.subtype] ?? session.subtype} · “{session.question}”</p>
            {active && <div style={{ marginTop: 'var(--sp-3)' }}><Thinking message={STAGE[session.status] ?? 'Working…'} /></div>}
            {session.status === 'READY' && session.recommendation && <RecommendationView session={session} onResponded={onResponded} on401={on401} />}
            {session.status === 'INSUFFICIENT_EVIDENCE' && session.insufficient && <InsufficientView data={session.insufficient} onAddContext={() => navigate('/understand')} />}
            {session.status === 'FAILED' && (
              <div style={card}>
                <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', margin: 0 }}>{session.message ?? 'Something went wrong. Nothing was lost.'}</p>
                {session.retryable && <div style={{ marginTop: 'var(--sp-3)' }}><Button variant="secondary" onClick={() => void retry()}>Try again</Button></div>}
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div style={{ marginTop: 'var(--sp-7)', paddingTop: 'var(--sp-5)', borderTop: '1px solid var(--line)' }}>
            <p style={meta}>Earlier priority questions</p>
            {history.map((h) => (
              <button key={h.sessionId} type="button" onClick={() => void openHistory(h.sessionId)} style={historyRow}>
                <span style={{ color: 'var(--ink-2)' }}>{h.question}</span>
                <span style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{statusLabel(h.status)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function statusLabel(s: string): string {
  return s === 'READY' ? 'recommendation' : s === 'INSUFFICIENT_EVIDENCE' ? 'needs more' : s === 'FAILED' ? 'failed' : 'working';
}

function BoundaryCard({ boundary }: { boundary: StrategyBoundary }) {
  return (
    <div style={{ ...card, borderColor: 'var(--gold)' }}>
      <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--gold)', margin: '0 0 var(--sp-2)' }}>Outside what I do here</p>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: 0, lineHeight: 'var(--lh-body)' }}>{boundary.message}</p>
    </div>
  );
}

const BAND_COLOR: Record<Band, string> = { LOW: 'var(--ink-3)', MEDIUM: 'var(--gold)', HIGH: 'var(--ok-ink)' };
function ConfidenceRow({ label, band }: { label: string; band: Band }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
      <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: '0.05em', color: BAND_COLOR[band] }}>{band}</span>
    </div>
  );
}

function EvidenceItem({ kind, statement, sourceUrl }: { kind: EpistemicKind; statement: string; sourceUrl?: string | null }) {
  return (
    <li style={{ listStyle: 'none', marginBottom: 'var(--sp-3)' }}>
      <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)' }}>{KIND_LABEL[kind]}</span>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '2px 0 0', lineHeight: 'var(--lh-body)' }}>{statement}{sourceUrl && <> <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)' }}>source</a></>}</p>
    </li>
  );
}

/** The structured recommendation: 1 call · 2 why · 3 based on · 4 unknowns · 5 alternatives · 6 what would change it · 7 next step. */
function RecommendationView({ session, onResponded, on401 }: { session: StrategySessionView; onResponded: (s: StrategySessionView) => void; on401: (e: unknown) => void }) {
  const r = session.recommendation as StrategicRecommendation;
  const [choice, setChoice] = useState<StrategyResponseType | null>(session.effectiveResponse?.responseType ?? null);
  const [qual, setQual] = useState(session.effectiveResponse?.qualification ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const hasPrior = session.effectiveResponse != null;

  const save = async () => {
    if (!choice || saving) return;
    if (choice === 'QUALIFY' && !qual.trim()) return;
    setSaving(true);
    try {
      await respondToStrategy(session.sessionId, { responseType: choice, qualification: choice === 'QUALIFY' ? qual.trim() : undefined });
      const full = await getStrategySession(session.sessionId);
      onResponded(full); setSaved(true);
    } catch (e) { on401(e); } finally { setSaving(false); }
  };

  return (
    <div style={card}>
      {/* 1 — the call */}
      <span style={sectionLabel}>My recommendation</span>
      <h2 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-2)', fontWeight: 500, color: 'var(--ink)', margin: '4px 0 var(--sp-2)' }}>{r.recommendation.title}</h2>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', margin: 0, lineHeight: 'var(--lh-body)' }}>{r.recommendation.action}</p>
      <p style={{ ...meta, marginTop: 'var(--sp-2)' }}>Horizon: {r.recommendation.horizon}</p>

      {/* 3 — what it's based on (evidence + declarations, epistemic-tagged) */}
      {(r.reasoning.supportingEvidence.length > 0 || r.reasoning.founderDeclarations.length > 0) && <>
        <span style={sectionLabel}>What this is based on</span>
        <ul style={ulReset}>
          {r.reasoning.founderDeclarations.map((e, i) => <EvidenceItem key={`d${i}`} kind={e.kind} statement={e.statement} sourceUrl={e.sourceUrl} />)}
          {r.reasoning.supportingEvidence.map((e, i) => <EvidenceItem key={`s${i}`} kind={e.kind} statement={e.statement} sourceUrl={e.sourceUrl} />)}
        </ul>
      </>}

      {/* 2 — assumptions + conflicts (corrections outrank inference; shown honestly) */}
      {r.reasoning.assumptions.length > 0 && <>
        <span style={sectionLabel}>What I’m assuming</span>
        <ul style={ulReset}>{r.reasoning.assumptions.map((a, i) => <li key={i} style={liText}>{a.assumption}{a.basis && <span style={{ color: 'var(--ink-3)' }}> — {a.basis}</span>}</li>)}</ul>
      </>}
      {r.reasoning.conflicts.length > 0 && <>
        <span style={{ ...sectionLabel, color: 'var(--warn-ink)' }}>Where your input overrides mine</span>
        <ul style={ulReset}>{r.reasoning.conflicts.map((c, i) => <li key={i} style={liText}><em>{c.observation}</em> → you said: <strong>{c.founderCorrection}</strong></li>)}</ul>
      </>}

      {/* 4 — unknowns (they survive; never silently dropped) */}
      {r.reasoning.unknowns.length > 0 && <>
        <span style={sectionLabel}>What I don’t know yet</span>
        <ul style={ulReset}>{r.reasoning.unknowns.map((u, i) => <li key={i} style={liText}>{u.unknown}{u.whyItMatters && <span style={{ color: 'var(--ink-3)' }}> — {u.whyItMatters}</span>}</li>)}</ul>
      </>}
      {r.reasoning.counterEvidence.length > 0 && <>
        <span style={sectionLabel}>What cuts against this</span>
        <ul style={ulReset}>{r.reasoning.counterEvidence.map((e, i) => <EvidenceItem key={i} kind={e.kind} statement={e.statement} sourceUrl={e.sourceUrl} />)}</ul>
      </>}

      {/* confidence — five dimensions, never one % */}
      <span style={sectionLabel}>How confident I am</span>
      <div style={{ background: 'var(--surface-2, transparent)', borderRadius: 'var(--r-1)' }}>
        <ConfidenceRow label="Strength of evidence" band={r.confidence.evidenceStrength} />
        <ConfidenceRow label="How much you’ve confirmed" band={r.confidence.founderConfirmation} />
        <ConfidenceRow label="Quality of market context" band={r.confidence.marketContextQuality} />
        <ConfidenceRow label="Level of contradiction" band={r.confidence.contradictionLevel} />
        <ConfidenceRow label="Weight of unknowns" band={r.confidence.unknownBurden} />
      </div>

      {/* 5 — alternatives */}
      {r.alternatives.length > 0 && <>
        <span style={sectionLabel}>Other options I considered</span>
        <ul style={ulReset}>{r.alternatives.map((a, i) => <li key={i} style={liText}><strong>{a.option}</strong> — {a.whyNotFirst}{a.whenItBecomesPreferable && <span style={{ color: 'var(--ink-3)' }}> (better once: {a.whenItBecomesPreferable})</span>}</li>)}</ul>
      </>}

      {/* 6 — what would change this */}
      <span style={sectionLabel}>What would change my recommendation</span>
      <ul style={ulReset}>{r.whatWouldChangeThisRecommendation.map((w, i) => <li key={i} style={liText}>{w}</li>)}</ul>

      {/* 7 — one next step */}
      <span style={sectionLabel}>The one next step</span>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: '4px 0 0' }}>{r.nextStep.action}</p>
      {(r.nextStep.successSignal || r.nextStep.reviewAfter) && <p style={{ ...meta, marginTop: 4 }}>{r.nextStep.successSignal && <>You’ll know it’s working if: {r.nextStep.successSignal}. </>}{r.nextStep.reviewAfter && <>Review after {r.nextStep.reviewAfter}.</>}</p>}

      {/* provenance — quiet, honest */}
      {session.provenance && <p style={{ ...meta, marginTop: 'var(--sp-4)' }}>Reasoned by {session.provenance.modelId ?? 'the strategist'}{session.provenance.promptVersion ? ` · ${session.provenance.promptVersion}` : ''}{session.understandingVersion != null ? ` · from understanding v${session.understandingVersion}` : ''}. This is a recommendation, not an instruction — you decide.</p>}

      {/* founder response — append-only; ACCEPT records a decision, it does not execute anything */}
      <div style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line)' }}>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '0 0 6px' }}>What’s your call?</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RESPONSES.map((o) => {
            const on = choice === o.v;
            return <button key={o.v} type="button" onClick={() => { setChoice(o.v); setSaved(false); }} style={{ cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '5px 12px', borderRadius: 'var(--r-1)', border: `1px solid ${on ? 'var(--ink)' : 'var(--line-2)'}`, background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--surface)' : 'var(--ink-2)' }}>{o.label}</button>;
          })}
        </div>
        {choice === 'QUALIFY' && <textarea value={qual} onChange={(e) => { setQual(e.target.value); setSaved(false); }} placeholder="What’s the caveat?" rows={2} style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'var(--sp-3)' }}>
          <Button variant={choice ? 'secondary' : 'ghost'} loading={saving} onClick={() => void save()}>{hasPrior ? 'Update my response' : 'Record my response'}</Button>
          {saved
            ? <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ok-ink)' }}>Recorded. This is your decision on record — nothing was executed. You can revise it.</span>
            : hasPrior && <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>Your current response is shown. You can change it.</span>}
        </div>
      </div>
    </div>
  );
}

function InsufficientView({ data, onAddContext }: { data: InsufficientStrategicEvidence; onAddContext: () => void }) {
  return (
    <div style={card}>
      <span style={{ ...sectionLabel, marginTop: 0, color: 'var(--gold)' }}>I don’t have enough to call this yet</span>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: '4px 0 var(--sp-3)', lineHeight: 'var(--lh-body)' }}>{data.whyItMatters}</p>
      <span style={sectionLabel}>What’s missing</span>
      <ul style={ulReset}>{data.whatIsMissing.map((m, i) => <li key={i} style={liText}>{m}</li>)}</ul>
      {data.whatNotToConcludeYet.length > 0 && <>
        <span style={sectionLabel}>What not to conclude yet</span>
        <ul style={ulReset}>{data.whatNotToConcludeYet.map((m, i) => <li key={i} style={liText}>{m}</li>)}</ul>
      </>}
      <span style={sectionLabel}>The smallest thing that would help</span>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: '4px 0 var(--sp-4)' }}>{data.smallestEvidenceAction}</p>
      <Button variant="secondary" onClick={onAddContext}>Add more context</Button>
    </div>
  );
}

// ── shared inline styles (match the editorial system used across the app) ──
const backBtn = { background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' } as const;
const eyebrow = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 var(--sp-3)' } as const;
const h1 = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, color: 'var(--ink)', margin: '0 0 var(--sp-3)' } as const;
const lede = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-6)' } as const;
const card = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', boxShadow: 'var(--elev-1)' } as const;
const meta = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: 0 } as const;
const sectionLabel = { display: 'block', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--ink-3)', margin: 'var(--sp-4) 0 var(--sp-2)' } as const;
const ulReset = { margin: 0, padding: 0 } as const;
const liText = { listStyle: 'none', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '0 0 6px', lineHeight: 'var(--lh-body)' } as const;
const historyRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left' as const, background: 'none', border: 'none', borderBottom: '1px solid var(--line)', padding: '10px 0', cursor: 'pointer', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)' };
