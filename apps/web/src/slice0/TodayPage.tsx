import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import { isNotFound, LoadError } from './errors';
import {
  getBusiness, getToday, getPlanState, proposePlan, adoptPlan, getCurrentStrategy,
  applyActionOutcome, createFromAction,
  type Business, type TodayResp, type PlanActiveResp, type StrategyResp,
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

  return (
    <AppShell>
      {actionError && <div className="s0-error" role="alert">{actionError}</div>}
      <div className="s0-today2">
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
        ) : stage === 'blocked' ? (
          <>
            {provenance ? <div className="s0-today2-from">{t('today2.because')} {provenance}</div> : null}
            <div className="s0-today2-k">{t('today2.blockedK')}</div>
            <p className="s0-today2-move">{today?.blocked?.what}</p>
            {today?.blocked?.need ? <p className="s0-today2-need"><span>{t('today2.need')}</span> {today.blocked.need}</p> : null}
          </>
        ) : stage === 'all_clear' ? (
          <Empty from={provenance ? `${t('today2.because')} ${provenance}` : t('today2.today')} lead={t('today2.allclear')} />
        ) : move ? (
          <>
            {provenance ? <div className="s0-today2-from">{t('today2.because')} <span className="em">{provenance}</span></div> : null}
            <div className="s0-today2-k">{t('today2.donow')}</div>
            <h1 className="s0-today2-move">{move.what}</h1>

            {move.whyNow ? (
              <p className="s0-today2-why"><span className="s0-today2-lab">{t('today2.why')}</span> {move.whyNow}</p>
            ) : null}
            {move.doneLooksLike ? (
              <p className="s0-today2-done">{t('today2.done')} {move.doneLooksLike}</p>
            ) : null}

            {move.canCreate ? <p className="s0-today2-becomes">{t('today2.becomes')}</p> : null}

            <div className="s0-today2-foot">
              <div className="s0-today2-actions">
                {move.canCreate ? (
                  <button type="button" className="s0-btn" disabled={busy === move.actionId} onClick={() => makeIt(move.actionId)}>{busy === move.actionId ? t('today2.working') : `${t('today2.makeit')} →`}</button>
                ) : null}
                <button type="button" className={move.canCreate ? 's0-btn-ghost' : 's0-btn'} disabled={busy === move.actionId} onClick={() => outcome(move.actionId, 'done')}>{t('today2.markdone')}</button>
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
      </div>
    </AppShell>
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
