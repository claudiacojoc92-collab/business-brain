import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useTalk } from './TalkDrawer';
import { ArcSurface } from './ArcSurface';
import { useLocale } from '../i18n/LocaleContext';
import { getArc, getHomeBriefing, evaluateImpact, ApiError, type HomeBriefing, type HomeAction, type ImpactResult } from '../api/client';
import { VerdictSurface } from './VerdictSurface';
import { ArcWorking } from './ArcWorking';
import { actionErrorKey } from './errors';

/**
 * THE HOME SURFACE. While the Day One arc is in progress (Moments 1–9), the strategist carries the founder
 * through it on the ArcSurface — one continuous flow, no tabs. Once the arc is `done`, this becomes the
 * standing strategist briefing (Surface Correction): a context line, one short message, three actions, and an
 * always-present input. Either way the founder sees a presence, never the engine.
 */
export function HomePage(): React.ReactElement {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { open: openTalk } = useTalk();
  const base = `/b/${id}`;

  const [mode, setMode] = useState<'loading' | 'arc' | 'briefing' | 'fail'>('loading');
  const [briefing, setBriefing] = useState<HomeBriefing | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Month two — the cycle-close answer + the verdict it produces (rendered on the home surface itself).
  const [closeText, setCloseText] = useState('');
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<ImpactResult | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setMode('loading');
    try {
      const arc = await getArc(id);
      if (arc.moment !== 'done') { setMode('arc'); return; }  // the arc owns the surface until it completes
      setBriefing(await getHomeBriefing(id));
      setMode('briefing');
    } catch (e) {
      // FIX 4A — a deleted or inaccessible business (404/403) must never strand the founder on a dead retry.
      // Recover to /home (the businesses list / create-first state) instead of showing a reload that can't succeed.
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) { navigate('/home', { replace: true }); return; }
      setMode('fail');
    }
  }, [id, navigate]);
  useEffect(() => { void load(); }, [load]);

  function submit(e: React.FormEvent) { e.preventDefault(); if (draft.trim()) openTalk(); }

  function onAction(a: HomeAction) {
    if (a.kind === 'talk') { inputRef.current?.focus(); return; }
    if (a.to) { navigate(`${base}${a.to}`); return; }
    openTalk();
  }

  const contextLine = (b: HomeBriefing): string => {
    const weekday = new Date().toLocaleDateString(locale, { weekday: 'long' });
    const head = `${b.context.name} · ${weekday}`;
    return (b.phase === 'briefing' && b.context.day && b.context.bet)
      ? `${head} · ${t('home.ctx.day', { day: String(b.context.day), bet: b.context.bet })}`
      : head;
  };

  // While the arc runs, the ArcSurface IS the surface (it renders its own message/actions/input per moment).
  if (mode === 'arc' && id) {
    return <AppShell home><ArcSurface businessId={id} onDone={() => void load()} /></AppShell>;
  }

  async function submitClose(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !closeText.trim() || closeBusy) return;
    setCloseBusy(true); setCloseErr(null);
    // The server evaluates (model call) BEFORE it persists, so a failure here wrote nothing — keep the founder's
    // reflection in the box and show why, so a retry runs on the same text with no retyping and no risk of a
    // duplicate. (Do NOT drop to the generic 'fail' surface, which hid the text and offered only a full reload.)
    try { setVerdict(await evaluateImpact(id, 'outcome_report', closeText.trim())); }
    catch (e) { setCloseErr(t(actionErrorKey(e))); }
    finally { setCloseBusy(false); }
  }

  // MONTH TWO — the cycle is complete. The verdict surface handles it end to end: on REVISE/RECONSIDER the founder
  // adopts a revised strategy which proposes+adopts the next (progress-aware) plan; on STILL_HOLDS/TUNE it routes
  // to this month's plan. Before answering, the founder sees the calm close prompt + a two-line answer field.
  if (mode === 'briefing' && briefing?.phase === 'cycle_close' && id) {
    if (verdict) {
      return (
        <AppShell home>
          <VerdictSurface businessId={id} result={verdict}
            onDismiss={() => { setVerdict(null); setCloseText(''); void load(); }}
            onAdopted={() => navigate(`${base}/today`)} />
        </AppShell>
      );
    }
    return (
      <AppShell home>
        <div className="s0-strat">
          <div className="s0-strat-ctx">{contextLine(briefing)}</div>
          <div className="s0-strat-msg">
            {briefing.lines.map((l, i) => <p key={i} className="s0-strat-msg-line">{t(l.key, l.vars)}</p>)}
          </div>
          {closeBusy ? (
            <ArcWorking t={t} messageKey="arc.working.thinking" />
          ) : (
            <form className="s0-strat-input" onSubmit={submitClose}>
              <textarea value={closeText} onChange={(e) => { setCloseText(e.target.value); if (closeErr) setCloseErr(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitClose(e as unknown as React.FormEvent); } }}
                placeholder={t('home.close.answer')} aria-label={t('home.close.ask')} rows={2} />
              {closeErr && <p className="s0-error" role="alert">{closeErr}</p>}
              <button type="submit" className="s0-btn s0-btn-inline" disabled={!closeText.trim()}>{t('home.close.answer')}</button>
            </form>
          )}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell home>
      <div className="s0-strat">
        {mode === 'loading' ? (
          <div className="s0-strat-ctx s0-home-skel" aria-hidden="true">&nbsp;</div>
        ) : mode === 'fail' || !briefing ? (
          <>
            <div className="s0-strat-ctx">{t('home.failctx')}</div>
            <p className="s0-strat-msg-line">{t('home.fail')}</p>
            <div className="s0-strat-actions">
              <button type="button" className="s0-btn" onClick={() => id && navigate(0 as never)}>{t('common.retry')}</button>
              {/* FIX 4C — every fail screen carries a way out, so a founder is never trapped on one URL. */}
              <a href="/home" className="s0-btn-quiet">{t('home.tobusinesses')}</a>
            </div>
          </>
        ) : (
          <>
            <div className="s0-strat-ctx">{contextLine(briefing)}</div>
            <div className="s0-strat-msg">
              {briefing.lines.map((l, i) => <p key={i} className="s0-strat-msg-line">{t(l.key, l.vars)}</p>)}
            </div>
            <div className="s0-strat-actions">
              {briefing.actions.map((a, i) => (
                <button key={i} type="button" className={i === 0 ? 's0-btn' : 's0-btn-ghost'} onClick={() => onAction(a)}>
                  {t(a.labelKey)}{a.kind === 'do' ? ' →' : ''}
                </button>
              ))}
            </div>
          </>
        )}

        {/* The always-present input — the founder can say anything, any time. */}
        <form className="s0-strat-input" onSubmit={submit}>
          <textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('home.input.ph')} aria-label={t('home.input.ph')} rows={2} />
          <button type="submit" className="s0-btn s0-btn-inline" disabled={!draft.trim()}>{t('home.input.send')}</button>
        </form>
      </div>
    </AppShell>
  );
}
