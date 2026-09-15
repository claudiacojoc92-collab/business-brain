import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import { useTalk } from './TalkDrawer';
import { isNotFound, LoadError } from './errors';
import { VerdictSurface } from './VerdictSurface';
import {
  getBusiness, getToday, getPlanState, proposePlan, adoptPlan, getCurrentStrategy,
  applyActionOutcome, createFromAction, resolveActionState, submitCorrection, evaluateImpact,
  type Business, type TodayResp, type TodayBlocked, type PlanActiveResp, type StrategyResp,
  type ImpactResult, type ReturnSummary,
} from '../api/client';

/**
 * Today — "what should I do now, and why this?" Strategy becoming one executable move. It leads with a
 * SINGLE move that visibly inherits the adopted Strategy (provenance → move → why now → done → becomes an
 * asset). Not a task list, backlog, or planner. Every state is the real runtime truth (no strategy / no plan
 * / insufficient / stale / blocked / clear); "Not today" maps deterministically to the `deferred` outcome.
 */

type Stage = 'no_strategy' | 'no_plan' | 'shaping' | 'insufficient' | 'stale' | 'move' | 'blocked' | 'all_clear';

const clip = (s: string, n: number): string => {
  const t = (s ?? '').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n); const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[.,;:\s]+$/, '')}…`;
};

export function TodayPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();
  const talk = useTalk();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [strat, setStrat] = useState<StrategyResp | null>(null);
  const [planState, setPlanState] = useState<PlanActiveResp | null>(null);
  const [today, setToday] = useState<TodayResp | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [insufficient, setInsufficient] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);   // B3 — transient load failure, distinct from a true 404
  const [actionError, setActionError] = useState<string | null>(null); // B1 — a primary action that failed
  const [verdict, setVerdict] = useState<ImpactResult | null>(null); // Living State: the last impact verdict
  const [reporting, setReporting] = useState(false);
  const [outcomeText, setOutcomeText] = useState('');
  const started = useRef(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [s, p, td] = await Promise.allSettled([getCurrentStrategy(id), getPlanState(id), getToday(id)]);
    if (s.status === 'fulfilled') setStrat(s.value);
    if (p.status === 'fulfilled') setPlanState(p.value);
    if (td.status === 'fulfilled') setToday(td.value);
  }, [id]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadErr(false);
    try { setBusiness(await getBusiness(id)); await refresh(); setLoaded(true); }
    catch (e) { if (isNotFound(e)) setBusiness(null); else setLoadErr(true); }
  }, [id, refresh]);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    void load();
  }, [id, load]);

  async function shapeMoves() {
    if (!id) return;
    setBusy('shape'); setInsufficient(false); setActionError(null);
    try {
      let pv = planState?.proposal?.planVersionId;
      if (!pv) {
        const p = await proposePlan(id);
        if ('state' in p && (p.state === 'insufficient' || p.state === 'no_strategy')) { setInsufficient(true); return; }
        pv = (p as { planVersionId: string }).planVersionId;
      }
      if (pv) await adoptPlan(id, pv);
      await refresh();
    } catch { setActionError(t('common.actionFailed')); } finally { setBusy(null); }
  }
  async function outcome(actionId: string, o: 'done' | 'deferred') {
    if (!id) return;
    setBusy(actionId); setActionError(null);
    try { setToday(await applyActionOutcome(id, actionId, o)); setShowOthers(false); }
    catch { setActionError(t('common.actionFailed')); } finally { setBusy(null); }
  }
  async function makeIt(actionId: string) {
    if (!id) return;
    setBusy(actionId); setActionError(null);
    try { const r = await createFromAction(id, actionId); navigate(`/b/${id}/create/${r.createHandoffId}`); }
    catch { setActionError(t('common.actionFailed')); }
    finally { setBusy(null); }
  }
  // Living State: the founder reports an outcome of their work → assessed against the held strategy + baseline,
  // returning the shared verdict surface (STILL_HOLDS / TUNE / REVISE / RECONSIDER).
  async function reportOutcome() {
    if (!id || !outcomeText.trim()) return;
    setBusy('report'); setActionError(null);
    try {
      const r = await evaluateImpact(id, 'outcome_report', outcomeText.trim());
      setVerdict(r); setReporting(false); setOutcomeText('');
    } catch { setActionError(t('common.actionFailed')); } finally { setBusy(null); }
  }
  async function dismissVerdict() {
    setVerdict(null);
    await refresh(); // a regenerated/adopted strategy or a new next move re-derives Today
  }

  // ── Kind-specific responses to a BLOCKED move. Each maps to its own correct primitive; none marks the
  //    blocked child done, none routes material/constraints through Business Correction, none fakes state. ──

  // prerequisite_unfinished · "I've already finished [A]" → DONE on the PREREQUISITE (never the blocked child).
  async function prereqDone(prereqActionId: string) {
    if (!id) return;
    setBusy('blk'); setActionError(null);
    try { setToday(await applyActionOutcome(id, prereqActionId, 'done')); }
    catch { setActionError(t('common.actionFailed')); } finally { setBusy(null); }
  }
  // prerequisite_unfinished · "I can't do [A] yet" → constraint + SKIP on A, then reshape (A abandoned ⇒ the
  //    plan must re-derive around it; the declared constraint now feeds the next plan's envelope).
  async function prereqCant(prereqActionId: string, reason: string) {
    if (!id) return;
    setBusy('shape'); setActionError(null); setInsufficient(false);
    try {
      const why = reason.trim() || 'I can’t complete a step this move depends on right now.';
      await resolveActionState(id, prereqActionId, 'constraint', why);
      await applyActionOutcome(id, prereqActionId, 'skipped', why);
      const p = await proposePlan(id);
      if ('state' in p && (p.state === 'insufficient' || p.state === 'no_strategy')) { setInsufficient(true); return; }
      const pv = (p as { planVersionId: string }).planVersionId;
      if (pv) await adoptPlan(id, pv);
      await refresh();
    } catch { setActionError(t('common.actionFailed')); } finally { setBusy(null); }
  }
  // missing_material · "I have this" → resource = the EXACT required material ⇒ it folds into available material
  //    and the SAME action re-derives to ready; the founder then completes it normally (no auto-done).
  async function haveMaterial(actionId: string, material: string) {
    if (!id) return;
    setBusy('blk'); setActionError(null);
    try { setToday(await resolveActionState(id, actionId, 'resource', material)); }
    catch { setActionError(t('common.actionFailed')); } finally { setBusy(null); }
  }
  // missing_material · "I can't get this" → constraint + SKIP the shown move (advances to the next; never DONE).
  async function cantMaterial(actionId: string, reason: string) {
    if (!id) return;
    setBusy('blk'); setActionError(null);
    try {
      const why = reason.trim() || 'I can’t get what this move needs right now.';
      await resolveActionState(id, actionId, 'constraint', why);
      setToday(await applyActionOutcome(id, actionId, 'skipped', why));
    } catch { setActionError(t('common.actionFailed')); } finally { setBusy(null); }
  }
  // missing_material · "That's not right" → business_correction (held truth) + SKIP the now-moot move (never DONE).
  async function correctPremise(actionId: string, subject: string, statement: string) {
    if (!id) return;
    setBusy('blk'); setActionError(null);
    try {
      await submitCorrection(id, subject, statement);
      setToday(await applyActionOutcome(id, actionId, 'skipped', `Corrected: ${statement}`.slice(0, 300)));
    } catch { setActionError(t('common.actionFailed')); } finally { setBusy(null); }
  }
  // founder_decision · the founder states the choice → decision fact + DONE on the decision action (the decision
  //    IS the action; making it completes it — sanctioned auto-done, not a generic "I handled it").
  async function decide(actionId: string, choice: string) {
    if (!id) return;
    setBusy('blk'); setActionError(null);
    try {
      await resolveActionState(id, actionId, 'decision', choice);
      setToday(await applyActionOutcome(id, actionId, 'done', choice));
    } catch { setActionError(t('common.actionFailed')); } finally { setBusy(null); }
  }
  // "Not today" → deferred on the shown move (existing semantics; a real dependency never disappears).
  async function deferBlocked(actionId: string) {
    if (!id) return;
    setBusy('blk'); setActionError(null);
    try { setToday(await applyActionOutcome(id, actionId, 'deferred')); }
    catch { setActionError(t('common.actionFailed')); } finally { setBusy(null); }
  }

  if (loadErr) return <LoadError onRetry={() => { if (id) void load(); }} />;
  if (business === undefined || !loaded) {
    return <AppShell><div className="s0-today2"><div className="s0-today2-from">{t('common.loading')}</div></div></AppShell>;
  }
  if (business === null) return <Navigate to="/" replace />;

  // ── honest stage from real runtime truth ──
  const strategyAdopted = Boolean(strat?.strategy && strat?.adoptedAt);
  const active = planState?.active ?? null;
  const ready = today?.ready ?? [];
  let stage: Stage;
  if (busy === 'shape') stage = 'shaping';
  else if (insufficient) stage = 'insufficient';
  else if (!strategyAdopted) stage = 'no_strategy';
  else if (!active) stage = 'no_plan';
  else if (active.stale) stage = 'stale';
  else if (today?.state === 'active' && ready.length > 0) stage = 'move';
  else if (today?.blocked) stage = 'blocked';
  else stage = 'all_clear';

  const provenance = clip(active?.direction || strat?.strategy?.core?.coreBet?.priority || '', 96);
  const move = ready[0];
  const others = ready.slice(1);
  const base = `/b/${id}`;
  const since = today?.sinceLastHere;
  // The outcome reporter is offered wherever there is a held strategy to assess a result against.
  const canReport = strategyAdopted && stage !== 'shaping';

  return (
    <AppShell>
      {actionError && <div className="s0-error" role="alert">{actionError}</div>}
      <div className="s0-today2">
        {/* Living State — the verdict surface takes over Today until dismissed (an outcome/impact was just assessed). */}
        {verdict ? (
          <div className="s0-today2-verdict">
            <VerdictSurface businessId={id ?? ''} result={verdict} onDismiss={dismissVerdict} onAdopted={dismissVerdict} />
          </div>
        ) : (
          <>
            {/* "Since you were last here" — return-loop summary read from founder_event. Lives ON Today. */}
            {since?.show ? <SinceBlock since={since} t={t} /> : null}
            {/* "Today updated because …" — the same-session reason line (a TUNE or a strategy adoption). */}
            {today?.todayNote ? <TodayNoteLine note={today.todayNote} t={t} /> : null}
            {/* Persistent operating constraints Today is holding (surfaced from founder_state). */}
            {(today?.constraints ?? []).length > 0 ? <ConstraintsLine constraints={today!.constraints!} t={t} /> : null}
        {stage === 'no_strategy' ? (
          <Empty from={t('today2.today')} lead={t('today2.needStrategy')} cta={t('today2.toStrategy')} onCta={() => navigate(`${base}/strategy`)} />
        ) : stage === 'shaping' ? (
          <Empty from={t('today2.today')} lead={t('today2.shaping')} note />
        ) : stage === 'insufficient' ? (
          <Empty from={t('today2.today')} lead={t('today2.insufficient')} cta={t('today2.reshape')} onCta={shapeMoves} />
        ) : stage === 'no_plan' ? (
          <Empty from={provenance ? `${t('today2.because')} ${provenance}` : t('today2.today')} lead={t('today2.needPlan')} cta={t('today2.shape')} onCta={shapeMoves} />
        ) : stage === 'stale' ? (
          <Empty from={t('today2.today')} lead={t('today2.stale')} cta={t('today2.reshape')} onCta={shapeMoves} />
        ) : stage === 'blocked' && today?.blocked ? (
          <BlockedMove
            blk={today.blocked}
            provenance={provenance}
            busy={busy !== null}
            t={t}
            onTalk={talk.open}
            onReshape={shapeMoves}
            onPrereqDone={prereqDone}
            onPrereqCant={prereqCant}
            onHave={haveMaterial}
            onCant={cantMaterial}
            onCorrect={correctPremise}
            onDecide={decide}
            onDefer={deferBlocked}
          />
        ) : stage === 'blocked' || stage === 'all_clear' ? (
          <Empty from={provenance ? `${t('today2.because')} ${provenance}` : t('today2.today')} lead={t('today2.allclear')} />
        ) : move ? (
          <>
            {provenance ? <div className="s0-today2-from">{t('today2.because')} <span className="em">{provenance}</span></div> : null}
            <div className="s0-today2-k">{t('today2.donow')}</div>
            <h1 className={`s0-today2-move${(move.what ?? '').length > 90 ? ' s0-today2-move-long' : ''}`}>{move.what}</h1>

            {move.whyNow ? (
              <p className="s0-today2-why"><span className="s0-today2-lab">{t('today2.why')}</span> {move.whyNow}</p>
            ) : null}
            {move.doneLooksLike ? (
              <p className="s0-today2-done">{t('today2.done')} {move.doneLooksLike}</p>
            ) : null}

            {move.canCreate ? <p className="s0-today2-becomes">{t('today2.becomes')}</p> : null}

            <div className="s0-today2-foot">
              <div className="s0-today2-actions">
                {/* Capability-aware priority: when BB can help execute (content→Create, otherwise reason it
                    through in Talk), the primary action is to WORK ON IT, not "mark done". */}
                {move.canCreate ? (
                  <button type="button" className="s0-btn" disabled={busy === move.actionId} onClick={() => makeIt(move.actionId)}>{busy === move.actionId ? t('today2.working') : `${t('today2.makeit')} →`}</button>
                ) : (
                  <button type="button" className="s0-btn" disabled={busy === move.actionId} onClick={() => talk.open()}>{`${t('today2.workwith')} →`}</button>
                )}
                <button type="button" className="s0-btn-ghost" disabled={busy === move.actionId} onClick={() => outcome(move.actionId, 'done')}>{t('today2.markdone')}</button>
                {move.canCreate ? (
                  <button type="button" className="s0-btn-ghost" disabled={busy === move.actionId} onClick={() => talk.open()}>{t('today2.help')}</button>
                ) : null}
                <button type="button" className="s0-today2-defer" disabled={busy === move.actionId} onClick={() => outcome(move.actionId, 'deferred')}>{t('today2.nottoday')}</button>
              </div>

              {others.length > 0 ? (
                <div className="s0-today2-others">
                  <button type="button" className="s0-today2-others-toggle" onClick={() => setShowOthers((v) => !v)}>
                    {showOthers ? t('today2.hideOthers') : t('today2.others', { n: String(others.length) })}
                  </button>
                  {showOthers ? (
                    <ul className="s0-today2-others-list">
                      {others.map((o) => <li key={o.actionId}>{o.what}</li>)}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <Empty from={t('today2.today')} lead={t('today2.allclear')} />
        )}
            {canReport ? (
              <OutcomeReporter
                reporting={reporting} onOpen={() => setReporting(true)} onCancel={() => { setReporting(false); setOutcomeText(''); }}
                text={outcomeText} setText={setOutcomeText} onSubmit={reportOutcome} busy={busy === 'report'} t={t}
              />
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}

/** "Since you were last here" — a single compact line on Today, never a feed or a page. Shows after a real
 *  absence; calm and honest when nothing moved (never invents activity). */
function SinceBlock({ since, t }: { since: ReturnSummary; t: Tr }) {
  const changes = since.hasChanges ? since.changes.join(' · ') : t('since.quiet');
  return (
    <div className="s0-since" role="status">
      <div className="s0-since-k">{t('since.k')}</div>
      <p className="s0-since-changes">{changes}</p>
      {since.hasChanges ? (
        <p className="s0-since-line">
          <span className="s0-since-lab">{t('since.strategy')}</span> {since.strategyMoved ? t('since.revised') : t('since.holds')}
          {since.oneThing ? <> · <span className="s0-since-lab">{t('since.today')}</span> {since.oneThing}</> : null}
        </p>
      ) : null}
    </div>
  );
}

/** "Today updated because …" — the reason the current Today is what it is (a TUNE or a strategy adoption). */
function TodayNoteLine({ note, t }: { note: NonNullable<TodayResp['todayNote']>; t: Tr }) {
  const text = note.kind === 'strategy_adopted' ? t('today2.changedStrategy', { v: String(note.version) }) : t('today2.updatedBecause', { reason: note.reason });
  return <div className="s0-today2-note" role="status">{text}</div>;
}

/** The operating constraints Today is respecting, shown as persistent context. */
function ConstraintsLine({ constraints, t }: { constraints: string[]; t: Tr }) {
  return (
    <div className="s0-today2-constraints">
      <span className="s0-today2-constraints-k">{t('today2.constraintK')}</span>
      <ul className="s0-today2-constraints-list">{constraints.slice(0, 4).map((c, i) => <li key={i}>{c}</li>)}</ul>
    </div>
  );
}

/** The outcome-report entry: a founder reports a result of their work → the impact evaluator (source=outcome_report). */
function OutcomeReporter(props: {
  reporting: boolean; onOpen: () => void; onCancel: () => void;
  text: string; setText: (s: string) => void; onSubmit: () => void; busy: boolean; t: Tr;
}) {
  const { reporting, text, setText, busy, t } = props;
  if (!reporting) {
    return (
      <div className="s0-today2-report">
        <button type="button" className="s0-today2-report-open" onClick={props.onOpen}>{t('today2.report')}</button>
      </div>
    );
  }
  return (
    <div className="s0-today2-report s0-today2-report-open-form">
      <div className="s0-today2-k">{t('today2.reportK')}</div>
      <textarea className="s0-blk-input" rows={3} placeholder={t('today2.reportPh')} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus />
      <div className="s0-today2-actions">
        <button type="button" className="s0-btn" disabled={busy || !text.trim()} onClick={props.onSubmit}>{busy ? t('today2.working') : t('today2.reportSubmit')}</button>
        <button type="button" className="s0-today2-defer" disabled={busy} onClick={props.onCancel}>{t('today2.blk.cancel')}</button>
      </div>
    </div>
  );
}

function Empty({ from, lead, cta, onCta, note }: { from: string; lead: string; cta?: string; onCta?: () => void; note?: boolean }) {
  return (
    <div className="s0-today2-empty">
      <div className="s0-today2-from">{from}</div>
      <p className="s0-today2-emptylead">{lead}</p>
      {cta && onCta ? <button type="button" className="s0-btn" onClick={onCta}>{cta} →</button> : null}
      {note ? <p className="s0-today2-note">·</p> : null}
    </div>
  );
}

type BlkMode = 'root' | 'prereqCant' | 'matCant' | 'correct';
type Tr = (k: string, p?: Record<string, string>) => string;

/**
 * The blocked-move responder. Renders controls chosen by `blk.kind` — NOT a universal button set. Each control
 * routes to its own correct primitive (see the handlers in TodayPage): a prerequisite is resolved on the
 * prerequisite (never the blocked child); missing material is confirmed as a resource, refused as a constraint,
 * or — when the premise itself is wrong — corrected as held business truth; a founder decision is captured as a
 * decision and completes the decision action. Internal terms (kind/resource/constraint/prerequisite) never surface.
 */
function BlockedMove(props: {
  blk: TodayBlocked; provenance: string; busy: boolean; t: Tr;
  onTalk: () => void; onReshape: () => void;
  onPrereqDone: (prereqId: string) => void; onPrereqCant: (prereqId: string, reason: string) => void;
  onHave: (actionId: string, material: string) => void; onCant: (actionId: string, reason: string) => void;
  onCorrect: (actionId: string, subject: string, statement: string) => void;
  onDecide: (actionId: string, choice: string) => void; onDefer: (actionId: string) => void;
}) {
  const { blk, provenance, busy, t } = props;
  const [mode, setMode] = useState<BlkMode>('root');
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState('');
  const [subject, setSubject] = useState<'offer' | 'positioning' | 'audience'>('offer');
  const actionId = blk.actionId ?? '';

  const head = (k: string, lead?: string, extra?: string) => (
    <>
      {provenance ? <div className="s0-today2-from">{t('today2.because')} {provenance}</div> : null}
      <div className="s0-today2-k">{t(k)}</div>
      <p className="s0-today2-move">{blk.what}</p>
      {lead ? <p className="s0-today2-need"><span>{lead}</span>{extra ? ` ${extra}` : ''}</p> : null}
    </>
  );
  const talkLink = <button type="button" className="s0-today2-defer" disabled={busy} onClick={props.onTalk}>{t('today2.blk.talk')}</button>;
  const deferBtn = actionId ? <button type="button" className="s0-today2-defer" disabled={busy} onClick={() => props.onDefer(actionId)}>{t('today2.nottoday')}</button> : null;
  const cancelBtn = <button type="button" className="s0-today2-defer" disabled={busy} onClick={() => { setMode('root'); setReason(''); }}>{t('today2.blk.cancel')}</button>;

  // ── prerequisite_unfinished — every control targets the PREREQUISITE, never the blocked child ──
  if (blk.kind === 'prerequisite_unfinished' && blk.prerequisite) {
    const pre = blk.prerequisite;
    return (
      <>
        {head('today2.blk.prereqK', t('today2.blk.prereqLead'), pre.what)}
        <div className="s0-today2-foot">
          {mode === 'prereqCant' ? (
            <div className="s0-blk-form">
              <textarea className="s0-blk-input" rows={2} placeholder={t('today2.blk.whyPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
              <div className="s0-today2-actions">
                <button type="button" className="s0-btn" disabled={busy} onClick={() => props.onPrereqCant(pre.actionId, reason)}>{busy ? t('today2.working') : t('today2.blk.setAside')}</button>
                {cancelBtn}
              </div>
            </div>
          ) : (
            <div className="s0-today2-actions">
              <button type="button" className="s0-btn" disabled={busy} onClick={() => props.onPrereqDone(pre.actionId)}>{busy ? t('today2.working') : t('today2.blk.prereqDone')}</button>
              <button type="button" className="s0-btn-ghost" disabled={busy} onClick={() => setMode('prereqCant')}>{t('today2.blk.prereqCant')}</button>
              {deferBtn}{talkLink}
            </div>
          )}
        </div>
      </>
    );
  }

  // ── missing_material — have it (resource) / can't get it (constraint) / that's not right (correction) ──
  if (blk.kind === 'missing_material') {
    const material = blk.material || blk.need;
    return (
      <>
        {head('today2.blk.matK', t('today2.blk.matLead'), material)}
        <div className="s0-today2-foot">
          {mode === 'matCant' ? (
            <div className="s0-blk-form">
              <textarea className="s0-blk-input" rows={2} placeholder={t('today2.blk.whyPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
              <div className="s0-today2-actions">
                <button type="button" className="s0-btn" disabled={busy || !actionId} onClick={() => props.onCant(actionId, reason)}>{busy ? t('today2.working') : t('today2.blk.setAside')}</button>
                {cancelBtn}
              </div>
            </div>
          ) : mode === 'correct' ? (
            <div className="s0-blk-form">
              <div className="s0-blk-chips">
                {(['offer', 'positioning', 'audience'] as const).map((s) => (
                  <button key={s} type="button" className={subject === s ? 's0-chip s0-chip-on' : 's0-chip'} disabled={busy} onClick={() => setSubject(s)}>
                    {t(s === 'offer' ? 'today2.blk.corrOffer' : s === 'positioning' ? 'today2.blk.corrPos' : 'today2.blk.corrAud')}
                  </button>
                ))}
              </div>
              <textarea className="s0-blk-input" rows={2} placeholder={t('today2.blk.corrPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
              <div className="s0-today2-actions">
                <button type="button" className="s0-btn" disabled={busy || !reason.trim() || !actionId} onClick={() => props.onCorrect(actionId, subject, reason.trim())}>{busy ? t('today2.working') : t('today2.blk.corrSubmit')}</button>
                {cancelBtn}
              </div>
            </div>
          ) : (
            <>
              <div className="s0-today2-actions">
                <button type="button" className="s0-btn" disabled={busy || !actionId} onClick={() => props.onHave(actionId, material)}>{busy ? t('today2.working') : t('today2.blk.have')}</button>
                <button type="button" className="s0-btn-ghost" disabled={busy} onClick={() => { setMode('matCant'); setReason(''); }}>{t('today2.blk.cant')}</button>
                {deferBtn}
              </div>
              <div className="s0-today2-others">
                <button type="button" className="s0-today2-others-toggle" disabled={busy} onClick={() => { setMode('correct'); setReason(''); }}>{t('today2.blk.notright')}</button>
                {' · '}{talkLink}
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  // ── founder_decision — the founder states the choice; it is captured and completes the decision action ──
  if (blk.kind === 'founder_decision') {
    return (
      <>
        {head('today2.blk.decisionK', blk.need)}
        <div className="s0-today2-foot">
          <div className="s0-blk-form">
            <textarea className="s0-blk-input" rows={2} placeholder={t('today2.blk.decisionPlaceholder')} value={choice} onChange={(e) => setChoice(e.target.value)} disabled={busy} />
            <div className="s0-today2-actions">
              <button type="button" className="s0-btn" disabled={busy || !choice.trim() || !actionId} onClick={() => props.onDecide(actionId, choice.trim())}>{busy ? t('today2.working') : t('today2.blk.decisionSubmit')}</button>
              {deferBtn}{talkLink}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── operating_constraint → the move waits while a founder-declared constraint holds; defer or talk it through ──
  if (blk.kind === 'operating_constraint') {
    return (
      <>
        {head('today2.blk.constraintK', t('today2.blk.constraintLead'), blk.need)}
        <div className="s0-today2-foot">
          <div className="s0-today2-actions">
            {deferBtn}{talkLink}
          </div>
        </div>
      </>
    );
  }

  // ── strategy_stale / unknown → reshape (defensive; the `stale` stage normally precedes `blocked`) ──
  return (
    <>
      {head('today2.blockedK', blk.need)}
      <div className="s0-today2-foot">
        <div className="s0-today2-actions">
          <button type="button" className="s0-btn" disabled={busy} onClick={props.onReshape}>{busy ? t('today2.working') : t('today2.reshape')}</button>
          {deferBtn}{talkLink}
        </div>
      </div>
    </>
  );
}
