import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import {
  getBusiness,
  getCurrentStrategy,
  getStrategyProposal,
  regenerateStrategy,
  adoptStrategy,
  respondToStrategy,
  type Business,
  type StrategyResp,
} from '../api/client';

type T = (k: string, v?: Record<string, string>) => string;
type Phase = 'loading' | 'proposal' | 'insufficient' | 'current';

export function StrategyPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  const [resp, setResp] = useState<StrategyResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correction, setCorrection] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    (async () => {
      try {
        const b = await getBusiness(id);
        setBusiness(b);
        const cur = await getCurrentStrategy(id);
        if (cur.state !== 'none' && cur.strategy) { setResp(cur); setPhase('current'); return; }
        const p = await getStrategyProposal(id);
        applyProposal(p);
      } catch { setBusiness(null); }
    })();
  }, [id]);

  function applyProposal(p: StrategyResp) {
    setResp(p);
    setPhase(p.status === 'proposal' && p.strategy ? 'proposal' : 'insufficient');
  }

  async function regenerate() {
    if (!id) return;
    setBusy(true);
    try { applyProposal(await regenerateStrategy(id)); } finally { setBusy(false); }
  }
  async function adopt() {
    if (!id || !resp?.id) return;
    setBusy(true);
    try { const c = await adoptStrategy(id, resp.id); setResp(c); setPhase('current'); } finally { setBusy(false); }
  }
  async function submitCorrection(kind: string) {
    if (!id || !correction.trim()) return;
    setBusy(true);
    try { applyProposal(await respondToStrategy(id, kind, correction.trim())); setCorrection(''); setCorrecting(false); } finally { setBusy(false); }
  }

  if (business === undefined || phase === 'loading') {
    return <AppShell showSignOut><div className="s0-loading">{t('common.loading')}</div></AppShell>;
  }
  if (business === null) return <Navigate to="/" replace />;

  return (
    <AppShell showSignOut>
      <div className="s0-panel s0-panel-wide">
        <button type="button" className="s0-linkbtn" onClick={() => navigate(`/b/${id}/talk`)} style={{ marginBottom: 18 }}>
          ← {t('strategy.back')}
        </button>

        {phase === 'insufficient' && (
          <>
            <h1 className="s0-h1">{t('strategy.insufficient.title')}</h1>
            <p className="s0-lede">{t('strategy.insufficient.body')}</p>
            <button type="button" className="s0-btn" style={{ maxWidth: 320 }} disabled={busy} onClick={regenerate}>
              {busy ? t('common.loading') : t('strategy.retry')}
            </button>
          </>
        )}

        {(phase === 'proposal' || phase === 'current') && resp?.strategy && (
          <StrategyView
            resp={resp}
            current={phase === 'current'}
            t={t}
            busy={busy}
            correcting={correcting}
            correction={correction}
            setCorrection={setCorrection}
            onAdopt={adopt}
            onStartCorrect={() => setCorrecting(true)}
            onCancelCorrect={() => { setCorrecting(false); setCorrection(''); }}
            onSubmitCorrect={submitCorrection}
            onVoice={() => navigate(`/b/${id}/voice`)}
          />
        )}
      </div>
    </AppShell>
  );
}

function Block(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="s0-strat-block">
      <div className="s0-strat-label">{props.label}</div>
      {props.children}
    </div>
  );
}

function StrategyView(props: {
  resp: StrategyResp; current: boolean; t: T; busy: boolean;
  correcting: boolean; correction: string; setCorrection: (v: string) => void;
  onAdopt: () => void; onStartCorrect: () => void; onCancelCorrect: () => void; onSubmitCorrect: (kind: string) => void; onVoice: () => void;
}) {
  const { resp, current, t, busy, correcting, correction, setCorrection, onAdopt, onStartCorrect, onCancelCorrect, onSubmitCorrect, onVoice } = props;
  const s = resp.strategy!;
  const { core, branch } = s;

  return (
    <>
      <h1 className="s0-h1">{current ? t('strategy.current.title') : t('strategy.proposal.title')}</h1>
      {current && <p className="s0-strat-adopted">{t('strategy.current.sub')}</p>}

      <Block label={t('strategy.achieve')}>
        <p className="s0-strat-lead">{core.goal}{core.horizon ? ` · ${core.horizon}` : ''}</p>
        <p className="s0-strat-diag">{core.diagnosis}</p>
      </Block>

      <Block label={t('strategy.bet')}>
        <p className="s0-strat-lead">{core.coreBet.priority}</p>
        <p className="s0-strat-body">{core.coreBet.whyOverAlternative}</p>
      </Block>

      <Block label={t('strategy.prioritizing')}>
        <ul className="s0-strat-list">
          {branch.channelPriorities.map((c, i) => (
            <li key={i}><strong>{c.channel}</strong> — {c.whyGoal}</li>
          ))}
        </ul>
        {branch.ctaDirection && <p className="s0-strat-body">{t('strategy.next')}: {branch.ctaDirection}</p>}
        {branch.contentRole && <p className="s0-strat-body">{t('strategy.content')}: {branch.contentRole}</p>}
      </Block>

      <Block label={t('strategy.notnow')}>
        <ul className="s0-strat-list">
          {core.notNow.map((n, i) => <li key={i}><strong>{n.item}</strong> — {n.reason}</li>)}
          {core.coreBet.deprioritized && <li>{t('strategy.deprioritized')}: {core.coreBet.deprioritized}</li>}
        </ul>
      </Block>

      <details className="s0-why">
        <summary>{t('strategy.why')}</summary>
        <div className="s0-why-body">
          {core.coreBet.relationToGoal && <p>{core.coreBet.relationToGoal}</p>}
          {core.coreBet.founderFit && <p>{core.coreBet.founderFit}</p>}
          {core.coreBet.resourceFit && <p>{core.coreBet.resourceFit}</p>}
          {s.decisions.map((d, i) => (
            <div key={i} className="s0-strat-decision">
              <strong>{d.title}</strong>
              <div>{d.rationale}</div>
              {d.assumption && <div className="s0-strat-assume">{t('strategy.assumes')}: {d.assumption}</div>}
            </div>
          ))}
          {core.assumptions.length > 0 && (
            <div className="s0-strat-decision">
              <strong>{t('strategy.assumptions')}</strong>
              <ul className="s0-strat-list">{core.assumptions.map((a, i) => <li key={i}>{a.statement}</li>)}</ul>
            </div>
          )}
        </div>
      </details>

      <Block label={t('strategy.reconsider')}>
        <ul className="s0-strat-list">
          {core.reconsiderTriggers.map((r, i) => <li key={i}>{r.condition}</li>)}
        </ul>
      </Block>

      {!current && (
        <div className="s0-strat-actions">
          <button type="button" className="s0-btn" style={{ maxWidth: 320 }} disabled={busy} onClick={onAdopt}>
            {busy ? t('common.loading') : t('strategy.adopt')}
          </button>
          {!correcting ? (
            <button type="button" className="s0-linkbtn" onClick={onStartCorrect} style={{ marginTop: 14 }}>
              {t('strategy.correct')}
            </button>
          ) : (
            <div className="s0-strat-correct">
              <textarea value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder={t('strategy.correct.placeholder')} aria-label={t('strategy.correct.placeholder')} />
              <div className="s0-strat-correct-actions">
                <button type="button" className="s0-btn s0-btn-inline" disabled={busy || !correction.trim()} onClick={() => onSubmitCorrect('constraint')}>{t('strategy.correct.constraint')}</button>
                <button type="button" className="s0-btn s0-btn-inline" disabled={busy || !correction.trim()} onClick={() => onSubmitCorrect('business_correction')}>{t('strategy.correct.fact')}</button>
                <button type="button" className="s0-linkbtn" onClick={onCancelCorrect}>{t('strategy.correct.cancel')}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {current && (
        <div className="s0-strat-next">
          <p className="s0-strat-body">{t('strategy.postadopt')}</p>
          <button type="button" className="s0-btn" style={{ maxWidth: 320, marginTop: 14 }} onClick={onVoice}>
            {t('voice.continue')}
          </button>
        </div>
      )}
    </>
  );
}
