import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import { isNotFound, LoadError } from './errors';
import {
  getBusiness, getPlanState, proposePlan, adoptPlan,
  type Business, type PlanView, type PlanPriority,
} from '../api/client';

type T = (k: string, v?: Record<string, string>) => string;
type Phase = 'loading' | 'empty' | 'proposed' | 'active' | 'insufficient' | 'no_strategy';

export function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(false);   // B3 — transient load failure, distinct from a true 404
  const [actionError, setActionError] = useState<string | null>(null); // B1 — a primary action that failed
  const started = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadErr(false);
    try {
      setBusiness(await getBusiness(id));
      const s = await getPlanState(id);
      if (s.active) { setPlan(s.active); setPhase('active'); }
      else if (s.proposal) { setPlan(s.proposal); setPhase('proposed'); }
      else setPhase('empty');
    } catch (e) { if (isNotFound(e)) setBusiness(null); else setLoadErr(true); }
  }, [id]);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    void load();
  }, [id, load]);

  async function generate() {
    if (!id) return;
    setBusy(true); setActionError(null);
    try {
      const r = await proposePlan(id);
      if ('planVersionId' in r) { setPlan(r); setPhase('proposed'); }
      else if (r.state === 'no_strategy') setPhase('no_strategy');
      else setPhase('insufficient');
    } catch { setActionError(t('common.actionFailed')); } finally { setBusy(false); }
  }
  async function accept() {
    if (!id || !plan) return;
    setBusy(true); setActionError(null);
    try { const a = await adoptPlan(id, plan.planVersionId); if ('planVersionId' in a) { setPlan(a); setPhase('active'); } }
    catch { setActionError(t('common.actionFailed')); }
    finally { setBusy(false); }
  }

  if (loadErr) return <LoadError onRetry={() => { if (id) void load(); }} />;
  if (business === undefined || phase === 'loading') {
    return <AppShell showSignOut><div className="s0-loading">{t('common.loading')}</div></AppShell>;
  }
  if (business === null) return <Navigate to="/" replace />;

  return (
    <AppShell showSignOut>
      {actionError && <div className="s0-error" role="alert">{actionError}</div>}
      <div className="s0-panel s0-panel-wide">

        {phase === 'no_strategy' && (
          <>
            <h1 className="s0-h1">{t('plan.nostrategy.title')}</h1>
            <p className="s0-lede">{t('plan.nostrategy.body')}</p>
            <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} onClick={() => navigate(`/b/${id}/strategy`)}>
              {t('strategy.continue')}
            </button>
          </>
        )}

        {phase === 'insufficient' && (
          <>
            <h1 className="s0-h1">{t('plan.insufficient.title')}</h1>
            <p className="s0-lede">{t('plan.insufficient.body')}</p>
            <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} disabled={busy} onClick={generate}>
              {busy ? t('plan.generating') : t('strategy.retry')}
            </button>
          </>
        )}

        {phase === 'empty' && (
          <>
            <h1 className="s0-h1">{t('plan.title.proposed')}</h1>
            <p className="s0-lede">{t('plan.today.sub')}</p>
            <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} disabled={busy} onClick={generate}>
              {busy ? t('plan.generating') : t('plan.generate')}
            </button>
          </>
        )}

        {(phase === 'proposed' || phase === 'active') && plan && (
          <PlanBody plan={plan} active={phase === 'active'} t={t} busy={busy}
            onAccept={accept} onRebuild={generate}
            onToday={() => navigate(`/b/${id}/today`)} />
        )}
      </div>
    </AppShell>
  );
}

function PriorityCard(props: { p: PlanPriority; t: T }) {
  const { p, t } = props;
  return (
    <div className={`s0-strat-block${p.focus ? ' s0-plan-focus' : ''}`}>
      {p.focus && <div className="s0-plan-focus-tag">{t('plan.focus')}</div>}
      <p className="s0-strat-lead">{p.title}</p>
      <p className="s0-plan-band">{p.timeBand}</p>
      <p className="s0-strat-body">{p.why}</p>
      {p.steps.length > 0 && (
        <ul className="s0-strat-list s0-plan-steps">
          {p.steps.map((s, i) => <li key={i}>{s.what}</li>)}
        </ul>
      )}
      {p.blocker && <p className="s0-plan-blocker"><span>{t('plan.blocker')}</span> {p.blocker}</p>}
      {p.signal && <p className="s0-plan-signal"><span>{t('plan.signal')}</span> {p.signal}</p>}
    </div>
  );
}

function PlanBody(props: {
  plan: PlanView; active: boolean; t: T; busy: boolean;
  onAccept: () => void; onRebuild: () => void; onToday: () => void;
}) {
  const { plan, active, t, busy, onAccept, onRebuild, onToday } = props;
  return (
    <>
      <h1 className="s0-h1">{active ? t('plan.title.active') : t('plan.title.proposed')}</h1>
      {active && <p className="s0-plan-active">{t('plan.accepted')}</p>}

      {active && plan.stale && (
        <div className="s0-plan-stale">
          <strong>{t('plan.stale.title')}</strong>
          <p>{t('plan.stale.body')}</p>
          <button type="button" className="s0-linkbtn" disabled={busy} onClick={onRebuild}>{t('plan.regenerate')}</button>
        </div>
      )}

      <div className="s0-strat-block">
        <div className="s0-strat-label">{t('plan.direction')}</div>
        <p className="s0-strat-lead">{plan.direction}</p>
      </div>

      {plan.priorities.map((p) => <PriorityCard key={p.priorityId} p={p} t={t} />)}

      {plan.notNow.length > 0 && (
        <div className="s0-strat-block">
          <div className="s0-strat-label">{t('plan.notnow')}</div>
          <ul className="s0-strat-list">
            {plan.notNow.map((n, i) => <li key={i}><strong>{n.item}</strong> — {n.reason}</li>)}
          </ul>
        </div>
      )}

      <div className="s0-strat-actions">
        {active ? (
          <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} onClick={onToday}>{t('plan.today.link')} →</button>
        ) : (
          <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} disabled={busy} onClick={onAccept}>
            {busy ? t('common.loading') : t('plan.accept')}
          </button>
        )}
      </div>
    </>
  );
}
