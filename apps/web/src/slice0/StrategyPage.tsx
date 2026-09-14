import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import { isNotFound, LoadError } from './errors';
import {
  getBusiness, getCurrentStrategy, getStrategyProposal, regenerateStrategy, adoptStrategy, respondToStrategy,
  type Business, type StrategyResp,
} from '../api/client';

/**
 * Strategy — "what have we decided, and why?" A held DECISION, not a plan or a report. The bet dominates;
 * the trade-off and roads-not-taken hang off it; the reasoning is one reveal away; the reconsider triggers
 * make it a bounded decision, not dogma. Proposal ("what I'd recommend") and Current ("what we decided")
 * are visibly different states. Reuses the real strategy lifecycle end-to-end — no new semantics.
 */

type T = (k: string, v?: Record<string, string>) => string;
type Phase = 'loading' | 'insufficient' | 'proposal' | 'current';

export function StrategyPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  const [resp, setResp] = useState<StrategyResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(false);   // B3 — transient load failure, distinct from a true 404
  const [actionError, setActionError] = useState<string | null>(null); // B1 — a primary action that failed
  const started = useRef(false);

  async function load(bid: string) {
    setLoadErr(false);
    try {
      setBusiness(await getBusiness(bid));
      const cur = await getCurrentStrategy(bid);
      if (cur.state !== 'none' && cur.strategy) { setResp(cur); setPhase('current'); return; }
      applyProposal(await getStrategyProposal(bid));
    } catch (e) {
      // B3: only a definitive not-found/no-access routes away; a transient failure stays and offers retry.
      if (isNotFound(e)) setBusiness(null);
      else setLoadErr(true);
    }
  }

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    void load(id);
  }, [id]);

  function applyProposal(p: StrategyResp) {
    setResp(p);
    setPhase(p.status === 'proposal' && p.strategy ? 'proposal' : 'insufficient');
  }
  async function giveGoal(goal: string) {
    if (!id || !goal.trim()) return;
    setBusy(true); setActionError(null);
    try { applyProposal(await respondToStrategy(id, 'goal', goal.trim())); }
    catch { setActionError(t('common.actionFailed')); }
    finally { setBusy(false); }
  }
  async function adopt() {
    if (!id || !resp?.id) return;
    setBusy(true); setActionError(null);
    try { const c = await adoptStrategy(id, resp.id); setResp(c); setPhase('current'); }
    catch { setActionError(t('common.actionFailed')); }
    finally { setBusy(false); }
  }
  async function challenge(text: string) {
    if (!id || !text.trim()) return;
    setBusy(true); setActionError(null);
    try { applyProposal(await respondToStrategy(id, 'constraint', text.trim())); }
    catch { setActionError(t('common.actionFailed')); }
    finally { setBusy(false); }
  }

  if (loadErr) return <LoadError onRetry={() => { if (id) void load(id); }} />;
  if (business === undefined || phase === 'loading') {
    return <AppShell><div className="s0-strat2"><div className="s0-strat2-from">{t('common.loading')}</div></div></AppShell>;
  }
  if (business === null) return <Navigate to="/" replace />;

  const banner = actionError ? <div className="s0-error" role="alert">{actionError}</div> : null;

  const from = `${t('strat2.from')} ${business.name}`;

  if (phase === 'insufficient') {
    return <AppShell>{banner}<InsufficientView from={from} t={t} busy={busy} onGoal={giveGoal} onRegen={async () => { if (id) { setBusy(true); setActionError(null); try { applyProposal(await regenerateStrategy(id)); } catch { setActionError(t('common.actionFailed')); } finally { setBusy(false); } } }} /></AppShell>;
  }

  return (
    <AppShell>
      {banner}
      <StrategyView
        resp={resp!} current={phase === 'current'} from={from} t={t} busy={busy}
        onAdopt={adopt} onChallenge={challenge} onToday={() => navigate(`/b/${id}/today`)}
      />
    </AppShell>
  );
}

function InsufficientView({ from, t, busy, onGoal, onRegen }: { from: string; t: T; busy: boolean; onGoal: (g: string) => void; onRegen: () => void }) {
  const [goal, setGoal] = useState('');
  return (
    <div className="s0-strat2">
      <div className="s0-strat2-from">{from}</div>
      <p className="s0-strat2-lead">{t('strat2.insuff')}</p>
      <label className="s0-strat2-q">{t('strat2.goalQ')}</label>
      <textarea className="s0-strat2-field" rows={3} value={goal} autoFocus
        placeholder={t('strat2.goalPlace')} onChange={(e) => setGoal(e.target.value)} />
      <div className="s0-strat2-actions">
        <button type="button" className="s0-btn" disabled={busy || !goal.trim()} onClick={() => onGoal(goal)}>
          {busy ? t('strat2.forming') : t('strat2.goalSave')}
        </button>
        <button type="button" className="s0-btn-ghost" disabled={busy} onClick={onRegen}>{t('strat2.retry')}</button>
      </div>
    </div>
  );
}

function StrategyView({ resp, current, from, t, busy, onAdopt, onChallenge, onToday }: {
  resp: StrategyResp; current: boolean; from: string; t: T; busy: boolean;
  onAdopt: () => void; onChallenge: (text: string) => void; onToday: () => void;
}) {
  const s = resp.strategy!;
  const core = s.core;
  const [challenging, setChallenging] = useState(false);
  const [text, setText] = useState('');
  const [showAllNotNow, setShowAllNotNow] = useState(false);

  const bet = (core.coreBet.priority || core.goal || '').trim();
  const trade = core.tradeOffs.find((x) => x.choosing && x.over);
  const over = trade?.over || core.coreBet.deprioritized || '';
  const whyBits = [core.coreBet.whyOverAlternative, core.coreBet.relationToGoal, core.coreBet.founderFit, core.coreBet.resourceFit].map((x) => (x ?? '').trim()).filter(Boolean);
  const notNow = core.notNow.filter((n) => (n.item ?? '').trim());
  const triggers = core.reconsiderTriggers.map((r) => (r.condition ?? '').trim()).filter(Boolean);
  const notNowShown = showAllNotNow ? notNow : notNow.slice(0, 3);

  function send() { const v = text.trim(); if (!v || busy) return; onChallenge(v); setText(''); setChallenging(false); }

  return (
    <div className="s0-strat2">
      <div className="s0-strat2-from">{from}</div>
      {!current ? <p className="s0-strat2-lead">{t('strat2.recommend')}</p> : null}

      <div className="s0-bet-k">{t('strat2.betK')}</div>
      <h1 className={bet.length > 180 ? 's0-bet s0-bet-long' : 's0-bet'}>{bet}</h1>
      {(trade || over) ? (
        <p className="s0-bet-trade">
          {trade ? <>{t('strat2.choosing')} <span className="em">{trade.choosing}</span> </> : null}
          {over ? <span className="over">{t('strat2.over')} {over}</span> : null}
        </p>
      ) : null}
      <div className={current ? 's0-strat2-state s0-state-held' : 's0-strat2-state'}>
        {current ? t('strat2.holding') : t('strat2.proposed')}
      </div>

      {whyBits.length > 0 ? (
        <div className="s0-why3">
          <div className="s0-why3-k">{t('strat2.why')}</div>
          <p className="s0-why3-lead">{whyBits[0]}</p>
          {whyBits.length > 1 ? (
            <details className="s0-why3-more">
              <summary>{t('strat2.whyMore')} <span className="s0-why2-caret">↓</span></summary>
              <div className="s0-why3-body">{whyBits.slice(1, 4).map((w, i) => <p key={i}>{w}</p>)}</div>
            </details>
          ) : null}
        </div>
      ) : null}

      {notNow.length > 0 ? (
        <section className="s0-strat2-sec">
          <div className="s0-strat2-k">{t('strat2.notnow')}</div>
          <ul className="s0-notnow">
            {notNowShown.map((n, i) => <li key={i}><span className="struck">{n.item}</span>{n.reason ? <span className="reason"> — {n.reason}</span> : null}</li>)}
          </ul>
          {notNow.length > 3 ? (
            <button type="button" className="s0-strat2-more" onClick={() => setShowAllNotNow((v) => !v)}>
              {showAllNotNow ? t('strat2.less') : t('strat2.more', { n: String(notNow.length - 3) })}
            </button>
          ) : null}
        </section>
      ) : null}

      {triggers.length > 0 ? (
        <section className="s0-strat2-sec">
          <div className="s0-strat2-k">{t('strat2.reconsider')}</div>
          <ul className="s0-reconsider">{triggers.slice(0, 4).map((c, i) => <li key={i}>{c}</li>)}</ul>
        </section>
      ) : null}

      <div className="s0-strat2-foot">
        <div className="s0-strat2-actions">
          {current ? (
            // Execution flows to Today. Content/voice is downstream and CONDITIONAL — BB recommends it when
            // it's relevant, so Strategy no longer jumps straight into content (R2A journey correction).
            <button type="button" className="s0-btn" onClick={onToday}>{t('strat2.today')} →</button>
          ) : (
            <button type="button" className="s0-btn" disabled={busy} onClick={onAdopt}>{busy ? t('strat2.forming') : t('strat2.adopt')}</button>
          )}
          {!challenging ? (
            <button type="button" className="s0-strat2-challenge" onClick={() => { setChallenging(true); setText(''); }}>{t('strat2.challenge')}</button>
          ) : null}
        </div>
        {busy && !challenging ? <p className="s0-strat2-forming-note">{t('strat2.forming')}</p> : null}
        {challenging ? (
          <div className="s0-challenge">
            <label className="s0-strat2-q">{t('strat2.challengeQ')}</label>
            <textarea className="s0-strat2-field" rows={3} value={text} autoFocus placeholder={t('strat2.challengePlace')} onChange={(e) => setText(e.target.value)} />
            <div className="s0-strat2-actions">
              <button type="button" className="s0-btn" disabled={busy || !text.trim()} onClick={send}>{busy ? t('strat2.forming') : t('strat2.send')}</button>
              <button type="button" className="s0-btn-ghost" onClick={() => setChallenging(false)}>{t('strat2.cancel')}</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
