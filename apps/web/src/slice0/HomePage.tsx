import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useTalk } from './TalkDrawer';
import { ArcSurface } from './ArcSurface';
import { useLocale } from '../i18n/LocaleContext';
import { getArc, getHomeBriefing, type HomeBriefing, type HomeAction } from '../api/client';

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

  const load = useCallback(async () => {
    if (!id) return;
    setMode('loading');
    try {
      const arc = await getArc(id);
      if (arc.moment !== 'done') { setMode('arc'); return; }  // the arc owns the surface until it completes
      setBriefing(await getHomeBriefing(id));
      setMode('briefing');
    } catch { setMode('fail'); }
  }, [id]);
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
