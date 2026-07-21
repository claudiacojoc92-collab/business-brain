import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  createStrategySession, getStrategySession, listStrategySessions, retryStrategySession, respondToStrategy, createDecision, createCommitment, createPlan, ApiError,
  type StrategySessionView, type StrategyBoundary, type StrategicRecommendation, type InsufficientStrategicEvidence,
  type StrategyResponseType, type EpistemicKind, type Band, type EvidenceReference,
  type DecisionView, type DecisionAlternative, type ChosenOptionSource,
  type CommitmentView, type CommitmentScope, type Exclusivity,
  type PlanView, type PlanScope,
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
            {(session.contextConflicts ?? []).filter((c) => c.type === 'NON_NEGOTIABLE_OPTION_CONFLICT').map((c) => (
              <div key={c.id} style={{ ...card, borderColor: 'var(--warn-ink)', marginBottom: 'var(--sp-4)' }}>
                <span style={{ ...sectionLabel, marginTop: 0, color: 'var(--warn-ink)' }}>Your non-negotiable rules out the only supported option</span>
                <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: '4px 0 0', lineHeight: 'var(--lh-body)' }}>{c.description}</p>
                <p style={{ ...meta, marginTop: 6 }}>{c.strategicImpact}</p>
              </div>
            ))}
            {session.status === 'READY' && session.recommendation && <RecommendationView session={session} onResponded={onResponded} on401={on401} />}
            {session.status === 'INSUFFICIENT_EVIDENCE' && session.insufficient && <><InsufficientView data={session.insufficient} onAddContext={() => navigate('/understand')} /><div style={{ marginTop: 'var(--sp-4)' }}><DecisionPanel session={session} on401={on401} /></div></>}
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

// A historically-grounded reference that is no longer the CURRENT effective version gets a quiet, honest tag. Invalid
// references never reach the UI (removed at write time), so a tag never implies false grounding.
const HISTORICAL_TAG: Partial<Record<NonNullable<EvidenceReference['historicalStatus']>, string>> = {
  SUPERSEDED: 'since revised', RETIRED: 'since retired',
};
function EvidenceItem({ kind, statement, sourceUrl, validated, historicalStatus }: { kind: EpistemicKind; statement: string; sourceUrl?: string | null; validated?: boolean; historicalStatus?: EvidenceReference['historicalStatus'] }) {
  // Only a VALIDATED reference renders as a grounded citation (its source link). An unvalidated reference reaches the UI
  // only as the strategist's reasoning — never as a resolvable citation (the worker removes unresolved references).
  const tag = validated && historicalStatus ? HISTORICAL_TAG[historicalStatus] : undefined;
  return (
    <li style={{ listStyle: 'none', marginBottom: 'var(--sp-3)' }}>
      <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)' }}>{KIND_LABEL[kind]}</span>
      {tag && <span title="This grounded reference is preserved as it was when this recommendation was generated; your current context has changed since." style={{ marginLeft: 'var(--sp-2)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', fontStyle: 'italic' }}>· {tag}</span>}
      <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '2px 0 0', lineHeight: 'var(--lh-body)' }}>{statement}{validated && sourceUrl && <> <a href={sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-3)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)' }}>source</a></>}</p>
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
          {r.reasoning.founderDeclarations.map((e, i) => <EvidenceItem key={`d${i}`} kind={e.kind} statement={e.statement} sourceUrl={e.sourceUrl} validated={e.validated} historicalStatus={e.historicalStatus} />)}
          {r.reasoning.supportingEvidence.map((e, i) => <EvidenceItem key={`s${i}`} kind={e.kind} statement={e.statement} sourceUrl={e.sourceUrl} validated={e.validated} historicalStatus={e.historicalStatus} />)}
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
        <ul style={ulReset}>{r.reasoning.counterEvidence.map((e, i) => <EvidenceItem key={i} kind={e.kind} statement={e.statement} sourceUrl={e.sourceUrl} validated={e.validated} historicalStatus={e.historicalStatus} />)}</ul>
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
      {(session.provenanceValidation?.rejectedCount ?? 0) > 0 && <p style={{ ...meta, marginTop: 4 }}>Every reference shown above is checked against your actual records; {session.provenanceValidation!.rejectedCount} unverifiable reference{session.provenanceValidation!.rejectedCount === 1 ? '' : 's'} {session.provenanceValidation!.rejectedCount === 1 ? 'was' : 'were'} left out so nothing is claimed that I can’t point to.</p>}

      {/* founder feedback on the recommendation — append-only; this is NOT a decision (that is the separate surface below) */}
      <div style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line)' }}>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '0 0 6px' }}>Your read on this recommendation</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RESPONSES.map((o) => {
            const on = choice === o.v;
            return <button key={o.v} type="button" onClick={() => { setChoice(o.v); setSaved(false); }} style={{ cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '5px 12px', borderRadius: 'var(--r-1)', border: `1px solid ${on ? 'var(--ink)' : 'var(--line-2)'}`, background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--surface)' : 'var(--ink-2)' }}>{o.label}</button>;
          })}
        </div>
        {choice === 'QUALIFY' && <textarea value={qual} onChange={(e) => { setQual(e.target.value); setSaved(false); }} placeholder="What’s the caveat?" rows={2} style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'var(--sp-3)' }}>
          <Button variant={choice ? 'secondary' : 'ghost'} loading={saving} onClick={() => void save()}>{hasPrior ? 'Update my read' : 'Save my read'}</Button>
          {saved
            ? <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ok-ink)' }}>Saved. This is feedback on the recommendation — not a decision, and nothing was executed.</span>
            : hasPrior && <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>Your current read is shown. You can change it.</span>}
        </div>
      </div>

      {/* Strategic Decision Record — a SEPARATE, explicit founder act (Law 2). Not feedback, not a commitment. */}
      <DecisionPanel session={session} on401={on401} />
    </div>
  );
}

// A Strategic Decision Record — an EXPLICIT founder act, separate from recommendation feedback. Two beats: choose, then
// confirm. Records what was chosen + the alternatives, links the immutable session, and never disguises a value judgment
// as evidence. It is not a commitment or plan.
function DecisionPanel({ session, on401 }: { session: StrategySessionView; on401: (e: unknown) => void }) {
  const rec = session.recommendation;
  const insufficient = session.status === 'INSUFFICIENT_EVIDENCE';
  const recommendedLabel = rec ? rec.recommendation.title : null;
  // the option set the founder is choosing among (recommended + considered alternatives), all clearly sourced.
  const recOptions = rec ? [recommendedLabel!, ...rec.alternatives.map((a) => a.option)] : [];
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string>(recommendedLabel ?? '');
  const [ownLabel, setOwnLabel] = useState('');
  const [statement, setStatement] = useState('');
  const [rationale, setRationale] = useState('');
  const [reversibility, setReversibility] = useState<'REVERSIBLE' | 'COSTLY_TO_REVERSE' | 'IRREVERSIBLE' | 'UNKNOWN'>('UNKNOWN');
  const [ackInsufficient, setAckInsufficient] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<DecisionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usingOwn = chosen === '__own__';
  const chosenLabel = usingOwn ? ownLabel.trim() : chosen;
  const source: ChosenOptionSource = usingOwn ? 'FOUNDER_AUTHORED' : chosen === recommendedLabel ? 'RECOMMENDED' : 'ALTERNATIVE';
  const canConfirm = chosenLabel.length > 0 && statement.trim().length > 0 && (!insufficient || ackInsufficient);

  const confirm = async () => {
    setSaving(true); setError(null);
    // alternatives considered: the chosen (CHOSEN) + the others (CONSIDERED), each clearly sourced (rec-derived vs authored).
    const others = recOptions.filter((o) => o !== chosenLabel);
    const alternatives: DecisionAlternative[] = [
      { label: chosenLabel, source: usingOwn ? 'FOUNDER_AUTHORED' : 'RECOMMENDATION_DERIVED', disposition: 'CHOSEN', reason: null },
      ...others.map((o): DecisionAlternative => ({ label: o, source: 'RECOMMENDATION_DERIVED', disposition: 'CONSIDERED', reason: null })),
    ];
    // guarantee ≥2 alternatives even if the recommendation offered none
    if (alternatives.length < 2) alternatives.push({ label: 'Keep the current course', source: 'FOUNDER_AUTHORED', disposition: 'CONSIDERED', reason: null });
    try {
      const d = await createDecision(session.sessionId, {
        chosenOption: { label: chosenLabel, source, statement: null },
        decisionStatement: statement.trim(), rationale: rationale.trim() || null,
        alternativesConsidered: alternatives, reversibility,
        acknowledgedInsufficientEvidence: insufficient ? ackInsufficient : undefined,
        idempotencyKey: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
      });
      setSaved(d); setOpen(false);
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setError(e instanceof ApiError ? e.message : 'Could not record the decision.'); }
    finally { setSaving(false); }
  };

  if (saved) {
    return (
      <div style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '2px solid var(--ink)' }}>
        <span style={sectionLabel}>Your decision on record</span>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: '4px 0 0' }}>{saved.chosenOption.label}</p>
        <p style={{ ...meta, marginTop: 4 }}>{saved.decisionStatement}</p>
        <p style={{ ...meta, marginTop: 8 }}>
          {rec && <>Business Brain recommended “{recommendedLabel}”. </>}
          {saved.alignment === 'ALIGNED' && 'You chose the recommended option.'}
          {saved.alignment === 'PARTIALLY_ALIGNED' && 'You chose the recommended option with a modification.'}
          {saved.alignment === 'DIVERGENT' && 'You chose differently — recorded exactly as you decided, with the evidence unchanged.'}
          {saved.alignment === 'NO_RECOMMENDATION' && 'This was decided without a grounded recommendation.'}
        </p>
        {saved.acknowledgedInsufficientEvidence && <p style={{ ...meta, marginTop: 4 }}>You recorded this knowing the evidence was insufficient.</p>}
        <p style={{ ...meta, marginTop: 8, fontStyle: 'italic' }}>This records your decision. It does not create a commitment or plan. You can supersede or reverse it later.</p>
        {/* A commitment is a SEPARATE, later act — a decision does not become one automatically (Law 1). */}
        <CommitmentPanel decision={saved} on401={on401} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '2px solid var(--ink)' }}>
      {!open ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setOpen(true)}>Record a decision</Button>
          <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>A decision is your explicit choice — separate from the read above, and not a commitment or plan.</span>
        </div>
      ) : (
        <div>
          <span style={sectionLabel}>Record a decision</span>
          {rec && <p style={{ ...meta, marginTop: 2 }}>Business Brain recommends: <strong style={{ color: 'var(--ink-2)' }}>{recommendedLabel}</strong>. You’re choosing — you can pick this, an alternative, or your own.</p>}
          {insufficient && <p style={{ ...meta, marginTop: 2 }}>This session didn’t have enough evidence for a grounded recommendation. You can still decide — it will be recorded as such.</p>}

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '10px 0 4px' }}>You are choosing</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recOptions.map((o) => (
              <label key={o} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', cursor: 'pointer' }}>
                <input type="radio" name="chosen" checked={chosen === o} onChange={() => setChosen(o)} />
                <span>{o}{o === recommendedLabel && <span style={{ color: 'var(--accent, var(--ink-3))', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)' }}> · recommended</span>}</span>
              </label>
            ))}
            <label style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input type="radio" name="chosen" checked={usingOwn} onChange={() => setChosen('__own__')} />
              <span>Something else — my own call</span>
            </label>
            {usingOwn && <input value={ownLabel} onChange={(e) => setOwnLabel(e.target.value)} placeholder="Name the option you’re choosing" style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginLeft: 24 }} />}
          </div>

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>In your words, what are you deciding?</p>
          <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} placeholder="e.g. I’m committing my posting time to LinkedIn for the next 30 days." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>Why (optional)</p>
          <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} placeholder="Your reasoning — kept as your own words." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>How reversible is this?</p>
          <select value={reversibility} onChange={(e) => setReversibility(e.target.value as typeof reversibility)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '6px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }}>
            <option value="UNKNOWN">I’m not sure</option><option value="REVERSIBLE">Easily reversible</option>
            <option value="COSTLY_TO_REVERSE">Costly to reverse</option><option value="IRREVERSIBLE">Effectively irreversible</option>
          </select>

          {insufficient && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={ackInsufficient} onChange={(e) => setAckInsufficient(e.target.checked)} />
              <span>I understand there wasn’t enough evidence for a grounded recommendation, and I’m deciding anyway.</span>
            </label>
          )}

          <p style={{ ...meta, marginTop: 14, fontStyle: 'italic' }}>This records your decision. It does not create a commitment or plan.</p>
          {error && <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--danger-ink, #a33)', marginTop: 6 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 'var(--sp-3)' }}>
            <Button loading={saving} disabled={!canConfirm} onClick={() => void confirm()}>Confirm this decision</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// A Strategic Commitment — a SEPARATE, later founder act on a recorded decision. Bounded (scope + review/expiry/exit),
// with visible cost and exclusivity. It is NOT a plan or tasks, NOT a promise to Business Brain. Lifecycle stays neutral.
const SCOPES: CommitmentScope[] = ['DECISION_SCOPE', 'CHANNEL', 'OFFER', 'POSITIONING', 'MARKETING', 'STRATEGIC_JOB', 'BUSINESS'];
const EXCLUSIVITIES: { v: Exclusivity; label: string }[] = [
  { v: 'PREFERRED_DIRECTION', label: 'A preferred direction (alternatives stay open)' },
  { v: 'PARALLEL_EXPERIMENT_ALLOWED', label: 'Parallel experiments still allowed' },
  { v: 'DEPRIORITIZES_ALTERNATIVES', label: 'Deprioritises alternatives' },
  { v: 'EXCLUSIVE', label: 'Excludes alternatives' },
  { v: 'UNKNOWN', label: 'I’m not sure yet' },
];
function CommitmentPanel({ decision, on401 }: { decision: DecisionView; on401: (e: unknown) => void }) {
  const insufficient = decision.alignment === 'NO_RECOMMENDATION' || decision.acknowledgedInsufficientEvidence;
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const [scope, setScope] = useState<CommitmentScope>('DECISION_SCOPE');
  const [exclusivity, setExclusivity] = useState<Exclusivity>('PREFERRED_DIRECTION');
  const [governed, setGoverned] = useState('');
  const [reviewAt, setReviewAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [exit, setExit] = useState('');
  const [cost, setCost] = useState('');
  const [ackInsufficient, setAckInsufficient] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<CommitmentView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasBoundary = !!reviewAt || !!expiresAt || exit.trim().length > 0;
  const canConfirm = statement.trim().length > 0 && hasBoundary && (!insufficient || ackInsufficient);

  const confirm = async () => {
    setSaving(true); setError(null);
    try {
      const c = await createCommitment(decision.logicalDecisionId, {
        statement: statement.trim(), scope, exclusivity,
        governedBehavior: governed.trim() ? governed.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        acceptedCosts: cost.trim() ? [{ statement: cost.trim(), source: 'FOUNDER_CONFIRMED', confirmed: true }] : [],
        exitConditions: exit.trim() ? exit.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        reviewAt: reviewAt ? new Date(reviewAt).toISOString() : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        acknowledgedInsufficientEvidence: insufficient ? ackInsufficient : undefined,
        idempotencyKey: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
      });
      setSaved(c); setOpen(false);
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setError(e instanceof ApiError ? e.message : 'Could not record the commitment.'); }
    finally { setSaving(false); }
  };

  if (saved) {
    return (
      <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px dashed var(--line-2)' }}>
        <span style={sectionLabel}>Your commitment on record</span>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink)', margin: '4px 0 0' }}>{saved.statement}</p>
        <p style={{ ...meta, marginTop: 4 }}>Scope: {saved.scope === 'DECISION_SCOPE' ? decision.chosenOption.label : saved.scope} · {saved.exclusivity.replace(/_/g, ' ').toLowerCase()}{saved.reviewAt ? ` · review ${new Date(saved.reviewAt).toLocaleDateString()}` : ''}{saved.expiresAt ? ` · expires ${new Date(saved.expiresAt).toLocaleDateString()}` : ''}</p>
        <p style={{ ...meta, marginTop: 8, fontStyle: 'italic' }}>This is a strategic commitment. It does not create a plan or tasks. You can review, supersede, release, or retire it.</p>
        {/* A plan is a SEPARATE, later act — a commitment does not become one automatically (Law 1). */}
        <PlanPanel commitment={saved} on401={on401} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px dashed var(--line-2)' }}>
      {!open ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="ghost" onClick={() => setOpen(true)}>Create a commitment from this decision</Button>
          <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>A commitment lets this decision govern your conduct for a bounded scope and period. It’s a separate step — and not a plan.</span>
        </div>
      ) : (
        <div>
          <span style={sectionLabel}>Create a commitment</span>
          <p style={{ ...meta, marginTop: 2 }}>You decided: <strong style={{ color: 'var(--ink-2)' }}>{decision.chosenOption.label}</strong>. A commitment means letting that govern your conduct — bounded, reviewable, and yours to leave.</p>

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>What are you committing to, in your words?</p>
          <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} placeholder="e.g. I’ll keep LinkedIn as my primary channel until the review date, without reopening the choice." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
            <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>Scope<br />
              <select value={scope} onChange={(e) => setScope(e.target.value as CommitmentScope)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '6px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginTop: 4 }}>
                {SCOPES.map((s) => <option key={s} value={s}>{s === 'DECISION_SCOPE' ? 'Same as the decision' : s.toLowerCase()}</option>)}
              </select>
            </label>
            <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>Exclusivity<br />
              <select value={exclusivity} onChange={(e) => setExclusivity(e.target.value as Exclusivity)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '6px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginTop: 4 }}>
                {EXCLUSIVITIES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
              </select>
            </label>
          </div>

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>What behaviour does it govern? (optional, one per line — not tasks)</p>
          <textarea value={governed} onChange={(e) => setGoverned(e.target.value)} rows={2} placeholder="e.g. Don’t reopen the channel choice before review." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>A cost you accept (optional)</p>
          <input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. Less flexibility to chase a new channel this quarter." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
            <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>Review on<br /><input type="date" value={reviewAt} onChange={(e) => setReviewAt(e.target.value)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '5px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginTop: 4 }} /></label>
            <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>Or expires on<br /><input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '5px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginTop: 4 }} /></label>
          </div>
          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>How you’ll exit or reconsider (one per line)</p>
          <textarea value={exit} onChange={(e) => setExit(e.target.value)} rows={2} placeholder="e.g. If demo volume drops below 5/week for a month, I reopen this." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />
          {!hasBoundary && <p style={{ ...meta, marginTop: 4 }}>Add a review date, an expiry, or an exit condition — a commitment has to be bounded.</p>}

          {insufficient && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={ackInsufficient} onChange={(e) => setAckInsufficient(e.target.checked)} />
              <span>This decision was made without enough evidence. I’m committing anyway, with that in mind.</span>
            </label>
          )}

          <p style={{ ...meta, marginTop: 14, fontStyle: 'italic' }}>This creates a strategic commitment. It does not create a plan or tasks. You can review, supersede, release, or retire it.</p>
          {error && <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--danger-ink, #a33)', marginTop: 6 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 'var(--sp-3)' }}>
            <Button loading={saving} disabled={!canConfirm} onClick={() => void confirm()}>Confirm this commitment</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// A Strategic Plan — a SEPARATE, later founder act on an effective commitment. Bounded (milestones + review/exit),
// with visible assumptions/dependencies/conflicts. It is NOT execution, tasks, or a calendar. Founder-activated.
const PLAN_SCOPES: PlanScope[] = ['COMMITMENT_SCOPE', 'CHANNEL', 'OFFER', 'POSITIONING', 'MARKETING', 'STRATEGIC_JOB', 'BUSINESS'];
const SEVERITY_LABEL: Record<string, string> = { BLOCKING: 'blocks activation', REVIEW_REQUIRED: 'needs review', NON_BLOCKING: 'noted', UNKNOWN: 'unknown' };
function PlanPanel({ commitment, on401 }: { commitment: CommitmentView; on401: (e: unknown) => void }) {
  const insufficient = commitment.alignmentAtCommitment === 'NO_RECOMMENDATION' || commitment.acknowledgedInsufficientEvidence || (commitment.groundingStatusAtCommitment != null && commitment.groundingStatusAtCommitment !== 'GROUNDED');
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [intent, setIntent] = useState('');
  const [scope, setScope] = useState<PlanScope>('COMMITMENT_SCOPE');
  const [milestones, setMilestones] = useState('');   // one per line
  const [assumptions, setAssumptions] = useState(''); // one per line (all UNKNOWN unless founder edits later)
  const [review, setReview] = useState('');
  const [exit, setExit] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [ackInsufficient, setAckInsufficient] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<PlanView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const milestoneLines = milestones.split('\n').map((s) => s.trim()).filter(Boolean);
  const hasBoundary = !!review.trim() || !!exit.trim() || !!expiresAt;
  const canActivate = title.trim().length > 0 && intent.trim().length > 0 && (milestoneLines.length > 0) && hasBoundary && (!insufficient || ackInsufficient);

  const activate = async () => {
    setSaving(true); setError(null);
    try {
      const p = await createPlan(commitment.logicalCommitmentId, {
        title: title.trim(), strategicIntent: intent.trim(), scope,
        milestones: milestoneLines.map((label, i) => ({ label, intendedState: '', sequence: i + 1 })),
        assumptions: assumptions.split('\n').map((s) => s.trim()).filter(Boolean).map((statement) => ({ statement, status: 'UNKNOWN' as const })),
        reviewConditions: review.trim() ? review.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        exitConditions: exit.trim() ? exit.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        acknowledgedInsufficientEvidence: insufficient ? ackInsufficient : undefined,
        idempotencyKey: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
      });
      setSaved(p); setOpen(false);
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setError(e instanceof ApiError ? e.message : 'Could not activate the plan.'); }
    finally { setSaving(false); }
  };

  if (saved) {
    return (
      <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px dashed var(--line-2)' }}>
        <span style={sectionLabel}>Your active plan</span>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink)', margin: '4px 0 0' }}>{saved.title}</p>
        <ul style={ulReset}>{saved.milestones.map((m) => <li key={m.id} style={{ ...meta, marginTop: 2 }}>{m.sequence}. {m.label}</li>)}</ul>
        {saved.conflicts.filter((c) => c.severity !== 'NON_BLOCKING').map((c, i) => <p key={i} style={{ ...meta, marginTop: 4, color: 'var(--warn-ink, var(--ink-3))' }}>· {c.description} ({SEVERITY_LABEL[c.severity]})</p>)}
        <p style={{ ...meta, marginTop: 8, fontStyle: 'italic' }}>This plan is active. It does not execute work or create tasks. You can supersede, retire, or cancel it.</p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px dashed var(--line-2)' }}>
      {!open ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="ghost" onClick={() => setOpen(true)}>Create a plan</Button>
          <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>A plan lays out how you intend to act on this commitment. It’s a separate step — and it doesn’t execute anything.</span>
        </div>
      ) : (
        <div>
          <span style={sectionLabel}>Create a plan</span>
          <p style={{ ...meta, marginTop: 2 }}>Your commitment: <strong style={{ color: 'var(--ink-2)' }}>{commitment.statement}</strong>. A plan translates it into intended moves — bounded, reviewable, and not execution.</p>

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>Plan title</p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 30-day LinkedIn cadence" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />
          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>What is this plan for, in your words?</p>
          <textarea value={intent} onChange={(e) => setIntent(e.target.value)} rows={2} placeholder="How you intend to translate the commitment into coordinated action." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          <label style={{ display: 'block', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', marginTop: 12 }}>Scope<br />
            <select value={scope} onChange={(e) => setScope(e.target.value as PlanScope)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '6px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginTop: 4 }}>
              {PLAN_SCOPES.map((s) => <option key={s} value={s}>{s === 'COMMITMENT_SCOPE' ? 'Same as the commitment' : s.toLowerCase()}</option>)}
            </select>
          </label>

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>Milestones — meaningful checkpoints, one per line (not tasks)</p>
          <textarea value={milestones} onChange={(e) => setMilestones(e.target.value)} rows={3} placeholder={'Establish a 3x/week posting rhythm\nCapture inbound demo requests in one place'} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>Assumptions you’re making (optional, one per line — kept as unverified)</p>
          <textarea value={assumptions} onChange={(e) => setAssumptions(e.target.value)} rows={2} placeholder="e.g. My posting cadence is sustainable for 30 days." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>Review on<br /><input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '5px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginTop: 4 }} /></label>
          </div>
          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>Review conditions (one per line)</p>
          <textarea value={review} onChange={(e) => setReview(e.target.value)} rows={2} placeholder="e.g. Review the plan at 30 days." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />
          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>Exit conditions (one per line)</p>
          <textarea value={exit} onChange={(e) => setExit(e.target.value)} rows={2} placeholder="e.g. Abandon if demo volume drops below 5/week for a month." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />
          {!hasBoundary && <p style={{ ...meta, marginTop: 4 }}>Add a review date, a review condition, or an exit condition — a plan has to be bounded.</p>}

          {insufficient && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={ackInsufficient} onChange={(e) => setAckInsufficient(e.target.checked)} />
              <span>This lineage was decided without enough evidence. I’m planning anyway, with that in mind.</span>
            </label>
          )}

          <p style={{ ...meta, marginTop: 14, fontStyle: 'italic' }}>This activates a plan. It does not execute tasks or create calendar events.</p>
          {error && <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--danger-ink, #a33)', marginTop: 6 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 'var(--sp-3)' }}>
            <Button loading={saving} disabled={!canActivate} onClick={() => void activate()}>Activate this plan</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
          </div>
        </div>
      )}
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
