import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  createStrategySession, getStrategySession, listStrategySessions, retryStrategySession, respondToStrategy, createDecision, createCommitment, createPlan, createPlanReview, createLearning, listLearningThreads, getLearningThread, refineLearning, contestLearning, supersedeLearning, retireLearning, promoteRevision, replacePromotion, removePromotion, getPromotedInto, getEffectiveBusinessUnderstanding, getEffectiveFounderStrategicContext, ApiError,
  type StrategySessionView, type StrategyBoundary, type StrategicRecommendation, type InsufficientStrategicEvidence,
  type StrategyResponseType, type EpistemicKind, type Band, type EvidenceReference,
  type DecisionView, type DecisionAlternative, type ChosenOptionSource,
  type CommitmentView, type CommitmentScope, type Exclusivity,
  type PlanView, type PlanScope,
  type PlanReviewView, type ReviewConclusion, type ReviewDisposition, type AssumptionAssessment, type DependencyAssessment, type MilestoneAssessment,
  type LearningView, type LearningCategory, type LearningConfidence, type LearningScope, type LearningThreadView,
  type PromotionTarget, type PromotionScope, type PromotionView,
  type EffectiveBusinessUnderstanding, type EffectiveFounderStrategicContext,
  createContextSnapshot, listContextSnapshots, type SnapshotView,
  listPlans, getPlan, getEffectiveExecution, addExecutionReport, correctExecutionReport, withdrawExecutionReport, listExecutionReports,
  type ExecutionState, type EffectiveExecutionResponse, type ExecutionReportView, type EvidenceType,
  addOutcomeReview, listOutcomeReviews, type OutcomeReviewView, type ObservedOutcome,
  proposeLearningCandidate, reviseLearningCandidate, listLearningCandidates, judgeLearningCandidate, type OutcomeLearningCandidateView, type CandidateInput, type CandidateVerdict,
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
  // ADR-014 remediation — the Consumption Gate is mandatory: a recommendation can only be generated FROM an immutable
  // Context Snapshot. The ask box requires the founder to select one (created below); there is no live-context path.
  const [snapshots, setSnapshots] = useState<SnapshotView[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string>('');

  const on401 = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) navigate('/signin', { replace: true }); }, [navigate]);

  const loadSnapshots = useCallback(async () => {
    try { const snaps = await listContextSnapshots(); setSnapshots(snaps); setSelectedSnapshot((cur) => cur || (snaps[0]?.snapshotId ?? '')); }
    catch (e) { on401(e); }
  }, [on401]);
  useEffect(() => { if (founderId) void loadSnapshots(); }, [founderId, loadSnapshots]);
  useEffect(() => { const h = () => void loadSnapshots(); window.addEventListener('bb:snapshot-changed', h); return () => window.removeEventListener('bb:snapshot-changed', h); }, [loadSnapshots]);

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
    if (!question.trim() || busy || !selectedSnapshot) return; // mandatory Consumption Gate — a snapshot is required
    setBusy(true); setBoundary(null); setSession(null);
    try {
      const res = await createStrategySession(question.trim(), selectedSnapshot);
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
          {/* ADR-014 remediation — mandatory Consumption Gate: reasoning runs ONLY from a frozen snapshot you select. */}
          <div style={{ marginTop: 'var(--sp-3)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ ...meta }} htmlFor="snapshot-select">Reason from snapshot:</label>
            <select id="snapshot-select" data-testid="ask-snapshot-select" value={selectedSnapshot} onChange={(e) => setSelectedSnapshot(e.target.value)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '6px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }}>
              <option value="">— select a context snapshot —</option>
              {snapshots.map((s) => <option key={s.snapshotId} value={s.snapshotId}>{new Date(s.createdAt).toLocaleString()} · {s.contentHash.slice(0, 12)}…</option>)}
            </select>
            <Button variant="primary" loading={busy} disabled={!selectedSnapshot || !question.trim()} onClick={() => void ask()}><span data-testid="ask-generate">Reason it through</span></Button>
          </div>
          {snapshots.length === 0 && <p data-testid="ask-no-snapshot" style={{ ...meta, marginTop: 6 }}>Create a context snapshot below first — recommendations reason only from a frozen snapshot, never live context.</p>}
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
            {/* ADR-014 remediation — snapshot binding + reproducibility provenance, or a legacy label for old sessions. */}
            {session.isSnapshotReproducible && session.generationProvenance ? (
              <div data-testid="session-snapshot-binding" style={{ ...meta, marginBottom: 'var(--sp-3)', paddingLeft: 8, borderLeft: '2px solid var(--line)' }}>
                Reasoned from snapshot <span data-testid="session-snapshot-hash">{session.generationProvenance.contextSnapshotHash.slice(0, 12)}…</span> · strategist {session.generationProvenance.strategistVersion} · model {session.generationProvenance.modelId} · prompt {session.generationProvenance.promptTemplateHash.slice(0, 8)}… · later context changes will not alter this recommendation.
              </div>
            ) : (session.contextSnapshotId == null && session.status !== 'PROCESSING' && session.status !== 'QUEUED') ? (
              <div data-testid="session-legacy-badge" style={{ ...meta, marginBottom: 'var(--sp-3)', paddingLeft: 8, borderLeft: '2px solid var(--warn-ink)' }}>
                Legacy live-context session — <strong>not snapshot-reproducible</strong>. To get a reproducible answer, create a new context snapshot below and generate a new recommendation.
              </div>
            ) : null}
            {session.status === 'READY' && session.recommendation && <RecommendationView session={session} onResponded={onResponded} on401={on401} />}
            {session.status === 'INSUFFICIENT_EVIDENCE' && session.insufficient && <><InsufficientView data={session.insufficient} onAddContext={() => navigate('/understand')} /><div style={{ marginTop: 'var(--sp-4)' }}><DecisionPanel session={session} on401={on401} /></div></>}
            {session.status === 'FAILED' && (
              <div style={card}>
                <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', margin: 0 }}>{session.message ?? 'Something went wrong. Nothing was lost.'}</p>
                {/* Retry only for governed (snapshot-bound) sessions — a legacy session cannot regenerate live. */}
                {session.retryable && session.contextSnapshotId && <div style={{ marginTop: 'var(--sp-3)' }}><Button variant="secondary" onClick={() => void retry()}>Try again</Button></div>}
                {session.retryable && !session.contextSnapshotId && <p data-testid="legacy-no-retry" style={{ ...meta, marginTop: 8 }}>This legacy session can’t regenerate live — create a new snapshot below and generate a new recommendation.</p>}
              </div>
            )}
          </div>
        )}

        <PlansPanel on401={on401} />
        <LearningsList on401={on401} />

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
        {/* Review is a SEPARATE, later act — it changes nothing (Law 13). */}
        <ReviewPanel plan={saved} on401={on401} />
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

// A Strategic Plan Review — a SEPARATE, later founder act on an exact plan revision. The original plan is shown read-only;
// the founder records observations and assesses each assumption/dependency/milestone, then a conclusion + intended
// disposition. It changes NOTHING — no plan/commitment lifecycle, no execution/tasks/scores. Neutral throughout.
const CONCLUSIONS: { v: ReviewConclusion; label: string }[] = [
  { v: 'PLAN_REMAINS_COHERENT', label: 'The plan still holds together' },
  { v: 'PLAN_NEEDS_REVISION', label: 'The plan needs revision' },
  { v: 'PLAN_NO_LONGER_COHERENT', label: 'The plan no longer holds together' },
  { v: 'MIXED_EVIDENCE', label: 'Mixed evidence' },
  { v: 'COMMITMENT_REVIEW_NEEDED', label: 'The commitment itself needs a look' },
  { v: 'INSUFFICIENT_INFORMATION', label: 'Not enough information yet' },
];
const DISPOSITIONS: { v: ReviewDisposition; label: string }[] = [
  { v: 'CONTINUE_CURRENT_PLAN', label: 'Continue the current plan' },
  { v: 'GATHER_MORE_INFORMATION', label: 'Gather more information' },
  { v: 'CREATE_REVISED_PLAN', label: 'Create a revised plan (later, separately)' },
  { v: 'SUPERSEDE_PLAN', label: 'Supersede the plan (later, separately)' },
  { v: 'RECONSIDER_COMMITMENT', label: 'Reconsider the commitment (later, separately)' },
  { v: 'ABANDON_PLAN', label: 'Abandon the plan' },
  { v: 'RETIRE_PLAN', label: 'Retire the plan' },
  { v: 'TAKE_NO_ACTION', label: 'Take no action for now' },
];
const A_ASSESS: AssumptionAssessment[] = ['NOT_REVIEWED', 'STILL_UNKNOWN', 'SUPPORTED', 'PARTIALLY_SUPPORTED', 'CONTRADICTED', 'NO_LONGER_RELEVANT'];
const D_ASSESS: DependencyAssessment[] = ['NOT_REVIEWED', 'AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN', 'NO_LONGER_REQUIRED'];
const M_ASSESS: MilestoneAssessment[] = ['NOT_REVIEWED', 'EVIDENCE_NOT_AVAILABLE', 'CONDITION_NOT_MET', 'CONDITION_PARTIALLY_MET', 'CONDITION_MET', 'CONDITION_NO_LONGER_RELEVANT', 'CONDITION_CANNOT_BE_DETERMINED'];
const nice = (s: string) => s.replace(/_/g, ' ').toLowerCase();
function ReviewPanel({ plan, on401 }: { plan: PlanView; on401: (e: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const [observations, setObservations] = useState(''); // one per line, founder-reported
  const [aAssess, setAAssess] = useState<Record<number, AssumptionAssessment>>({});
  const [dAssess, setDAssess] = useState<Record<number, DependencyAssessment>>({});
  const [mAssess, setMAssess] = useState<Record<string, MilestoneAssessment>>({});
  const [unknowns, setUnknowns] = useState('');
  const [conclusion, setConclusion] = useState<ReviewConclusion | ''>('');
  const [disposition, setDisposition] = useState<ReviewDisposition | ''>('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<PlanReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRecord = !!conclusion && !!disposition;

  const record = async () => {
    setSaving(true); setError(null);
    try {
      const r = await createPlanReview(plan.logicalPlanId, {
        planRecordId: plan.planId,
        reviewStatement: statement.trim() || null,
        observations: observations.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => ({ statement: s, sourceType: 'FOUNDER_REPORTED' as const })),
        assumptionAssessments: Object.entries(aAssess).filter(([, v]) => v !== 'NOT_REVIEWED').map(([i, v]) => ({ originalIndex: Number(i), assessment: v })),
        dependencyAssessments: Object.entries(dAssess).filter(([, v]) => v !== 'NOT_REVIEWED').map(([i, v]) => ({ originalIndex: Number(i), assessment: v })),
        milestoneAssessments: Object.entries(mAssess).filter(([, v]) => v !== 'NOT_REVIEWED').map(([id, v]) => ({ milestoneId: id, assessment: v })),
        unresolvedUnknowns: unknowns.split('\n').map((s) => s.trim()).filter(Boolean),
        reviewConclusion: conclusion as ReviewConclusion, selectedDisposition: disposition as ReviewDisposition,
        idempotencyKey: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
      });
      setSaved(r); setOpen(false);
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setError(e instanceof ApiError ? e.message : 'Could not record the review.'); }
    finally { setSaving(false); }
  };

  if (saved) {
    return (
      <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px dashed var(--line-2)' }}>
        <span style={sectionLabel}>Your review on record</span>
        <p style={{ ...meta, marginTop: 4 }}>Conclusion: {nice(saved.reviewConclusion)} · You intend to: {nice(saved.selectedDisposition)}</p>
        <p style={{ ...meta, marginTop: 8, fontStyle: 'italic' }}>This recorded your review. It did not change the plan or commitment. Any next step is a separate, explicit action.</p>
        <LearningPanel review={saved} on401={on401} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px dashed var(--line-2)' }}>
      {!open ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="ghost" onClick={() => setOpen(true)}>Review this plan</Button>
          <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>A review records what’s changed and what you make of it. It changes nothing on its own.</span>
        </div>
      ) : (
        <div>
          <span style={sectionLabel}>Review this plan</span>
          <p style={{ ...meta, marginTop: 2 }}>Reviewing: <strong style={{ color: 'var(--ink-2)' }}>{plan.title}</strong> (revision {plan.revision}). The plan below is shown as it was — your review won’t change it.</p>

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>What have you observed since activating it? (one per line — your own report)</p>
          <textarea value={observations} onChange={(e) => setObservations(e.target.value)} rows={2} placeholder="e.g. Posted 12 times; 3 demo requests came in." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          {plan.milestones.length > 0 && <>
            <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>Your milestones — is the strategic state there yet?</p>
            {plan.milestones.map((m) => (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', flex: 1 }}>{m.label}</span>
                <select value={mAssess[m.id] ?? 'NOT_REVIEWED'} onChange={(e) => setMAssess({ ...mAssess, [m.id]: e.target.value as MilestoneAssessment })} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', padding: '4px 6px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }}>{M_ASSESS.map((a) => <option key={a} value={a}>{nice(a)}</option>)}</select>
              </div>
            ))}
          </>}

          {plan.assumptions.length > 0 && <>
            <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>Your assumptions — do they still hold?</p>
            {plan.assumptions.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', flex: 1 }}>{a.statement}</span>
                <select value={aAssess[i] ?? 'NOT_REVIEWED'} onChange={(e) => setAAssess({ ...aAssess, [i]: e.target.value as AssumptionAssessment })} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', padding: '4px 6px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }}>{A_ASSESS.map((v) => <option key={v} value={v}>{nice(v)}</option>)}</select>
              </div>
            ))}
          </>}

          {plan.dependencies.length > 0 && <>
            <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>Your dependencies — where do they stand?</p>
            {plan.dependencies.map((d, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', flex: 1 }}>{d.statement}</span>
                <select value={dAssess[i] ?? 'NOT_REVIEWED'} onChange={(e) => setDAssess({ ...dAssess, [i]: e.target.value as DependencyAssessment })} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', padding: '4px 6px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }}>{D_ASSESS.map((v) => <option key={v} value={v}>{nice(v)}</option>)}</select>
              </div>
            ))}
          </>}

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>What’s still unknown? (one per line)</p>
          <textarea value={unknowns} onChange={(e) => setUnknowns(e.target.value)} rows={2} placeholder="e.g. Whether this pace is sustainable another month." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '12px 0 4px' }}>Anything else you want to note?</p>
          <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} placeholder="Your read on where this plan stands." style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />

          {/* conclusion + disposition kept visually separate */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
            <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>What do you conclude?<br />
              <select aria-label="Review conclusion" value={conclusion} onChange={(e) => setConclusion(e.target.value as ReviewConclusion)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '6px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginTop: 4, maxWidth: 300 }}><option value="">Choose…</option>{CONCLUSIONS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}</select>
            </label>
            <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>What do you intend to do?<br />
              <select aria-label="Review disposition" value={disposition} onChange={(e) => setDisposition(e.target.value as ReviewDisposition)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '6px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginTop: 4, maxWidth: 300 }}><option value="">Choose…</option>{DISPOSITIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}</select>
            </label>
          </div>

          <p style={{ ...meta, marginTop: 14, fontStyle: 'italic' }}>This records your review. It does not change the plan or commitment.</p>
          {error && <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--danger-ink, #a33)', marginTop: 6 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 'var(--sp-3)' }}>
            <Button loading={saving} disabled={!canRecord} onClick={() => void record()}>Record this review</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Not now</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const LEARNING_CATEGORIES: { v: LearningCategory; label: string }[] = [
  { v: 'MARKET', label: 'The market' }, { v: 'CUSTOMER', label: 'Customers' }, { v: 'POSITIONING', label: 'Positioning' },
  { v: 'OFFER', label: 'The offer' }, { v: 'EXECUTION', label: 'Execution' }, { v: 'DECISION_PROCESS', label: 'How you decide' },
  { v: 'RESOURCE', label: 'Resources' }, { v: 'RISK', label: 'Risk' }, { v: 'ASSUMPTION', label: 'An assumption' },
  { v: 'STRATEGY', label: 'Strategy' }, { v: 'OTHER', label: 'Something else' },
];
const LEARNING_CONFIDENCES: { v: LearningConfidence; label: string }[] = [
  { v: 'PROVISIONAL', label: 'Provisional — an early read, not yet settled' },
  { v: 'SUPPORTED', label: 'Supported — evidence backs it (not proven)' },
  { v: 'CONTESTED', label: 'Contested — the evidence is mixed' },
  { v: 'INSUFFICIENT_INFORMATION', label: 'Insufficient information — can’t be justified yet' },
];
const LEARNING_SCOPES: { v: LearningScope; label: string; broad?: boolean }[] = [
  { v: 'THIS_CHANNEL', label: 'This channel' }, { v: 'THIS_OFFER', label: 'This offer' },
  { v: 'THIS_POSITIONING', label: 'This positioning' }, { v: 'THIS_DECISION', label: 'This decision' },
  { v: 'MULTIPLE_OFFERS', label: 'Multiple offers', broad: true }, { v: 'MULTIPLE_MARKETS', label: 'Multiple markets', broad: true },
  { v: 'BUSINESS', label: 'The whole business', broad: true }, { v: 'FOUNDER_STRATEGY', label: 'My overall strategy', broad: true },
  { v: 'OPERATING_MODEL', label: 'The operating model', broad: true }, { v: 'OTHER', label: 'Something else' },
];
const BROAD_SCOPE_VALUES = new Set(LEARNING_SCOPES.filter((s) => s.broad).map((s) => s.v));
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const taStyle = { width: '100%', boxSizing: 'border-box' as const, fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginTop: 4 };
const selStyle = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '6px 8px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', marginTop: 4, maxWidth: 320 };
const lblStyle = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', display: 'block' as const };

// Strategic Learning Record — a founder-EXPLICIT decision to KEEP a durable understanding FROM a review (initial
// CREATE-only slice). Most reviews create NO learning; this is offered, never automatic. It changes nothing else: not the
// review, not Business Understanding, not Founder Strategic Context. The model does not create learning here. (This is
// creation, not "promotion" — promotion into BU/FSC is a separate future capability.)
function LearningPanel({ review, on401, onKept }: { review: PlanReviewView; on401: (e: unknown) => void; onKept?: () => void }) {
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const [prior, setPrior] = useState('');
  const [revised, setRevised] = useState('');
  const [change, setChange] = useState('');
  const [category, setCategory] = useState<LearningCategory | ''>('');
  const [confidence, setConfidence] = useState<LearningConfidence | ''>('');
  const [scope, setScope] = useState<LearningScope | ''>('');
  const [broadAck, setBroadAck] = useState(false);
  const [causal, setCausal] = useState(false);
  const [boundary, setBoundary] = useState('');
  const [counter, setCounter] = useState('');
  const [unknowns, setUnknowns] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<LearningView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBroad = !!scope && BROAD_SCOPE_VALUES.has(scope);
  const canKeep = !!statement.trim() && !!prior.trim() && !!revised.trim() && !!change.trim() && !!category && !!confidence && !!scope && (!isBroad || broadAck);

  const keep = async () => {
    setSaving(true); setError(null);
    try {
      const l = await createLearning(review.reviewId, {
        learningStatement: statement.trim(), learningCategory: category as LearningCategory, confidence: confidence as LearningConfidence,
        priorUnderstanding: prior.trim(), revisedUnderstanding: revised.trim(), changeStatement: change.trim(),
        learningScope: scope as LearningScope, broadScopeAcknowledged: broadAck, isCausalHypothesis: causal,
        boundaryConditions: lines(boundary), counterEvidence: lines(counter), unresolvedUnknowns: lines(unknowns),
        idempotencyKey: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())),
      });
      setSaved(l); setOpen(false); onKept?.(); try { window.dispatchEvent(new Event('bb:learning-kept')); } catch { /* noop */ }
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setError(e instanceof ApiError ? e.message : 'Could not keep this learning.'); }
    finally { setSaving(false); }
  };

  if (saved) {
    return (
      <div data-testid="learning-saved" style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-2)', borderTop: '1px dotted var(--line-2)' }}>
        <span style={sectionLabel}>Durable strategic learning</span>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-1)', marginTop: 4 }}>“{saved.learningStatement}”</p>
        <p style={{ ...meta, marginTop: 4 }}>Before: {saved.priorUnderstanding} · Now: {saved.revisedUnderstanding}</p>
        <p style={{ ...meta, marginTop: 4 }}>About: {nice(saved.learningCategory)} · How settled: {nice(saved.confidence)} · Applies to: {nice(saved.learningScope)} · {saved.origin === 'OUTCOME_REVIEW' ? 'From a retrospective outcome review' : `From review ${saved.review.recordId}`}</p>
        <p style={{ ...meta, marginTop: 8, fontStyle: 'italic' }}>You chose to keep this as a durable learning. It does not modify Business Understanding. It does not modify Founder Strategic Context.</p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-2)', borderTop: '1px dotted var(--line-2)' }}>
      {!open ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="ghost" onClick={() => setOpen(true)} data-testid="open-learning">Record a learning from this review</Button>
          <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>Only if this review changed what you durably understand. Most reviews won’t.</span>
        </div>
      ) : (
        <div data-testid="learning-form">
          <span style={sectionLabel}>Record a durable learning</span>
          <p style={{ ...meta, marginTop: 2 }}>In your own words, what did this review durably change in how you understand your business? Leave this if nothing durable changed.</p>

          <label style={lblStyle}>What you’re keeping
            <textarea data-testid="learning-statement" value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} placeholder="e.g. Founder-led outreach converts; paid ads at our stage don’t." style={taStyle} /></label>
          <label style={{ ...lblStyle, marginTop: 10 }}>What you understood before
            <textarea data-testid="learning-prior" value={prior} onChange={(e) => setPrior(e.target.value)} rows={2} placeholder="What you believed going in." style={taStyle} /></label>
          <label style={{ ...lblStyle, marginTop: 10 }}>What you understand now
            <textarea data-testid="learning-revised" value={revised} onChange={(e) => setRevised(e.target.value)} rows={2} placeholder="What you understand after this review." style={taStyle} /></label>
          <label style={{ ...lblStyle, marginTop: 10 }}>What changed
            <textarea data-testid="learning-change" value={change} onChange={(e) => setChange(e.target.value)} rows={2} placeholder="How your understanding actually shifted." style={taStyle} /></label>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            <label style={lblStyle}>What is this learning about?<br />
              <select data-testid="learning-category" aria-label="Learning category" value={category} onChange={(e) => setCategory(e.target.value as LearningCategory)} style={selStyle}><option value="">Choose…</option>{LEARNING_CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}</select></label>
            <label style={lblStyle}>How settled is it?<br />
              <select data-testid="learning-confidence" aria-label="Learning confidence" value={confidence} onChange={(e) => setConfidence(e.target.value as LearningConfidence)} style={selStyle}><option value="">Choose…</option>{LEARNING_CONFIDENCES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}</select></label>
            <label style={lblStyle}>How widely does it apply?<br />
              <select data-testid="learning-scope" aria-label="Learning scope" value={scope} onChange={(e) => { setScope(e.target.value as LearningScope); setBroadAck(false); }} style={selStyle}><option value="">Choose…</option>{LEARNING_SCOPES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}</select></label>
          </div>

          {isBroad && (
            <label data-testid="broad-scope-ack" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={broadAck} onChange={(e) => setBroadAck(e.target.checked)} />
              <span>I understand I’m generalizing this learning beyond the source review, and that’s intended.</span>
            </label>
          )}

          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', cursor: 'pointer' }}>
            <input type="checkbox" data-testid="causal-flag" checked={causal} onChange={(e) => setCausal(e.target.checked)} />
            <span>This is a claim that one thing <em>caused</em> another (a causal hypothesis).</span>
          </label>

          <label style={{ ...lblStyle, marginTop: 12 }}>When does it hold? (boundary conditions, one per line)
            <textarea data-testid="learning-boundary" value={boundary} onChange={(e) => setBoundary(e.target.value)} rows={2} placeholder="e.g. Only while the founder can do outreach personally." style={taStyle} /></label>
          <label style={{ ...lblStyle, marginTop: 10 }}>What cuts against it? (counter-evidence, one per line)
            <textarea data-testid="learning-counter" value={counter} onChange={(e) => setCounter(e.target.value)} rows={2} placeholder="Evidence that complicates this learning." style={taStyle} /></label>
          <label style={{ ...lblStyle, marginTop: 10 }}>What’s still unknown? (one per line)
            <textarea data-testid="learning-unknowns" value={unknowns} onChange={(e) => setUnknowns(e.target.value)} rows={2} placeholder="Open questions this learning doesn’t settle." style={taStyle} /></label>

          <p style={{ ...meta, marginTop: 14, fontStyle: 'italic' }}>This creates a durable strategic learning. It does not modify Business Understanding. It does not modify Founder Strategic Context.</p>
          {error && <p data-testid="learning-error" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--danger-ink, #a33)', marginTop: 6 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 'var(--sp-3)' }}>
            <Button loading={saving} disabled={!canKeep} onClick={() => void keep()} data-testid="keep-learning">Keep this learning</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Nothing to keep</Button>
          </div>
        </div>
      )}
    </div>
  );
}

const lcBtn = { cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', padding: '4px 10px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--ink-2)' };
const DOES_NOT = 'This does not update Business Understanding. This does not update Founder Strategic Context. This does not change the source review, plan, commitment, or decision.';

// A single lifecycle action form (Refine / Contest / Supersede / Retire) on one thread. Founder chooses; no model.
function LifecycleForm({ thread, verb, onDone, onCancel, on401 }: { thread: LearningThreadView; verb: 'refine' | 'contest' | 'supersede' | 'retire'; onDone: () => void; onCancel: () => void; on401: (e: unknown) => void }) {
  const [reason, setReason] = useState('');
  const [statement, setStatement] = useState(verb === 'supersede' ? '' : thread.learningStatement);
  const [position, setPosition] = useState(thread.revisedUnderstanding);
  // pre-fill existing counterevidence / unknowns so contesting ADDS to them rather than silently dropping (Laws 14/15)
  const [counter, setCounter] = useState(thread.counterEvidence.join('\n'));
  const [unknowns, setUnknowns] = useState(thread.unresolvedUnknowns.join('\n'));
  const [basis, setBasis] = useState('');
  const [replacementSummary, setReplacementSummary] = useState('');
  const [retained, setRetained] = useState('');
  const [confirmSame, setConfirmSame] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const base = () => ({ sourceRevisionId: thread.learningId, expectedRevision: thread.revision, idempotencyKey: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())), lifecycleReason: reason.trim() });

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      if (verb === 'refine') await refineLearning(thread.logicalLearningId, { ...base(), confirmSameLearning: confirmSame, learningStatement: statement.trim() });
      else if (verb === 'contest') await contestLearning(thread.logicalLearningId, { ...base(), revisedUnderstanding: position.trim(), counterEvidence: lines(counter), unresolvedUnknowns: lines(unknowns), contestBasisExplanation: basis.trim() || undefined });
      else if (verb === 'supersede') await supersedeLearning(thread.logicalLearningId, { ...base(), confirmSameLearning: confirmSame, learningStatement: statement.trim(), replacementSummary: replacementSummary.trim(), retainedValidity: retained.trim() });
      else await retireLearning(thread.logicalLearningId, base());
      try { window.dispatchEvent(new Event('bb:lifecycle-changed')); } catch { /* noop */ }
      onDone();
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setError(e instanceof ApiError ? e.message : 'Could not save this change.'); }
    finally { setSaving(false); }
  };

  const copy: Record<string, string[]> = {
    refine: ['Clarify or bound this learning while preserving its history.', 'This creates a new revision. It does not rewrite the earlier learning.', 'This should still be the same underlying learning. Create a separate learning if the new statement is independently useful.'],
    contest: ['Record that this learning should no longer be treated as straightforwardly usable.', 'Contesting preserves the learning, your reasons, and the unresolved disagreement.', 'No second learning or contradiction relationship is required.'],
    supersede: ['Replace this learning for future use while preserving all earlier revisions.', 'Use this only when the replacement belongs to the same underlying learning.', 'Create a separate learning if it is a genuinely independent claim.'],
    retire: ['Stop using this learning prospectively without replacing its history.', 'Retirement does not delete the learning.'],
  };
  return (
    <div data-testid={`form-${verb}`} style={{ marginTop: 8, padding: 10, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }}>
      <span style={sectionLabel}>{verb[0]!.toUpperCase() + verb.slice(1)}</span>
      {copy[verb]!.map((c, i) => <p key={i} style={{ ...meta, marginTop: 2 }}>{c}</p>)}
      {verb === 'supersede' && <label style={lblStyle}>Replacement learning statement<textarea data-testid={`${verb}-statement`} value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} style={taStyle} /></label>}
      {verb === 'refine' && <label style={lblStyle}>The learning (clarified)<textarea data-testid={`${verb}-statement`} value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} style={taStyle} /></label>}
      {verb === 'contest' && <label style={{ ...lblStyle, marginTop: 8 }}>Where you now stand<textarea data-testid="contest-position" value={position} onChange={(e) => setPosition(e.target.value)} rows={2} style={taStyle} /></label>}
      {verb === 'contest' && <>
        <label style={{ ...lblStyle, marginTop: 8 }}>Counter-evidence (one per line)<textarea data-testid="contest-counter" value={counter} onChange={(e) => setCounter(e.target.value)} rows={2} style={taStyle} /></label>
        <label style={{ ...lblStyle, marginTop: 8 }}>Or unresolved unknowns (one per line)<textarea data-testid="contest-unknowns" value={unknowns} onChange={(e) => setUnknowns(e.target.value)} rows={2} style={taStyle} /></label>
        <label style={{ ...lblStyle, marginTop: 8 }}>Or explain why neither can be stated yet<textarea data-testid="contest-basis" value={basis} onChange={(e) => setBasis(e.target.value)} rows={2} style={taStyle} /></label>
      </>}
      {verb === 'supersede' && <>
        <label style={{ ...lblStyle, marginTop: 8 }}>What changed and why the replacement is appropriate<textarea data-testid="supersede-summary" value={replacementSummary} onChange={(e) => setReplacementSummary(e.target.value)} rows={2} style={taStyle} /></label>
        <label style={{ ...lblStyle, marginTop: 8 }}>What remains valid from the previous version<textarea data-testid="supersede-retained" value={retained} onChange={(e) => setRetained(e.target.value)} rows={2} style={taStyle} /></label>
      </>}
      <label style={{ ...lblStyle, marginTop: 8 }}>{verb === 'retire' ? 'Reason for retiring' : verb === 'contest' ? 'Why you’re contesting it' : 'Why you’re making this change'}<textarea data-testid={`${verb}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={taStyle} /></label>
      {(verb === 'refine' || verb === 'supersede') && (
        <label data-testid={`${verb}-confirm`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', cursor: 'pointer' }}>
          <input type="checkbox" data-testid={`${verb}-confirm-input`} checked={confirmSame} onChange={(e) => setConfirmSame(e.target.checked)} />
          <span>This is still the same underlying learning.</span>
        </label>
      )}
      <p style={{ ...meta, marginTop: 10, fontStyle: 'italic' }}>{DOES_NOT}</p>
      {error && <p data-testid={`${verb}-error`} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--danger-ink, #a33)', marginTop: 6 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button type="button" data-testid={`${verb}-submit`} disabled={saving} onClick={() => void submit()} style={{ ...lcBtn, background: 'var(--ink)', color: 'var(--surface)', borderColor: 'var(--ink)' }}>{saving ? 'Saving…' : `${verb[0]!.toUpperCase() + verb.slice(1)} this learning`}</button>
        <button type="button" onClick={onCancel} style={lcBtn}>Cancel</button>
      </div>
    </div>
  );
}

const PROMOTION_SCOPES: { v: PromotionScope; label: string }[] = [
  { v: 'OFFER', label: 'Offer' }, { v: 'CUSTOMER', label: 'Customer' }, { v: 'PRICING', label: 'Pricing' }, { v: 'POSITIONING', label: 'Positioning' },
  { v: 'MESSAGING', label: 'Messaging' }, { v: 'ACQUISITION', label: 'Acquisition' }, { v: 'RETENTION', label: 'Retention' },
  { v: 'BUSINESS', label: 'The whole business' }, { v: 'FOUNDER', label: 'Founder strategy' }, { v: 'OTHER', label: 'Something else' },
];
const TARGET_LABEL: Record<PromotionTarget, string> = { BUSINESS_UNDERSTANDING: 'Business Understanding', FOUNDER_STRATEGIC_CONTEXT: 'Founder Strategic Context' };
// Founder-facing PURPOSE of promotion (the domain still calls this a promotion event into BU/FSC).
const PROMOTE_PURPOSE: Record<PromotionTarget, string> = { BUSINESS_UNDERSTANDING: 'Let future decisions use this', FOUNDER_STRATEGIC_CONTEXT: 'Apply to your whole strategy' };

// Promotion is governance, not evidence — an explicit founder act pinning an EXACT learning revision into BU/FSC. It
// modifies nothing else and regenerates nothing.
function PromotionForm({ revisionId, target, action, onDone, onCancel, on401 }: { revisionId: string; target: PromotionTarget; action: 'promote' | 'replace' | 'remove'; onDone: () => void; onCancel: () => void; on401: (e: unknown) => void }) {
  const [scope, setScope] = useState<PromotionScope | ''>('');
  const [rationale, setRationale] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const input = { target, scope: scope as PromotionScope, rationale: rationale.trim(), idempotencyKey: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())) };
      if (action === 'promote') await promoteRevision(revisionId, input);
      else if (action === 'replace') await replacePromotion(revisionId, input);
      else await removePromotion(revisionId, input);
      try { window.dispatchEvent(new Event('bb:promotion-changed')); } catch { /* noop */ }
      onDone();
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setError(e instanceof ApiError ? e.message : 'Could not save this promotion.'); }
    finally { setSaving(false); }
  };
  const verb = action === 'promote' ? 'Promote to' : action === 'replace' ? 'Replace' : 'Remove from';
  return (
    <div data-testid="promotion-form" style={{ marginTop: 6, padding: 10, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }}>
      <span style={sectionLabel}>{verb} {TARGET_LABEL[target]}</span>
      <p style={{ ...meta, marginTop: 2 }}>This affects {TARGET_LABEL[target]}. This does NOT modify the learning. This does NOT modify review, plan, commitment or decision.</p>
      <label style={lblStyle}>What is this promotion about?<br />
        <select data-testid="promotion-scope" aria-label="Promotion scope" value={scope} onChange={(e) => setScope(e.target.value as PromotionScope)} style={selStyle}><option value="">Choose…</option>{PROMOTION_SCOPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</select></label>
      <label style={{ ...lblStyle, marginTop: 8 }}>Why should this shape your {TARGET_LABEL[target]}?<textarea data-testid="promotion-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} style={taStyle} /></label>
      {error && <p data-testid="promotion-error" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--danger-ink, #a33)', marginTop: 6 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button type="button" data-testid="promotion-submit" disabled={saving || !scope || !rationale.trim()} onClick={() => void submit()} style={{ ...lcBtn, background: 'var(--ink)', color: 'var(--surface)', borderColor: 'var(--ink)' }}>{saving ? 'Saving…' : `${verb} ${TARGET_LABEL[target]}`}</button>
        <button type="button" onClick={onCancel} style={lcBtn}>Cancel</button>
      </div>
    </div>
  );
}

function ThreadCard({ thread, promoted, on401 }: { thread: LearningThreadView; promoted: Partial<Record<PromotionTarget, string>>; on401: (e: unknown) => void }) {
  const [open, setOpen] = useState<null | 'refine' | 'contest' | 'supersede' | 'retire'>(null);
  const [promo, setPromo] = useState<null | { revisionId: string; target: PromotionTarget; action: 'promote' | 'replace' | 'remove' }>(null);
  const [history, setHistory] = useState<LearningThreadView[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const loadHistory = async () => {
    try { const { revisions } = await getLearningThread(thread.logicalLearningId); setHistory(revisions); setShowHistory(true); }
    catch (e) { if (e instanceof ApiError && e.status === 401) on401(e); }
  };
  const retired = thread.lifecycleStatus === 'RETIRED';
  const targets: PromotionTarget[] = ['BUSINESS_UNDERSTANDING', 'FOUNDER_STRATEGIC_CONTEXT'];
  const tkey = (t: PromotionTarget) => (t === 'BUSINESS_UNDERSTANDING' ? 'bu' : 'fsc');
  return (
    <div data-testid={`thread-${thread.logicalLearningId}`} style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-2)', borderTop: '1px dotted var(--line-2)' }}>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-1)' }}>“{thread.learningStatement}”</p>
      <p style={{ ...meta, marginTop: 4 }}>Lifecycle: <strong data-testid="lifecycle-status" style={{ color: 'var(--ink-2)' }}>{nice(thread.lifecycleStatus)}</strong> · How settled: {nice(thread.confidence)} · Applies to: {nice(thread.learningScope)} · rev {thread.revision} · <span data-testid="thread-source-review">{thread.origin === 'OUTCOME_REVIEW' ? 'from a retrospective outcome review' : `from review ${thread.review.recordId}`}</span></p>
      {thread.boundaryConditions.length > 0 && <p style={{ ...meta, marginTop: 4 }}>Holds when: {thread.boundaryConditions.join('; ')}</p>}
      {thread.counterEvidence.length > 0 && <p style={{ ...meta, marginTop: 4 }}>Cuts against: {thread.counterEvidence.join('; ')}</p>}
      {thread.unresolvedUnknowns.length > 0 && <p style={{ ...meta, marginTop: 4 }}>Still unknown: {thread.unresolvedUnknowns.join('; ')}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button type="button" data-testid="toggle-history" onClick={() => (showHistory ? setShowHistory(false) : void loadHistory())} style={lcBtn}>{showHistory ? 'Hide history' : 'Show history'}</button>
        {!retired && <>
          <button type="button" data-testid="action-refine" onClick={() => setOpen('refine')} style={lcBtn}>Refine</button>
          <button type="button" data-testid="action-contest" onClick={() => setOpen('contest')} style={lcBtn}>Contest</button>
          <button type="button" data-testid="action-supersede" onClick={() => setOpen('supersede')} style={lcBtn}>Supersede</button>
          <button type="button" data-testid="action-retire" onClick={() => setOpen('retire')} style={lcBtn}>Retire</button>
        </>}
        {retired && <span data-testid="retired-note" style={{ ...meta }}>Retired — no further lifecycle actions. Record a new learning instead.</span>}
      </div>
      {open && <LifecycleForm thread={thread} verb={open} onDone={() => setOpen(null)} onCancel={() => setOpen(null)} on401={on401} />}
      {showHistory && history && (
        <div data-testid="thread-history" style={{ marginTop: 10, paddingLeft: 10, borderLeft: '2px solid var(--line-2)' }}>
          {history.map((r) => (
            <div key={r.learningId} data-testid={`revision-${r.revision}`} style={{ marginTop: 6 }}>
              <p style={{ ...meta }}>rev {r.revision} · {r.lifecycleAction} → {nice(r.lifecycleStatus)} · {nice(r.confidence)}{r.lifecycleReason ? ` · ${r.lifecycleReason}` : ''}</p>
              <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-xs)', color: 'var(--ink-2)' }}>“{r.learningStatement}”</p>
              {r.replacementSummary && <p style={{ ...meta }}>Replacement: {r.replacementSummary} · Retained: {r.retainedValidity}</p>}
              {/* Promotion controls per revision (ADR-013) */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                {targets.map((t) => {
                  const pinned = promoted[t];
                  if (!pinned) return <button key={t} type="button" data-testid={`promote-${tkey(t)}-rev-${r.revision}`} onClick={() => setPromo({ revisionId: r.learningId, target: t, action: 'promote' })} style={lcBtn}>{PROMOTE_PURPOSE[t]}</button>;
                  if (pinned === r.learningId) return <span key={t} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><span data-testid={`promoted-here-${tkey(t)}`} style={{ ...meta }}>✓ {PROMOTE_PURPOSE[t]}</span><button type="button" data-testid={`remove-${tkey(t)}-rev-${r.revision}`} onClick={() => setPromo({ revisionId: r.learningId, target: t, action: 'remove' })} style={lcBtn}>Stop using it</button></span>;
                  return <button key={t} type="button" data-testid={`replace-${tkey(t)}-rev-${r.revision}`} onClick={() => setPromo({ revisionId: r.learningId, target: t, action: 'replace' })} style={lcBtn}>Use this version instead</button>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {promo && <PromotionForm revisionId={promo.revisionId} target={promo.target} action={promo.action} onDone={() => setPromo(null)} onCancel={() => setPromo(null)} on401={on401} />}
    </div>
  );
}

function PromotedInto({ target, items }: { target: PromotionTarget; items: PromotionView[] }) {
  if (!items.length) return <p data-testid={`promoted-${target === 'BUSINESS_UNDERSTANDING' ? 'bu' : 'fsc'}-empty`} style={{ ...meta, marginTop: 4 }}>Nothing promoted into {TARGET_LABEL[target]} yet.</p>;
  return (
    <div data-testid={`promoted-${target === 'BUSINESS_UNDERSTANDING' ? 'bu' : 'fsc'}`} style={{ marginTop: 4 }}>
      {items.map((p) => (
        <div key={p.promotionId} data-testid={`promoted-${target === 'BUSINESS_UNDERSTANDING' ? 'bu' : 'fsc'}-${p.learning.logicalLearningId}`} style={{ marginTop: 6 }}>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-1)' }}>“{p.learning.statement ?? ''}”</p>
          <p style={{ ...meta, marginTop: 2 }}>Promoted revision {p.learning.revision} · about {nice(p.scope)} · {p.rationale}</p>
        </div>
      ))}
    </div>
  );
}

// CANONICAL "current effective BU/FSC" (ADR-013 remediation) — native records + promoted learning revisions, composed by
// the authoritative composer. Native and promoted items are clearly badged; promoted items show the EXACT revision,
// rationale, and scope. This is the single authoritative answer; the "Promotion history" list below is for audit.
function badge(bg: string): React.CSSProperties { return { display: 'inline-block', fontSize: '0.62rem', letterSpacing: '0.04em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 4, background: bg, color: 'var(--paper)', fontFamily: 'var(--sans)' }; }
function PromotedLine({ p, target }: { p: EffectiveBusinessUnderstanding['promotedLearningItems'][number]; target: 'bu' | 'fsc' }) {
  return (
    <div data-testid={`effective-${target}-promoted-${p.provenance.logicalLearningId}`} style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid var(--accent, #8a6d3b)' }}>
      <span style={badge('var(--accent, #8a6d3b)')} data-testid={`effective-${target}-promoted-badge`}>Promoted learning</span>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-1)', marginTop: 4 }}>“{p.content}”</p>
      <p style={{ ...meta, marginTop: 2 }}>
        <span data-testid={`effective-${target}-revision`}>Revision {p.provenance.learningRevisionNumber}</span> · about {nice(p.scope)} · {p.rationale}
        <span style={{ marginLeft: 6, opacity: 0.8 }}>· epistemic {nice(p.provenance.epistemicStatus)} · lifecycle {nice(p.provenance.lifecycleStatusAtRead)}</span>
      </p>
    </div>
  );
}
function CanonicalEffectiveContext({ on401 }: { on401: (e: unknown) => void }) {
  const [bu, setBu] = useState<EffectiveBusinessUnderstanding | null>(null);
  const [fsc, setFsc] = useState<EffectiveFounderStrategicContext | null>(null);
  const load = useCallback(async () => {
    try { const [b, f] = await Promise.all([getEffectiveBusinessUnderstanding(), getEffectiveFounderStrategicContext()]); setBu(b); setFsc(f); }
    catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } }
  }, [on401]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const h = () => void load(); const evs = ['bb:learning-kept', 'bb:lifecycle-changed', 'bb:promotion-changed']; for (const ev of evs) window.addEventListener(ev, h); return () => { for (const ev of evs) window.removeEventListener(ev, h); }; }, [load]);
  if (!bu || !fsc) return null;
  return (
    <section data-testid="effective-context" style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line)' }}>
      <span style={sectionLabel}>Current effective Business Understanding</span>
      <p style={{ ...meta, marginTop: 2 }}>Your native understanding plus any learning revisions you have explicitly promoted. Promotion changes what this shows — it does not rewrite your native understanding.</p>
      <div data-testid="effective-bu" style={{ marginTop: 6 }}>
        <div>
          <span style={badge('var(--ink-2, #555)')} data-testid="effective-bu-native-badge">Native understanding</span>
          {bu.nativeBusinessUnderstanding.present
            ? <ul data-testid="effective-bu-native" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{bu.nativeBusinessUnderstanding.conclusions.map((c) => <li key={c.id} style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-1)' }}>{c.statement}</li>)}</ul>
            : <p data-testid="effective-bu-native-empty" style={{ ...meta, marginTop: 4 }}>No native Business Understanding yet.</p>}
        </div>
        {bu.promotedLearningItems.length === 0
          ? <p data-testid="effective-bu-promoted-empty" style={{ ...meta, marginTop: 8 }}>No promoted learnings in your Business Understanding.</p>
          : bu.promotedLearningItems.map((p) => <PromotedLine key={p.id} p={p} target="bu" />)}
      </div>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <span style={sectionLabel}>Current effective Founder Strategic Context</span>
        <div data-testid="effective-fsc" style={{ marginTop: 6 }}>
          <span style={badge('var(--ink-2, #555)')} data-testid="effective-fsc-native-badge">Native context</span>
          {fsc.nativeItems.length === 0
            ? <p data-testid="effective-fsc-native-empty" style={{ ...meta, marginTop: 4 }}>No native Founder Strategic Context yet.</p>
            : <ul data-testid="effective-fsc-native" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{fsc.nativeItems.map((i) => <li key={i.id} style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-1)' }}>{i.content}</li>)}</ul>}
          {fsc.promotedLearningItems.length === 0
            ? <p data-testid="effective-fsc-promoted-empty" style={{ ...meta, marginTop: 8 }}>No promoted learnings in your Founder Strategic Context.</p>
            : fsc.promotedLearningItems.map((p) => <PromotedLine key={p.id} p={p} target="fsc" />)}
        </div>
      </div>
    </section>
  );
}

// CONSUMPTION GATE (ADR-014). A Context Snapshot is the ONLY reasoning input: an explicit, immutable freeze of the current
// Effective BU + FSC. Creating one is a founder act; it mutates nothing and regenerates nothing. A recommendation may then
// be generated FROM a snapshot (reasoning consumes the frozen snapshot, never live context) — a separate explicit act.
function ContextSnapshots({ on401 }: { on401: (e: unknown) => void }) {
  const [snaps, setSnaps] = useState<SnapshotView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [generatedFrom, setGeneratedFrom] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setSnaps(await listContextSnapshots()); } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setSnaps([]); }
  }, [on401]);
  useEffect(() => { void load(); }, [load]);
  const create = async () => {
    setBusy(true);
    try { await createContextSnapshot(); await load(); try { window.dispatchEvent(new Event('bb:snapshot-changed')); } catch { /* noop */ } }
    catch (e) { if (e instanceof ApiError && e.status === 401) on401(e); }
    finally { setBusy(false); }
  };
  const generate = async (snapshotId: string) => {
    setBusy(true);
    try { await createStrategySession('What should I prioritise for my main channel in the next 30 days?', snapshotId); setGeneratedFrom(snapshotId); }
    catch (e) { if (e instanceof ApiError && e.status === 401) on401(e); }
    finally { setBusy(false); }
  };
  if (!snaps) return null;
  return (
    <section data-testid="context-snapshots" style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line)' }}>
      <span style={sectionLabel}>Context snapshots</span>
      <p style={{ ...meta, marginTop: 2 }}>A snapshot freezes your current effective Business Understanding and Founder Strategic Context. Recommendations reason over a frozen snapshot — never live context. Creating a snapshot changes nothing and regenerates nothing.</p>
      <button type="button" data-testid="create-snapshot" onClick={() => void create()} disabled={busy} style={{ ...lcBtn, marginTop: 8 }}>Create context snapshot</button>
      {snaps.length === 0
        ? <p data-testid="snapshots-empty" style={{ ...meta, marginTop: 8 }}>No snapshots yet.</p>
        : <div data-testid="snapshot-list" style={{ marginTop: 8 }}>
            {snaps.map((s) => (
              <div key={s.snapshotId} data-testid={`snapshot-${s.snapshotId}`} style={{ marginTop: 10, paddingLeft: 8, borderLeft: '2px solid var(--line)' }}>
                <p style={{ ...meta }}>
                  <span data-testid={`snapshot-hash-${s.snapshotId}`}>Hash {s.contentHash}</span> · frozen {new Date(s.createdAt).toLocaleString()}
                </p>
                <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-1)', marginTop: 2 }}>
                  <span data-testid={`snapshot-bu-count-${s.snapshotId}`}>Business Understanding: {s.businessUnderstanding.conclusions.length} conclusions ({s.businessUnderstanding.promotedCount} promoted)</span>
                  {' · '}
                  <span data-testid={`snapshot-fsc-promoted-${s.snapshotId}`}>{s.founderStrategicContext.promotedLearnings.length} promoted strategic-context learnings</span>
                </p>
                <button type="button" data-testid={`generate-from-snapshot-${s.snapshotId}`} onClick={() => void generate(s.snapshotId)} disabled={busy} style={{ ...lcBtn, marginTop: 4 }}>Generate recommendation from this snapshot</button>
                {generatedFrom === s.snapshotId && <span data-testid={`generated-from-${s.snapshotId}`} style={{ ...meta, marginLeft: 8 }}>Recommendation generating from this frozen snapshot…</span>}
              </div>
            ))}
          </div>}
    </section>
  );
}

// EXECUTION BOUNDARY (ADR-015). A truthful, founder-reported execution-accounting section, kept structurally DISTINCT from
// the Plan (intention). The product performs and verifies NOTHING: every report is founder testimony. No progress %, no
// completion ring, no streaks/scores, no warning colours for non-reporting. States are shown as "Reported …" — never a
// bare "Completed" — and evidence is "supplied — not verified".
const EXEC_STATES: ExecutionState[] = ['NOT_STARTED', 'ATTEMPTED', 'COMPLETED', 'BLOCKED', 'ABANDONED', 'NOT_APPLICABLE'];
const EVIDENCE_TYPES_UI: EvidenceType[] = ['NOTE', 'URL', 'FILE_REFERENCE', 'METRIC_OBSERVATION', 'EXTERNAL_REFERENCE'];
function newKey(): string { return `exec-${Math.random().toString(36).slice(2)}-${Date.now()}`; }

function ExecReportForm({ plan, milestoneId, mode, headReportId, onDone, onCancel, on401 }: { plan: PlanView; milestoneId: string; mode: 'report' | 'correct'; headReportId: string | null; onDone: () => void; onCancel: () => void; on401: (e: unknown) => void }) {
  const [state, setState] = useState<ExecutionState>('ATTEMPTED');
  const [statement, setStatement] = useState('');
  const [evType, setEvType] = useState<EvidenceType>('NOTE');
  const [evValue, setEvValue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!statement.trim() || busy) return;
    setBusy(true);
    const evidence = evValue.trim() ? [{ type: evType, value: evValue.trim(), label: null }] : [];
    try {
      const input = { subjectType: 'MILESTONE' as const, subjectId: milestoneId, executionState: state, founderStatement: statement.trim(), evidenceReferences: evidence, idempotencyKey: newKey() };
      if (mode === 'report') await addExecutionReport(plan.planId, input);
      else await correctExecutionReport(plan.planId, headReportId!, input);
      onDone();
    } catch (e) { if (e instanceof ApiError && e.status === 401) on401(e); } finally { setBusy(false); }
  };
  return (
    <div data-testid={`exec-form-${milestoneId}`} style={{ marginTop: 8, padding: 10, border: '1px solid var(--line-2)', borderRadius: 'var(--r-1)' }}>
      <p style={{ ...meta }}>This records <strong>your report</strong>. Business Brain has not independently verified this action.</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <select data-testid="exec-report-state" value={state} onChange={(e) => setState(e.target.value as ExecutionState)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', padding: '4px 6px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }}>{EXEC_STATES.map((s) => <option key={s} value={s}>{nice(s)}</option>)}</select>
      </div>
      <textarea data-testid="exec-report-statement" value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} placeholder="In your words, what happened?" style={{ width: '100%', boxSizing: 'border-box', marginTop: 6, fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
        <span style={{ ...meta }}>Evidence (supplied — not verified):</span>
        <select data-testid="exec-evidence-type" value={evType} onChange={(e) => setEvType(e.target.value as EvidenceType)} style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', padding: '4px 6px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }}>{EVIDENCE_TYPES_UI.map((t) => <option key={t} value={t}>{nice(t)}</option>)}</select>
        <input data-testid="exec-evidence-value" value={evValue} onChange={(e) => setEvValue(e.target.value)} placeholder="note / URL / reference" style={{ flex: 1, minWidth: 160, fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', padding: '4px 6px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)' }} />
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button type="button" data-testid="exec-report-submit" onClick={() => void submit()} disabled={busy || !statement.trim()} style={lcBtn}>{mode === 'report' ? 'Save report' : 'Save correction'}</button>
        <button type="button" onClick={onCancel} style={lcBtn}>Cancel</button>
      </div>
    </div>
  );
}

function ExecutionAccounting({ plan, on401 }: { plan: PlanView; on401: (e: unknown) => void }) {
  const [eff, setEff] = useState<EffectiveExecutionResponse | null>(null);
  const [form, setForm] = useState<{ milestoneId: string; mode: 'report' | 'correct'; head: string | null } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<ExecutionReportView[]>([]);
  const load = useCallback(async () => {
    try { setEff(await getEffectiveExecution(plan.planId)); } catch (e) { if (e instanceof ApiError && e.status === 401) on401(e); }
  }, [plan.planId, on401]);
  useEffect(() => { void load(); }, [load]);
  const openHistory = async (milestoneId: string) => {
    // Always refetch the latest history for this subject and show it (clicking again refreshes, never shows stale events).
    try { const all = await listExecutionReports(plan.planId); setHistory(all.filter((r) => r.subjectId === milestoneId)); setHistoryFor(milestoneId); }
    catch (e) { if (e instanceof ApiError && e.status === 401) on401(e); }
  };
  const withdraw = async (headReportId: string) => {
    try { await withdrawExecutionReport(plan.planId, headReportId, newKey()); await load(); }
    catch (e) { if (e instanceof ApiError && e.status === 401) on401(e); }
  };
  if (!eff) return null;
  return (
    <section data-testid={`execution-accounting-${plan.planId}`} style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--line)' }}>
      <span style={sectionLabel}>Founder-reported execution</span>
      <p style={{ ...meta, marginTop: 2 }}>This is separate from the plan (your intention). It records what <strong>you report</strong> — Business Brain has not verified any of it, and <strong>performed no action</strong>. Leaving an item unreported is fine.</p>
      {eff.milestones.length === 0 && <p style={{ ...meta, marginTop: 6 }}>This plan has no milestones to report on.</p>}
      {eff.milestones.map((m) => {
        const ex = m.execution;
        const reported = ex.reportedState !== 'NOT_REPORTED';
        return (
          <div key={m.milestoneId} data-testid={`exec-item-${m.milestoneId}`} style={{ marginTop: 10, paddingLeft: 8, borderLeft: '2px solid var(--line)' }}>
            <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-1)' }}>{m.label}</p>
            <p style={{ ...meta, marginTop: 2 }}>
              <span data-testid={`exec-state-${m.milestoneId}`} style={{ color: reported ? 'var(--ink-1)' : 'var(--ink-3)' }}>{ex.label}</span>
              {reported && <> · <span data-testid={`exec-unverified-${m.milestoneId}`}>Business Brain has not independently verified this action.</span> · <span>Not performed by Business Brain.</span></>}
            </p>
            {reported && ex.founderStatement && <p style={{ ...meta, marginTop: 2, fontStyle: 'italic' }}>“{ex.founderStatement}”</p>}
            {reported && ex.evidenceReferences.length > 0 && <p data-testid={`exec-evidence-${m.milestoneId}`} style={{ ...meta, marginTop: 2 }}>Evidence supplied — not verified: {ex.evidenceReferences.map((r) => `${nice(r.type)}: ${r.value}`).join(' · ')}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {!reported && <button type="button" data-testid={`exec-add-${m.milestoneId}`} onClick={() => setForm({ milestoneId: m.milestoneId, mode: 'report', head: null })} style={lcBtn}>Add execution report</button>}
              {reported && <button type="button" data-testid={`exec-correct-${m.milestoneId}`} onClick={() => setForm({ milestoneId: m.milestoneId, mode: 'correct', head: ex.headReportId })} style={lcBtn}>Correct latest report</button>}
              {reported && <button type="button" data-testid={`exec-withdraw-${m.milestoneId}`} onClick={() => void withdraw(ex.headReportId!)} style={lcBtn}>Withdraw</button>}
              <button type="button" data-testid={`exec-history-${m.milestoneId}`} onClick={() => void openHistory(m.milestoneId)} style={lcBtn}>Report history</button>
            </div>
            {form?.milestoneId === m.milestoneId && <ExecReportForm plan={plan} milestoneId={m.milestoneId} mode={form.mode} headReportId={form.head} onDone={() => { setForm(null); void load(); }} onCancel={() => setForm(null)} on401={on401} />}
            {historyFor === m.milestoneId && <div data-testid={`exec-history-list-${m.milestoneId}`} style={{ marginTop: 6 }}>{history.map((h) => <p key={h.reportId} style={{ ...meta }}>#{h.reportSequence} {h.reportKind} — {h.label}{h.founderStatement ? ` · “${h.founderStatement}”` : ''}</p>)}</div>}
          </div>
        );
      })}
    </section>
  );
}

// ADR-016 — Strategic Outcome Review. The ONLY place intended action + founder-reported execution + evidence + observed
// outcome are laid side by side, for one EXACT plan revision. An immutable historical assessment: it answers NO "what
// next", creates NO learning, changes nothing, and shows NO score/rating. UNKNOWN is displayed explicitly. A second review
// is a NEW immutable record; the first is never altered. Distinct from the mid-flight plan Review (ReviewPanel above).
const OUTCOME_OPTS: Array<{ v: ObservedOutcome; label: string }> = [
  { v: 'AS_INTENDED', label: 'As intended (as you report it)' }, { v: 'PARTIALLY_AS_INTENDED', label: 'Partially as intended' },
  { v: 'NOT_AS_INTENDED', label: 'Not as intended' }, { v: 'UNKNOWN', label: 'Unknown — not enough to say' },
];
// ADR-017 (V088) — the Strategic Learning Origination Gate, surfaced UNDER each outcome review. A candidate is an
// append-only REVISIONED PROPOSAL: it creates no learning. It becomes a learning ONLY via an explicit Adopt (which never
// promotes); the founder may Reject / Defer / Withdraw. Editing appends a new revision (history immutable).
type CandForm = { statement: string; founder: string; prior: string; revised: string; change: string; cat: LearningCategory | ''; scope: LearningScope | ''; epi: LearningConfidence | ''; unknowns: string; contradictions: string; obs: Record<string, boolean> };
const emptyForm = (): CandForm => ({ statement: '', founder: '', prior: '', revised: '', change: '', cat: '', scope: '', epi: '', unknowns: '', contradictions: '', obs: {} });
function LearningCandidatesForReview({ review, planId, seq, on401 }: { review: OutcomeReviewView; planId: string; seq: number; on401: (e: unknown) => void }) {
  const reviewId = review.reviewId;
  const [cands, setCands] = useState<OutcomeLearningCandidateView[] | null>(null);
  const [mode, setMode] = useState<{ kind: 'propose' } | { kind: 'edit'; logicalId: string } | null>(null);
  const [f, setF] = useState<CandForm>(emptyForm());
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const tid = `${planId}-${seq}`;
  // founder verbs for the internal statuses (domain keeps PROPOSED/DEFERRED/ADOPTED/REJECTED/WITHDRAWN)
  const statusLabel = (st: string) => st === 'PROPOSED' ? 'Possible learning' : st === 'DEFERRED' ? 'Not yet' : st === 'ADOPTED' ? 'Kept' : 'Discarded';
  const reportedObs = review.assessment.reported.map((r) => ({ kind: 'REPORTED' as const, ref: r.subjectId, statement: `${r.subjectId}: ${r.reportedState}` }));
  const load = useCallback(async () => {
    try { setCands(await listLearningCandidates(reviewId)); } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setCands([]); }
  }, [reviewId, on401]);
  useEffect(() => { void load(); }, [load]);
  const toInput = (): CandidateInput => ({
    candidateStatement: f.statement.trim(), founderStatement: f.founder.trim(), priorUnderstanding: f.prior.trim(), revisedUnderstanding: f.revised.trim(), changeStatement: f.change.trim(),
    learningCategory: f.cat as LearningCategory, applicabilityScope: f.scope as LearningScope, epistemicStatus: f.epi as LearningConfidence,
    selectedObservations: reportedObs.filter((o) => f.obs[o.ref]), unknownMarkers: f.unknowns.split('\n').map((u) => u.trim()).filter(Boolean), contradictionMarkers: f.contradictions.split('\n').map((u) => u.trim()).filter(Boolean),
    expectedSourceHash: review.reproducibility.contentHash, idempotencyKey: newKey(),
  });
  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      if (mode?.kind === 'edit') await reviseLearningCandidate(mode.logicalId, toInput()); else await proposeLearningCandidate(reviewId, toInput());
      setMode(null); setF(emptyForm()); await load();
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setErr(e instanceof ApiError ? e.message : 'Could not save.'); } finally { setBusy(false); }
  };
  const judge = async (revisionId: string, verdict: CandidateVerdict) => {
    setErr(''); setBusy(true);
    try { await judgeLearningCandidate(revisionId, verdict, `${verdict} by founder`, newKey()); await load(); if (verdict === 'ADOPT') { try { window.dispatchEvent(new Event('bb:learning-kept')); } catch { /* noop */ } } }
    catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setErr(e instanceof ApiError ? e.message : 'Could not record judgment.'); } finally { setBusy(false); }
  };
  if (!cands) return null;
  const nonTerminal = (s: string) => s === 'PROPOSED' || s === 'DEFERRED';
  const formBlock = (idPrefix: string) => (
    <div data-testid={`candidate-form-${idPrefix}`} style={{ marginTop: 6 }}>
      <label style={{ ...meta, display: 'block' }}>The learning this retrospective suggests (a proposal — creates nothing yet)<textarea data-testid={`cand-statement-${idPrefix}`} value={f.statement} onChange={(e) => setF({ ...f, statement: e.target.value })} rows={2} style={taStyle} /></label>
      <label style={{ ...meta, display: 'block', marginTop: 4 }}>In your own words<textarea data-testid={`cand-founder-${idPrefix}`} value={f.founder} onChange={(e) => setF({ ...f, founder: e.target.value })} rows={1} style={taStyle} /></label>
      <label style={{ ...meta, display: 'block', marginTop: 4 }}>Before<textarea data-testid={`cand-prior-${idPrefix}`} value={f.prior} onChange={(e) => setF({ ...f, prior: e.target.value })} rows={1} style={taStyle} /></label>
      <label style={{ ...meta, display: 'block', marginTop: 4 }}>Now<textarea data-testid={`cand-revised-${idPrefix}`} value={f.revised} onChange={(e) => setF({ ...f, revised: e.target.value })} rows={1} style={taStyle} /></label>
      <label style={{ ...meta, display: 'block', marginTop: 4 }}>What changed<textarea data-testid={`cand-change-${idPrefix}`} value={f.change} onChange={(e) => setF({ ...f, change: e.target.value })} rows={1} style={taStyle} /></label>
      <label style={{ ...meta, display: 'block', marginTop: 4 }}>What remains unknown (one per line)<textarea data-testid={`cand-unknowns-${idPrefix}`} value={f.unknowns} onChange={(e) => setF({ ...f, unknowns: e.target.value })} rows={1} style={taStyle} /></label>
      <label style={{ ...meta, display: 'block', marginTop: 4 }}>What cuts against it (one per line)<textarea data-testid={`cand-contradictions-${idPrefix}`} value={f.contradictions} onChange={(e) => setF({ ...f, contradictions: e.target.value })} rows={1} style={taStyle} /></label>
      {reportedObs.length > 0 && <div style={{ ...meta, marginTop: 4 }}>Select observations from this retrospective:{reportedObs.map((o) => <label key={o.ref} style={{ display: 'inline-flex', gap: 4, marginLeft: 8 }}><input type="checkbox" data-testid={`cand-obs-${idPrefix}-${o.ref}`} checked={!!f.obs[o.ref]} onChange={(e) => setF({ ...f, obs: { ...f.obs, [o.ref]: e.target.checked } })} />{o.statement}</label>)}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
        <select data-testid={`cand-category-${idPrefix}`} aria-label="Category" value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value as LearningCategory })} style={selStyle}><option value="">Category…</option>{LEARNING_CATEGORIES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select>
        <select data-testid={`cand-scope-${idPrefix}`} aria-label="Scope" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as LearningScope })} style={selStyle}><option value="">How widely…</option>{LEARNING_SCOPES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select>
        <select data-testid={`cand-epistemic-${idPrefix}`} aria-label="Epistemic status" value={f.epi} onChange={(e) => setF({ ...f, epi: e.target.value as LearningConfidence })} style={selStyle}><option value="">How settled…</option>{LEARNING_CONFIDENCES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select>
      </div>
      {err && <p data-testid={`candidate-error-${idPrefix}`} style={{ ...meta, color: 'var(--warn-ink)', marginTop: 4 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <Button variant="primary" loading={busy} disabled={!f.statement.trim() || !f.founder.trim() || !f.prior.trim() || !f.revised.trim() || !f.change.trim() || !f.cat || !f.scope || !f.epi} onClick={() => void submit()}><span data-testid={`candidate-submit-${idPrefix}`}>{mode?.kind === 'edit' ? 'Save a new revision' : 'Propose'}</span></Button>
        <button type="button" data-testid={`candidate-cancel-${idPrefix}`} onClick={() => { setMode(null); setF(emptyForm()); setErr(''); }} style={lcBtn}>Cancel</button>
      </div>
    </div>
  );
  return (
    <div data-testid={`candidates-${tid}`} style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px dotted var(--line-2)' }}>
      <p style={{ ...meta }}>A <strong>possible learning</strong> is just a suggestion from this retrospective — you can keep it, set it aside, or discard it. Keeping it never shares it with future decisions on its own.</p>
      {cands.length === 0 && <p data-testid={`candidates-none-${tid}`} style={{ ...meta, marginTop: 2 }}>Nothing suggested yet.</p>}
      {cands.map((c) => (
        <div key={c.logicalCandidateId} data-testid={`candidate-${c.logicalCandidateId}`} style={{ marginTop: 6 }}>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-1)' }}>“{c.candidateStatement}” <span style={{ ...meta }}>· <span data-testid={`candidate-status-${c.logicalCandidateId}`}>{statusLabel(c.status)}</span> · v<span data-testid={`candidate-rev-${c.logicalCandidateId}`}>{c.revision}</span></span></p>
          <p style={{ ...meta, marginTop: 2 }}>Appears true when: {nice(c.applicabilityScope)}</p>
          <p data-testid={`candidate-unknown-${c.logicalCandidateId}`} style={{ ...meta, marginTop: 2 }}>Still unknown: {c.unknownMarkers.join('; ') || 'nothing noted'}</p>
          <p data-testid={`candidate-cuts-${c.logicalCandidateId}`} style={{ ...meta, marginTop: 2 }}>Cuts against it: {c.contradictionMarkers.join('; ') || 'nothing noted'}</p>
          {nonTerminal(c.status) && mode === null && (
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <button type="button" data-testid={`candidate-adopt-${c.logicalCandidateId}`} onClick={() => void judge(c.candidateId, 'ADOPT')} disabled={busy} style={lcBtn}>Keep this learning</button>
              <button type="button" data-testid={`candidate-defer-${c.logicalCandidateId}`} onClick={() => void judge(c.candidateId, 'DEFER')} disabled={busy} style={lcBtn}>Not yet</button>
              <button type="button" data-testid={`candidate-reject-${c.logicalCandidateId}`} onClick={() => void judge(c.candidateId, 'REJECT')} disabled={busy} style={lcBtn}>Discard</button>
              <button type="button" data-testid={`candidate-edit-open-${c.logicalCandidateId}`} onClick={() => { setF({ statement: c.candidateStatement, founder: c.founderStatement, prior: c.priorUnderstanding, revised: c.revisedUnderstanding, change: c.changeStatement, cat: c.learningCategory as LearningCategory, scope: c.applicabilityScope as LearningScope, epi: c.epistemicStatus as LearningConfidence, unknowns: c.unknownMarkers.join('\n'), contradictions: c.contradictionMarkers.join('\n'), obs: Object.fromEntries(c.selectedObservations.map((o) => [o.ref, true])) }); setMode({ kind: 'edit', logicalId: c.logicalCandidateId }); }} style={lcBtn}>Revise</button>
              <button type="button" data-testid={`candidate-details-${c.logicalCandidateId}`} onClick={() => setExpanded((x) => ({ ...x, [c.logicalCandidateId]: !x[c.logicalCandidateId] }))} style={lcBtn}>{expanded[c.logicalCandidateId] ? 'Hide the full record' : 'Show the full record'}</button>
            </div>
          )}
          {expanded[c.logicalCandidateId] && (
            <div data-testid={`candidate-provenance-${c.logicalCandidateId}`} style={{ ...meta, marginTop: 4, color: 'var(--ink-3)', paddingLeft: 8, borderLeft: '2px solid var(--line-2)' }}>
              From this outcome review · frozen context {c.source.snapshotId.slice(0, 8)}… · source {c.source.outcomeReviewId.slice(0, 8)}… (rev {c.source.outcomeReviewRevision}) · this edit’s record hash {c.contentHash.slice(0, 12)}… · unknown: {c.unknownMarkers.join('; ') || 'none'} · cuts against: {c.contradictionMarkers.join('; ') || 'none'} · observations from the review: {c.selectedObservations.map((o) => o.ref).join(', ') || 'none'} · immutable history — a proposal, not a learning.
              {nonTerminal(c.status) && <> · <button type="button" data-testid={`candidate-withdraw-${c.logicalCandidateId}`} onClick={() => void judge(c.candidateId, 'WITHDRAW')} disabled={busy} style={lcBtn}>Discard permanently</button></>}
            </div>
          )}
          {mode?.kind === 'edit' && mode.logicalId === c.logicalCandidateId && formBlock(c.logicalCandidateId)}
        </div>
      ))}
      {mode === null && <button type="button" data-testid={`candidate-propose-open-${tid}`} onClick={() => { setF(emptyForm()); setMode({ kind: 'propose' }); }} style={{ ...lcBtn, marginTop: 6 }}>See a possible learning</button>}
      {mode?.kind === 'propose' && formBlock(tid)}
    </div>
  );
}

function OutcomeReviewPanel({ plan, on401 }: { plan: PlanView; on401: (e: unknown) => void }) {
  const [reviews, setReviews] = useState<OutcomeReviewView[] | null>(null);
  const [snaps, setSnaps] = useState<SnapshotView[]>([]);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ObservedOutcome | ''>('');
  const [statement, setStatement] = useState('');
  const [unknowns, setUnknowns] = useState('');
  const [snapId, setSnapId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { setReviews(await listOutcomeReviews(plan.planId)); } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setReviews([]); }
    try { const s = await listContextSnapshots(); setSnaps(s); setSnapId((cur) => cur || (s[0]?.snapshotId ?? '')); } catch { /* noop */ }
  }, [plan.planId, on401]);
  useEffect(() => { void load(); }, [load]);
  const makeSnapshot = async () => {
    setErr(''); setBusy(true);
    try { const s = await createContextSnapshot(); const list = await listContextSnapshots(); setSnaps(list); setSnapId(s.snapshotId); }
    catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setErr('Could not create a snapshot.'); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      await addOutcomeReview(plan.planId, { contextSnapshotId: snapId, observedOutcome: outcome as ObservedOutcome, founderOutcomeStatement: statement.trim(), unknowns: unknowns.split('\n').map((u) => u.trim()).filter(Boolean), idempotencyKey: newKey() });
      setOpen(false); setOutcome(''); setStatement(''); setUnknowns(''); await load();
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setErr(e instanceof ApiError ? e.message : 'Could not record the review.'); }
    finally { setBusy(false); }
  };
  if (!reviews) return null;
  return (
    <section data-testid={`outcome-review-${plan.planId}`} style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--line)' }}>
      <span style={sectionLabel}>Strategic outcome review</span>
      <p style={{ ...meta, marginTop: 2 }}>An <strong>immutable record</strong> of what was intended, what you reported, what evidence existed, and what you observed — for this exact plan revision. It <strong>describes</strong> history; it decides nothing, creates no learning, and is <strong>not a score</strong>. Later evidence makes a <em>new</em> review; earlier reviews never change.</p>
      {reviews.length === 0 && <p data-testid={`outcome-review-none-${plan.planId}`} style={{ ...meta, marginTop: 6 }}>No outcome review yet.</p>}
      {reviews.map((r) => (
        <div key={r.reviewId} data-testid={`outcome-review-item-${plan.planId}-${r.reviewSequence}`} style={{ marginTop: 10, paddingLeft: 8, borderLeft: '2px solid var(--line)' }}>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-1)' }}>Review #{r.reviewSequence} · <span data-testid={`outcome-verdict-${plan.planId}-${r.reviewSequence}`}>{r.observedOutcomeLabel}</span></p>
          <p style={{ ...meta, marginTop: 2, fontStyle: 'italic' }}>“{r.founderOutcomeStatement}”</p>
          <p style={{ ...meta, marginTop: 2 }}>Intended: {r.assessment.intended.milestones.map((m) => `${m.label} → ${m.intendedState}`).join(' · ') || r.assessment.intended.strategicIntent}</p>
          <p style={{ ...meta, marginTop: 2 }}>Reported: {r.assessment.reported.length ? r.assessment.reported.map((s) => `${s.subjectId}: ${nice(s.reportedState)}`).join(' · ') : 'nothing reported'}</p>
          <p style={{ ...meta, marginTop: 2 }}>Evidence at review: snapshot {r.contextSnapshotHash.slice(0, 12)}… · {r.assessment.evidence.executionEvidence.length} founder-supplied reference(s), none verified</p>
          <p data-testid={`outcome-unknowns-${plan.planId}-${r.reviewSequence}`} style={{ ...meta, marginTop: 2 }}>Unknown: {r.unknowns.length ? r.unknowns.join(' · ') : (r.observedOutcome === 'UNKNOWN' ? 'outcome unknown — not enough to say' : 'none recorded')}</p>
          <p style={{ ...meta, marginTop: 2, color: 'var(--ink-3)' }}>Immutable · not verified by Business Brain · not a score · reproducible (hash {r.reproducibility.contentHash.slice(0, 12)}…)</p>
          <LearningCandidatesForReview review={r} planId={plan.planId} seq={r.reviewSequence} on401={on401} />
        </div>
      ))}
      {!open && <button type="button" data-testid={`outcome-review-open-${plan.planId}`} onClick={() => { setOpen(true); if (snaps.length === 0) void makeSnapshot(); }} style={{ ...lcBtn, marginTop: 8 }}>Look back on this plan</button>}
      {open && (
        <div data-testid={`outcome-review-form-${plan.planId}`} style={{ marginTop: 10 }}>
          <p style={{ ...meta }}>A few quick questions — this just records what happened; it decides nothing and shares nothing.</p>
          <label style={{ ...meta, display: 'block', marginTop: 6 }}>What actually happened, versus what you intended?
            <select data-testid={`outcome-select-${plan.planId}`} aria-label="Observed outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as ObservedOutcome)} style={selStyle}><option value="">Choose…</option>{OUTCOME_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></label>
          <label style={{ ...meta, display: 'block', marginTop: 6 }}>In your own words (not verified by Business Brain)
            <textarea data-testid={`outcome-statement-${plan.planId}`} value={statement} onChange={(e) => setStatement(e.target.value)} rows={2} placeholder="e.g. We shipped weekly for three weeks, then paused." style={taStyle} /></label>
          <label style={{ ...meta, display: 'block', marginTop: 6 }}>What’s still unclear? (one per line)
            <textarea data-testid={`outcome-unknowns-input-${plan.planId}`} value={unknowns} onChange={(e) => setUnknowns(e.target.value)} rows={2} placeholder="e.g. Whether the cadence drove the signups." style={taStyle} /></label>
          {/* Progressive disclosure: the frozen context is minted for you; refresh or inspect it only if you want to. */}
          <details style={{ ...meta, marginTop: 6 }}><summary style={{ cursor: 'pointer' }}>Advanced: the frozen context this review is tied to</summary>
            {snaps.length === 0 && <p data-testid={`outcome-review-need-snapshot-${plan.planId}`} style={{ ...meta, marginTop: 4 }}>Freezing the current context…</p>}
            <button type="button" data-testid={`outcome-create-snapshot-${plan.planId}`} onClick={() => void makeSnapshot()} disabled={busy} style={{ ...lcBtn, marginTop: 4 }}>Freeze a fresh view of your context</button>
            {snaps.length > 0 && <label style={{ ...meta, display: 'block', marginTop: 6 }}>Frozen context
              <select data-testid={`outcome-snapshot-${plan.planId}`} aria-label="Context snapshot" value={snapId} onChange={(e) => setSnapId(e.target.value)} style={selStyle}>{snaps.map((s) => <option key={s.snapshotId} value={s.snapshotId}>{s.snapshotId.slice(0, 12)}… ({s.contentHash.slice(0, 8)}…)</option>)}</select></label>}
          </details>
          {err && <p data-testid={`outcome-review-error-${plan.planId}`} style={{ ...meta, color: 'var(--warn-ink)', marginTop: 6 }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Button variant="primary" loading={busy} disabled={!outcome || !statement.trim() || !snapId} onClick={() => void submit()}><span data-testid={`outcome-submit-${plan.planId}`}>Save this review</span></Button>
            <button type="button" data-testid={`outcome-cancel-${plan.planId}`} onClick={() => { setOpen(false); setErr(''); }} style={lcBtn}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

// The founder's plans (intention). ADR-015 remediation: execution belongs to an EXACT plan revision, so EVERY revision is
// listed as its own block with its OWN revision-scoped execution accounting. A later revision is a different intention and
// starts with "No execution report" even if an earlier revision was reported — execution never migrates between revisions.
function PlansPanel({ on401 }: { on401: (e: unknown) => void }) {
  const [revisions, setRevisions] = useState<PlanView[] | null>(null);
  const load = useCallback(async () => {
    try {
      const effective = await listPlans(); // one effective plan per logical plan
      const logicalIds = [...new Set(effective.map((p) => p.logicalPlanId))];
      const histories = await Promise.all(logicalIds.map((id) => getPlan(id).then((r) => r.history).catch(() => [] as PlanView[])));
      // every revision across every plan, newest revision first
      const all = histories.flat().sort((a, b) => (a.revision < b.revision ? 1 : -1));
      setRevisions(all);
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setRevisions([]); }
  }, [on401]);
  useEffect(() => { void load(); }, [load]);
  if (!revisions || revisions.length === 0) return null;
  return (
    <section data-testid="plans-panel" style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line)' }}>
      <span style={sectionLabel}>Your plans</span>
      <p style={{ ...meta, marginTop: 2 }}>A plan is your <strong>intention</strong>. It does not execute anything. Each <em>revision</em> is a distinct intention with its own execution accounting — a later revision never inherits an earlier one’s execution. Nothing here is verified by Business Brain.</p>
      {revisions.map((p) => (
        <div key={p.planId} data-testid={`plan-${p.planId}`} style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-2)', borderTop: '1px dashed var(--line)' }}>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)' }}>{p.title} <span data-testid={`plan-rev-label-${p.planId}`} style={{ ...meta }}>· revision {p.revision} · {nice(p.status)}</span></p>
          <ul style={ulReset}>{p.milestones.map((m) => <li key={m.id} style={{ ...meta, marginTop: 2 }}>Planned: {m.label}</li>)}</ul>
          <ExecutionAccounting plan={p} on401={on401} />
          <OutcomeReviewPanel plan={p} on401={on401} />
        </div>
      ))}
    </section>
  );
}

// Page-level, persisted list of the founder's learning THREADS + the promotion ledger's effective sets. Survives refresh.
function LearningsList({ on401 }: { on401: (e: unknown) => void }) {
  const [threads, setThreads] = useState<LearningThreadView[] | null>(null);
  const [bu, setBu] = useState<PromotionView[]>([]);
  const [fsc, setFsc] = useState<PromotionView[]>([]);
  const load = useCallback(async () => {
    try {
      const [t, b, f] = await Promise.all([listLearningThreads(), getPromotedInto('business-understanding'), getPromotedInto('founder-strategic-context')]);
      setThreads(t); setBu(b); setFsc(f);
    } catch (e) { if (e instanceof ApiError && e.status === 401) { on401(e); return; } setThreads([]); }
  }, [on401]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const h = () => void load(); const evs = ['bb:learning-kept', 'bb:lifecycle-changed', 'bb:promotion-changed']; for (const ev of evs) window.addEventListener(ev, h); return () => { for (const ev of evs) window.removeEventListener(ev, h); }; }, [load]);

  if (!threads || threads.length === 0) return null;
  const promotedFor = (logicalId: string): Partial<Record<PromotionTarget, string>> => ({
    BUSINESS_UNDERSTANDING: bu.find((p) => p.learning.logicalLearningId === logicalId)?.learning.revisionId,
    FOUNDER_STRATEGIC_CONTEXT: fsc.find((p) => p.learning.logicalLearningId === logicalId)?.learning.revisionId,
  });
  return (
    <section data-testid="learnings-list" style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line)' }}>
      <span style={sectionLabel}>What you've chosen to remember</span>
      <p style={{ ...meta, marginTop: 2 }}>Adjust or retire each — the full history is always kept. You can also choose to let future decisions use a learning; that stays your explicit choice.</p>
      {threads.map((t) => <ThreadCard key={t.logicalLearningId} thread={t} promoted={promotedFor(t.logicalLearningId)} on401={on401} />)}
      {/* CANONICAL authoritative effective context (native + promoted) — the single answer to "what is my current BU/FSC?" */}
      <CanonicalEffectiveContext on401={on401} />
      {/* CONSUMPTION GATE — explicit immutable snapshots; the only reasoning input a recommendation may consume. */}
      <ContextSnapshots on401={on401} />
      {/* Audit-only: the promotion history (ledger projection). Clearly separated from the canonical effective context. */}
      <div data-testid="promotion-history" style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--line)' }}>
        <span style={sectionLabel}>What future decisions will use</span>
        <PromotedInto target="BUSINESS_UNDERSTANDING" items={bu} />
        <div style={{ marginTop: 'var(--sp-3)' }}><span style={sectionLabel}>What shapes your whole strategy</span><PromotedInto target="FOUNDER_STRATEGIC_CONTEXT" items={fsc} /></div>
      </div>
    </section>
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
