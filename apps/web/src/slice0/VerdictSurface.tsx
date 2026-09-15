import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { adoptStrategy, respondToStrategy, proposePlan, adoptPlan, type ImpactResult } from '../api/client';

/**
 * LIVING STATE — the verdict surface. The signature moment of the loop: after a new reality is assessed
 * against the held strategy, this shows — in order — the verdict, what changed, what did NOT change, the
 * assumption impacts, what it means for Today, and what it means for the strategy. On REVISE / RECONSIDER
 * the founder can adopt the drafted revision or challenge it (routing to the existing challenge loop). It is
 * a shared COMPONENT, not a destination — the same surface renders inside Add Context, Today, and refresh.
 */

type T = (k: string, v?: Record<string, string>) => string;

const BADGE_TONE: Record<ImpactResult['verdict'], string> = {
  STILL_HOLDS: 's0-verdict-hold',
  TUNE: 's0-verdict-tune',
  REVISE: 's0-verdict-revise',
  RECONSIDER: 's0-verdict-reconsider',
};

function Lane(props: { label: string; items: string[]; tone: 'clay' | 'muted' }) {
  if (props.items.length === 0) return null;
  return (
    <div className={props.tone === 'clay' ? 's0-verdict-lane s0-verdict-lane-clay' : 's0-verdict-lane'}>
      <div className="s0-verdict-lane-k">{props.label}</div>
      <ul className="s0-verdict-list">{props.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

export function VerdictSurface(props: {
  businessId: string;
  result: ImpactResult;
  onDismiss: () => void;
  onAdopted?: () => void;
}) {
  const { businessId, result, onDismiss, onAdopted } = props;
  const { t } = useLocale() as { t: T };
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'view' | 'challenging' | 'adopted' | 'challenged'>('view');
  const [challengeText, setChallengeText] = useState('');
  const [err, setErr] = useState(false);

  const strat = result.strategyImpact;
  const canAct = strat.changes && strat.newVersion;

  async function adopt() {
    if (!strat.newVersion || busy) return;
    setBusy(true); setErr(false);
    try {
      await adoptStrategy(businessId, strat.newVersion.id);
      // Adopting a new strategy makes the plan stale; reshape it so Today re-derives from the new version.
      // Best-effort: if the reshape can't produce a clean plan, Today falls back to its stale-reshape prompt.
      try {
        const p = await proposePlan(businessId);
        if (p && 'planVersionId' in p && p.planVersionId) await adoptPlan(businessId, p.planVersionId);
      } catch { /* leave Today to prompt a reshape */ }
      setPhase('adopted'); onAdopted?.();
    } catch { setErr(true); }
    finally { setBusy(false); }
  }

  async function sendChallenge() {
    const text = challengeText.trim();
    if (!text || busy) return;
    setBusy(true); setErr(false);
    try { await respondToStrategy(businessId, 'constraint', text); setPhase('challenged'); }
    catch { setErr(true); }
    finally { setBusy(false); }
  }

  if (phase === 'adopted') {
    return (
      <div className="s0-verdict s0-verdict-done">
        <p className="s0-verdict-donemsg">{t('verdict.adopted')}</p>
        <div className="s0-today2-actions">
          <button type="button" className="s0-btn" onClick={() => navigate(`/b/${businessId}/today`)}>{t('verdict.toToday')} →</button>
          <button type="button" className="s0-btn-ghost" onClick={onDismiss}>{t('verdict.dismiss')}</button>
        </div>
      </div>
    );
  }
  if (phase === 'challenged') {
    return (
      <div className="s0-verdict s0-verdict-done">
        <p className="s0-verdict-donemsg">{t('verdict.challenged')}</p>
        <div className="s0-today2-actions">
          <button type="button" className="s0-btn" onClick={() => navigate(`/b/${businessId}/strategy`)}>{t('verdict.toStrategy')} →</button>
          <button type="button" className="s0-btn-ghost" onClick={onDismiss}>{t('verdict.dismiss')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="s0-verdict">
      <div className={`s0-verdict-badge ${BADGE_TONE[result.verdict]}`}>{t(`verdict.badge.${result.verdict}`)}</div>

      <Lane label={t('verdict.changed')} items={result.whatChanged} tone="clay" />
      <Lane label={t('verdict.didnt')} items={result.whatDidNotChange} tone="muted" />

      {result.assumptionImpacts.length > 0 ? (
        <div className="s0-verdict-lane">
          <div className="s0-verdict-lane-k">{t('verdict.assumptions')}</div>
          <ul className="s0-verdict-assumptions">
            {result.assumptionImpacts.map((a, i) => (
              <li key={i}>
                <span className={`s0-verdict-dir s0-verdict-dir-${a.direction}`}>{t(`verdict.dir.${a.direction}`)}</span>
                <span className="s0-verdict-assumption">{a.assumption}</span>
                {a.note ? <span className="s0-verdict-note">{a.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.todayImpact.changes ? (
        <div className="s0-verdict-today">
          <div className="s0-verdict-lane-k">{t('verdict.today')}</div>
          {result.todayImpact.newMove ? <p className="s0-verdict-move">{result.todayImpact.newMove}</p> : null}
          <p className="s0-verdict-reason">{t('verdict.because', { reason: result.todayImpact.reason })}</p>
        </div>
      ) : (
        <p className="s0-verdict-reason s0-verdict-nochange">{result.todayImpact.reason}</p>
      )}

      {strat.changes ? (
        <div className="s0-verdict-strategy">
          <div className="s0-verdict-lane-k">{t('verdict.strategy')}</div>
          <p className="s0-verdict-reason">{strat.reason}</p>
          {strat.newVersion ? <p className="s0-verdict-newver">{t('verdict.newStrategy', { v: String(strat.newVersion.version) })}</p> : null}
        </div>
      ) : (
        <p className="s0-verdict-holds">{t('verdict.holds')}</p>
      )}

      {err ? <div className="s0-error" role="alert">{t('common.actionFailed')}</div> : null}

      {phase === 'challenging' ? (
        <div className="s0-correct">
          <textarea className="s0-correct-field" value={challengeText} autoFocus rows={3}
            placeholder={t('verdict.challengePlaceholder')} onChange={(e) => setChallengeText(e.target.value)} />
          <div className="s0-today2-actions">
            <button type="button" className="s0-btn" disabled={busy || !challengeText.trim()} onClick={sendChallenge}>{busy ? '…' : t('verdict.challengeSubmit')}</button>
            <button type="button" className="s0-btn-ghost" onClick={() => setPhase('view')}>{t('verdict.cancel')}</button>
          </div>
        </div>
      ) : (
        <div className="s0-today2-actions s0-verdict-actions">
          {canAct ? <button type="button" className="s0-btn" disabled={busy} onClick={adopt}>{busy ? '…' : t('verdict.adopt')}</button> : null}
          {canAct ? <button type="button" className="s0-btn-ghost" onClick={() => setPhase('challenging')}>{t('verdict.challenge')}</button> : null}
          <button type="button" className={canAct ? 's0-linkbtn' : 's0-btn'} onClick={onDismiss}>{t('verdict.dismiss')}</button>
        </div>
      )}
    </div>
  );
}
