import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useTalk } from './TalkDrawer';
import { useLocale } from '../i18n/LocaleContext';
import { getHomeBriefing, type HomeBriefing, type HomeAction } from '../api/client';

/**
 * THE HOME SURFACE (Surface Correction, Block 1) — the strategist's presence, not a dashboard.
 *
 * A consultant who has already spoken: a single line of context, one short message (composed from held
 * state by the backend), three actions, and an always-present input. No tabs, no dashboard, no empty input
 * waiting. The engine is not shown — its reasoning is felt. "Show me why" and the deeper surfaces are
 * reachable, never primary.
 */
export function HomePage(): React.ReactElement {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { open: openTalk } = useTalk();
  const base = `/b/${id}`;

  const [briefing, setBriefing] = useState<HomeBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;
    if (!id) return;
    setLoading(true); setFailed(false);
    void getHomeBriefing(id).then((b) => { if (live) { setBriefing(b); setLoading(false); } })
      .catch(() => { if (live) { setFailed(true); setLoading(false); } });
    return () => { live = false; };
  }, [id]);

  // The founder can type at any moment. Submitting engages the strategist in the Talk conversation (which
  // resumes and carries the current surface context). No modes, no categories — plain language.
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    openTalk();
  }

  function onAction(a: HomeAction) {
    if (a.kind === 'talk') { inputRef.current?.focus(); return; }        // "let's talk" → the input
    if (a.to) { navigate(`${base}${a.to}`); return; }                     // "do the work" / "why" → the surface behind it
    openTalk();                                                           // do-with-null → BB works it through in Talk
  }

  // The context line: "<name> · <weekday> · Day N of the <bet> bet" — the weekday is rendered in the founder's locale.
  const contextLine = (b: HomeBriefing): string => {
    const weekday = new Date().toLocaleDateString(locale, { weekday: 'long' });
    const head = `${b.context.name} · ${weekday}`;
    if (b.phase === 'briefing' && b.context.day && b.context.bet) {
      return `${head} · ${t('home.ctx.day', { day: String(b.context.day), bet: b.context.bet })}`;
    }
    return head;
  };

  return (
    <AppShell home>
      <div className="s0-strat">
        {loading ? (
          <div className="s0-strat-ctx s0-home-skel" aria-hidden="true">&nbsp;</div>
        ) : failed || !briefing ? (
          <>
            <div className="s0-strat-ctx">{t('home.failctx')}</div>
            <p className="s0-strat-msg-line">{t('home.fail')}</p>
            <div className="s0-strat-actions">
              <button type="button" className="s0-btn" onClick={() => id && navigate(0 as never)}>{t('common.retry')}</button>
            </div>
          </>
        ) : briefing.phase === 'empty' ? (
          <EmptyState t={t} onTalk={() => inputRef.current?.focus()} />
        ) : (
          <>
            <div className="s0-strat-ctx">{contextLine(briefing)}</div>
            <div className="s0-strat-msg">
              {briefing.lines.map((l, i) => (
                <p key={i} className="s0-strat-msg-line">{t(l.key, l.vars)}</p>
              ))}
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
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('home.input.ph')}
            aria-label={t('home.input.ph')}
            rows={2}
          />
          <button type="submit" className="s0-btn s0-btn-inline" disabled={!draft.trim()}>{t('home.input.send')}</button>
        </form>
      </div>
    </AppShell>
  );
}

/** First open — the pour-in surface (Block 2 refines the source connectors). */
function EmptyState({ t, onTalk }: { t: (k: string, v?: Record<string, string>) => string; onTalk: () => void }) {
  return (
    <>
      <div className="s0-strat-ctx">{t('home.empty.ctx')}</div>
      <div className="s0-strat-msg">
        <p className="s0-strat-msg-line">{t('home.empty.lead')}</p>
        <p className="s0-strat-msg-line s0-strat-msg-sub">{t('home.empty.sub')}</p>
      </div>
      <div className="s0-strat-actions">
        <button type="button" className="s0-btn-ghost" onClick={onTalk}>{t('home.empty.tell')}</button>
      </div>
    </>
  );
}
