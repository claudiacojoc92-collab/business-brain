import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  getStrategyThread, ApiError, SOURCE_UNAVAILABLE,
  type StrategyThreadView, type ThreadLearning, type ThreadCandidate, type ThreadPlan, type ThreadOutcomeReview, type ThreadLaterRecommendation,
} from '../api/client';
import { AppShell, Thinking } from '../system/ui';

/**
 * Show Me the Loop — the rendered Strategy Thread. ONE founder-legible, filmable journey read straight off accepted
 * canonical records via a NON-CANONICAL deterministic projection (GET /strategy/threads/:rootSessionId): Recommendation →
 * Decision → Commitment → Plan → Execution → Outcome Review → Possible Learning → Strategic Learning → Promotion → a later
 * Recommendation whose FROZEN snapshot included that promoted learning. Every edge shown is an accepted relationship; where
 * an exact source is absent the step reads "Source relationship unavailable" — the UI never fabricates a link. The later
 * recommendation's copy is bounded ("generated with a context snapshot that included this promoted learning") — never
 * causal. Backward navigation runs the same visible chain in reverse: later recommendation → promoted learning → its
 * outcome review → the plan and the original recommendation. The founder never has to read a hash or a UUID to follow it.
 */
export function StrategyThreadPage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const { rootSessionId } = useParams<{ rootSessionId: string }>();
  const [thread, setThread] = useState<StrategyThreadView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // Backward-lineage focus: when the founder follows a later recommendation back through its promoted learning, we
  // highlight the exact learning + its outcome review + plan (the visible lineage), never a fabricated jump.
  const [tracedLearningId, setTracedLearningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!rootSessionId) return;
    setBusy(true); setError(null);
    try { setThread(await getStrategyThread(rootSessionId)); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { navigate('/signin', { replace: true }); return; }
      if (e instanceof ApiError && e.status === 404) { setError('This strategic thread was not found.'); return; }
      setError('Could not load this strategic thread.');
    } finally { setBusy(false); }
  }, [rootSessionId, navigate]);
  useEffect(() => { if (founderId) void load(); }, [founderId, load]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/signin" replace />;

  return (
    <AppShell actions={<button type="button" onClick={() => navigate('/strategy')} style={backBtn}>Back to strategy</button>}>
      <div data-testid="strategy-thread">
        <p style={eyebrow}>The whole thread</p>
        <h1 style={h1}>How this decision became a learning — and what it shaped next</h1>
        <p style={lede}>
          One continuous line of reasoning, read back from your own records. Nothing here is invented: each step points to the
          step it actually came from. Where a source can’t be shown, it says so.
        </p>

        {busy && <Thinking message="Tracing the thread…" />}
        {error && <div data-testid="thread-error" style={{ ...card, borderColor: 'var(--gold)' }}><p style={{ margin: 0, fontFamily: 'var(--serif)', color: 'var(--ink)' }}>{error}</p></div>}

        {thread && !busy && (
          <>
            <StepRecommendation thread={thread} />
            <StepDecision thread={thread} />
            <StepCommitment thread={thread} />
            <PlansSection thread={thread} tracedLearningId={tracedLearningId} />
            <LearningsSection thread={thread} tracedLearningId={tracedLearningId} />
            <LaterRecommendationsSection thread={thread} tracedLearningId={tracedLearningId} onTrace={setTracedLearningId} />
            <p data-testid="projection-note" style={{ ...meta, marginTop: 'var(--sp-6)', fontStyle: 'italic' }}>
              This view is a read-only reconstruction of your accepted records. It stores nothing and changes nothing.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}

// ─── connector: the visible "came from" edge between two steps ────────────────────────────────────────────────────
function FromEdge({ present, label, testid }: { present: boolean; label: string; testid: string }) {
  return present
    ? <p data-testid={testid} style={fromEdge}><span style={arrow}>↑</span> {label}</p>
    : <p data-testid={`${testid}-unavailable`} style={{ ...fromEdge, color: 'var(--ink-3)', fontStyle: 'italic' }}><span style={arrow}>↑</span> {SOURCE_UNAVAILABLE}</p>;
}

function StepShell({ n, kind, testid, children }: { n: number; kind: string; testid: string; children: React.ReactNode }) {
  return (
    <section data-testid={testid} style={{ ...card, marginTop: 'var(--sp-4)' }}>
      <p style={stepKind}><span style={stepNum}>{n}</span> {kind}</p>
      {children}
    </section>
  );
}

function StepRecommendation({ thread }: { thread: StrategyThreadView }) {
  const r = thread.recommendation;
  if (!r) return <StepShell n={1} kind="Recommendation" testid="step-recommendation"><p data-testid="recommendation-missing" style={missing}>{SOURCE_UNAVAILABLE}</p></StepShell>;
  return (
    <StepShell n={1} kind="Recommendation" testid="step-recommendation">
      <p style={stepTitle} data-testid="recommendation-title">{r.title}</p>
      <p style={stepQuestion} data-testid="recommendation-question">Asked: “{r.question}”</p>
      <Disclosable summary="Generation reference">
        <dl style={dl}>
          <Row k="Status" v={r.status} />
          <Row k="Reasoned from a frozen snapshot" v={r.snapshotId ? 'Yes' : 'No'} testid="recommendation-snapshot" />
        </dl>
      </Disclosable>
    </StepShell>
  );
}

function StepDecision({ thread }: { thread: StrategyThreadView }) {
  const d = thread.decision;
  return (
    <StepShell n={2} kind="Decision" testid="step-decision">
      {d
        ? <>
            <p style={stepTitle} data-testid="decision-statement">{d.statement}</p>
            <FromEdge present={!!d.fromRecommendationSessionId} label="Your explicit choice on the recommendation above" testid="decision-from" />
          </>
        : <p data-testid="decision-missing" style={missing}>No decision recorded on this recommendation yet.</p>}
    </StepShell>
  );
}

function StepCommitment({ thread }: { thread: StrategyThreadView }) {
  const c = thread.commitment;
  return (
    <StepShell n={3} kind="Commitment" testid="step-commitment">
      {c
        ? <>
            <p style={stepTitle} data-testid="commitment-statement">{c.statement}</p>
            <FromEdge present={!!c.fromDecisionId} label="Committed to from the decision above" testid="commitment-from" />
          </>
        : <p data-testid="commitment-missing" style={missing}>No commitment recorded from this decision yet.</p>}
    </StepShell>
  );
}

const EXEC_LABEL: Record<string, string> = { COMPLETED: 'Completed', ATTEMPTED: 'Attempted', ABANDONED: 'Abandoned', BLOCKED: 'Blocked', NOT_STARTED: 'Not started', NOT_REPORTED: 'Not reported' };
const OUTCOME_LABEL: Record<string, string> = { AS_INTENDED: 'As intended', PARTIALLY_AS_INTENDED: 'Partly as intended', NOT_AS_INTENDED: 'Not as intended', TOO_EARLY: 'Too early to tell' };
const CAND_LABEL: Record<ThreadCandidate['status'], string> = { PROPOSED: 'Possible learning', DEFERRED: 'Not yet', ADOPTED: 'Kept', REJECTED: 'Discarded', WITHDRAWN: 'Withdrawn' };

function PlansSection({ thread, tracedLearningId }: { thread: StrategyThreadView; tracedLearningId: string | null }) {
  if (thread.plans.length === 0) return <StepShell n={4} kind="Plan" testid="step-plan"><p data-testid="plan-missing" style={missing}>No plan recorded from this commitment yet.</p></StepShell>;
  return (
    <StepShell n={4} kind="Plan → Execution → Outcome review" testid="step-plan">
      {thread.plans.map((p) => <PlanBlock key={p.planId} plan={p} tracedLearningId={tracedLearningId} />)}
    </StepShell>
  );
}

function PlanBlock({ plan, tracedLearningId }: { plan: ThreadPlan; tracedLearningId: string | null }) {
  return (
    <div data-testid="plan-block" style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
      <p style={stepTitle} data-testid="plan-title">{plan.title} <span style={revTag}>rev {plan.revision}</span></p>
      <FromEdge present={!!plan.fromCommitmentId} label="Planned from the commitment above" testid="plan-from" />

      <p style={subhead}>What happened</p>
      {plan.executionReports.length === 0
        ? <p data-testid="execution-missing" style={missing}>No execution reported.</p>
        : <ul style={ul}>{plan.executionReports.map((e) => (
            <li key={e.subjectId} data-testid="execution-report" style={liRow}>
              <span data-testid="execution-state" style={pill(e.reportedState)}>{EXEC_LABEL[e.reportedState] ?? e.reportedState}</span>
              <span style={{ color: 'var(--ink-2)' }}>{e.subjectId}{e.statement ? ` — ${e.statement}` : ''}</span>
            </li>))}</ul>}

      {plan.outcomeReviews.map((r) => <OutcomeReviewBlock key={r.reviewId} review={r} tracedLearningId={tracedLearningId} />)}
    </div>
  );
}

function OutcomeReviewBlock({ review, tracedLearningId }: { review: ThreadOutcomeReview; tracedLearningId: string | null }) {
  const traced = review.candidates.some((c) => c.learningId && c.learningId === tracedLearningId);
  return (
    <div data-testid="outcome-review" style={{ marginTop: 'var(--sp-3)', ...(traced ? tracedBox : null) }}>
      <p style={subhead}>Strategic outcome review</p>
      <p data-testid="outcome-observed" style={{ ...stepTitle, fontSize: 'var(--fs-4)' }}><span style={pill(review.observedOutcome)}>{OUTCOME_LABEL[review.observedOutcome] ?? review.observedOutcome}</span></p>
      <p data-testid="outcome-statement" style={stepQuestion}>{review.statement}</p>
      <FromEdge present={!!review.fromPlanRecordId} label="Reviewed against the plan above" testid="outcome-from" />
      {review.unknowns.length > 0 && <Disclosable summary={`Named unknowns (${review.unknowns.length})`}><ul style={ul}>{review.unknowns.map((u, i) => <li key={i} data-testid="outcome-unknown" style={{ color: 'var(--ink-2)' }}>{u}</li>)}</ul></Disclosable>}

      <p style={subhead}>Possible learning</p>
      {review.candidates.length === 0
        ? <p data-testid="candidate-missing" style={missing}>No possible learning surfaced from this review.</p>
        : review.candidates.map((c) => <CandidateBlock key={c.logicalCandidateId} cand={c} reviewId={review.reviewId} />)}
    </div>
  );
}

function CandidateBlock({ cand, reviewId }: { cand: ThreadCandidate; reviewId: string }) {
  return (
    <div data-testid="learning-candidate" style={{ marginTop: 'var(--sp-2)' }}>
      <p data-testid="candidate-status" style={statusRow}><span style={pill(cand.status)}>{CAND_LABEL[cand.status]}</span></p>
      <p data-testid="candidate-statement" style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink)', margin: '2px 0 0', lineHeight: 'var(--lh-body)' }}>{cand.statement}</p>
      <FromEdge present={cand.fromOutcomeReviewId === reviewId} label="Surfaced by the outcome review above" testid="candidate-from" />
      {(cand.unknowns.length > 0 || cand.contradictions.length > 0) && (
        <Disclosable summary="What stays honest about it">
          {cand.unknowns.map((u, i) => <p key={`u${i}`} data-testid="candidate-unknown" style={quiet}>Unknown — {u}</p>)}
          {cand.contradictions.map((c, i) => <p key={`c${i}`} data-testid="candidate-contradiction" style={quiet}>Tension — {c}</p>)}
        </Disclosable>
      )}
    </div>
  );
}

function LearningsSection({ thread, tracedLearningId }: { thread: StrategyThreadView; tracedLearningId: string | null }) {
  return (
    <StepShell n={5} kind="Strategic learning → Promotion" testid="step-learning">
      {thread.learnings.length === 0
        ? <p data-testid="learning-missing" style={missing}>No learning has been kept from this thread yet.</p>
        : thread.learnings.map((l) => <LearningBlock key={l.logicalLearningId} learning={l} traced={l.learningId === tracedLearningId} />)}
    </StepShell>
  );
}

const ORIGIN_LABEL: Record<ThreadLearning['origin'], string> = { OUTCOME_REVIEW: 'From an outcome review', PLAN_REVIEW: 'From a plan review' };
function LearningBlock({ learning, traced }: { learning: ThreadLearning; traced: boolean }) {
  return (
    <div data-testid="strategic-learning" style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-3)', ...(traced ? tracedBox : null) }}>
      <p data-testid="learning-origin" style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{ORIGIN_LABEL[learning.origin]}</p>
      <p style={stepTitle} data-testid="learning-statement">{learning.statement}</p>
      <FromEdge present={!!(learning.fromOutcomeReviewId || learning.fromPlanReviewId)} label="Kept from the possible learning above" testid="learning-from" />
      <p style={subhead}>Promotion</p>
      {learning.promotions.length === 0
        ? <p data-testid="promotion-missing" style={missing}>Kept, but not yet promoted into your standing context.</p>
        : <ul style={ul}>{learning.promotions.map((pr) => (
            <li key={pr.promotionEventId} data-testid="promotion-event" style={liRow}>
              <span style={pill(pr.action)}>{pr.action === 'PROMOTE' ? 'Promoted' : pr.action === 'REPLACE' ? 'Replaced' : 'Removed'}</span>
              <span style={{ color: 'var(--ink-2)' }}>into {pr.target === 'FOUNDER_STRATEGIC_CONTEXT' ? 'your strategic context' : 'your business understanding'}</span>
            </li>))}</ul>}
    </div>
  );
}

function LaterRecommendationsSection({ thread, tracedLearningId, onTrace }: { thread: StrategyThreadView; tracedLearningId: string | null; onTrace: (id: string | null) => void }) {
  return (
    <StepShell n={6} kind="What it shaped next" testid="step-later">
      {thread.usedInLaterRecommendations.length === 0
        ? <p data-testid="later-missing" style={missing}>No later recommendation has yet been generated with a snapshot that included a learning from this thread.</p>
        : thread.usedInLaterRecommendations.map((x) => <LaterRecBlock key={x.sessionId} later={x} traced={x.includedLearningId === tracedLearningId} onTrace={onTrace} />)}
    </StepShell>
  );
}

function LaterRecBlock({ later, traced, onTrace }: { later: ThreadLaterRecommendation; traced: boolean; onTrace: (id: string | null) => void }) {
  return (
    <div data-testid="later-recommendation" style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-3)', ...(traced ? tracedBox : null) }}>
      <p style={stepTitle} data-testid="later-title">{later.title}</p>
      <p style={stepQuestion} data-testid="later-question">Asked: “{later.question}”</p>
      {/* Bounded, non-causal wording (L6): inclusion in a frozen snapshot — never "caused". */}
      <p data-testid="later-disclosure" style={{ ...fromEdge, color: 'var(--ink-2)' }}>
        <span style={arrow}>↑</span> {later.disclosure}
      </p>
      <p data-testid="later-included-learning" style={quiet}>The promoted learning it included: “{later.includedLearningStatement}”</p>
      <button
        type="button"
        data-testid="trace-back"
        onClick={() => onTrace(traced ? null : later.includedLearningId)}
        style={traceBtn}
      >
        {traced ? 'Hide the lineage' : 'Trace it back to where it was learned →'}
      </button>
    </div>
  );
}

// ─── progressive disclosure + small presentational helpers ────────────────────────────────────────────────────────
function Disclosable({ summary, children }: { summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 'var(--sp-2)' }}>
      <button type="button" data-testid="disclose" onClick={() => setOpen((o) => !o)} style={discloseBtn}>{open ? '▾' : '▸'} {summary}</button>
      {open && <div data-testid="disclosed" style={{ marginTop: 'var(--sp-2)' }}>{children}</div>}
    </div>
  );
}
function Row({ k, v, testid }: { k: string; v: string; testid?: string }) {
  return (<><dt style={dt}>{k}</dt><dd style={dd} data-testid={testid}>{v}</dd></>);
}

// ─── styles (match StrategyPage idiom: CSS variables, inline styles) ─────────────────────────────────────────────
const backBtn = { background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' } as const;
const card = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', boxShadow: 'var(--elev-1)' } as const;
const meta = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: 0 } as const;
const eyebrow = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--gold)', margin: '0 0 var(--sp-2)' };
const h1 = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-6)', color: 'var(--ink)', margin: '0 0 var(--sp-2)', lineHeight: 'var(--lh-tight)' } as const;
const lede = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', margin: '0 0 var(--sp-5)', lineHeight: 'var(--lh-body)' } as const;
const stepKind = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--ink-3)', margin: '0 0 var(--sp-2)', display: 'flex', alignItems: 'center', gap: 8 };
const stepNum = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', background: 'var(--ink)', color: 'var(--surface)', fontSize: '11px', fontWeight: 700 } as const;
const stepTitle = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-5)', color: 'var(--ink)', margin: 0, lineHeight: 'var(--lh-tight)' } as const;
const stepQuestion = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', fontStyle: 'italic' as const, color: 'var(--ink-2)', margin: '4px 0 0' };
const subhead = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--ink-3)', margin: 'var(--sp-3) 0 var(--sp-1)' };
const fromEdge = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ok-ink)', margin: '6px 0 0', display: 'flex', alignItems: 'center', gap: 6 } as const;
const arrow = { fontWeight: 700 } as const;
const missing = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', fontStyle: 'italic' as const, color: 'var(--ink-3)', margin: 0 };
const quiet = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: '4px 0 0', lineHeight: 'var(--lh-body)' } as const;
const statusRow = { margin: '2px 0 0' } as const;
const revTag = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', letterSpacing: '0.04em' } as const;
const ul = { margin: '4px 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' as const, gap: 6 };
const liRow = { display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)' } as const;
const dl = { margin: 0 } as const;
const dt = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--ink-3)', margin: '6px 0 0' };
const dd = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '2px 0 0' } as const;
const discloseBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' } as const;
const traceBtn = { marginTop: 'var(--sp-2)', background: 'none', border: '1px solid var(--line-2)', borderRadius: 'var(--r-1)', padding: '6px 12px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink)' } as const;
const tracedBox = { background: 'var(--surface-2, rgba(200,160,60,0.06))', borderLeft: '3px solid var(--gold)', paddingLeft: 'var(--sp-3)', marginLeft: '-3px', borderRadius: 'var(--r-1)' } as const;
function pill(kind: string): React.CSSProperties {
  const ok = ['COMPLETED', 'AS_INTENDED', 'ADOPTED', 'PROMOTE'].includes(kind);
  const warn = ['ATTEMPTED', 'PARTIALLY_AS_INTENDED', 'DEFERRED', 'BLOCKED'].includes(kind);
  const bad = ['ABANDONED', 'NOT_AS_INTENDED', 'REJECTED', 'REMOVE'].includes(kind);
  const c = ok ? 'var(--ok-ink)' : warn ? 'var(--gold)' : bad ? 'var(--err-ink, #a3423c)' : 'var(--ink-3)';
  return { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: '0.04em', color: c, border: `1px solid ${c}`, borderRadius: 'var(--r-1)', padding: '2px 8px', whiteSpace: 'nowrap' };
}
