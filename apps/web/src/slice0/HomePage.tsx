import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useTalk } from './TalkDrawer';
import { useLocale } from '../i18n/LocaleContext';
import { getHomeBriefing, learnBusiness, type HomeBriefing, type HomeAction } from '../api/client';

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
          <EmptyState t={t} businessId={id ?? ''} onFocusInput={() => inputRef.current?.focus()} />
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

type Tf = (k: string, v?: Record<string, string>) => string;

/**
 * First open — the pour-in. The connectors are the primary path, website first, top to bottom: a founder with
 * a live business CONNECTS. "Tell me in a few words" is the demoted fallback for a founder with no business yet.
 * Only the website backend works for Day One (the real learn flow); the others are visible and lead to a
 * calm "wiring this up" note. Once a website is read, the strategist bridges into the arc.
 */
function EmptyState({ t, businessId, onFocusInput }: { t: Tf; businessId: string; onFocusInput: () => void }) {
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [bridged, setBridged] = useState(false);
  const [err, setErr] = useState(false);
  const [soon, setSoon] = useState(false); // a not-yet-wired connector was tapped

  async function addWebsite(e: React.FormEvent) {
    e.preventDefault();
    const u = url.trim();
    if (!u || adding || !businessId) return;
    setAdding(true); setErr(false);
    try { await learnBusiness(businessId, u); setBridged(true); onFocusInput(); }
    catch { setErr(true); }
    finally { setAdding(false); }
  }

  // Once a source is read, the strategist responds and invites a few words — the bridge into the arc.
  if (bridged) {
    return (
      <div className="s0-strat-msg">
        <p className="s0-strat-msg-line">{t('home.empty.bridge')}</p>
      </div>
    );
  }

  const soonConnectors: { key: string; hint?: string }[] = [
    { key: 'home.empty.ig' },
    { key: 'home.empty.google' },
    { key: 'home.empty.doc', hint: 'home.empty.doc.hint' },
    { key: 'home.empty.link' },
  ];

  return (
    <>
      <div className="s0-strat-msg">
        <p className="s0-strat-msg-line">{t('home.empty.lead')}</p>
        <p className="s0-strat-msg-line s0-strat-msg-sub">{t('home.empty.sub')}</p>
      </div>

      <div className="s0-pourin">
        {/* Website — the primary path, a real field that runs the learn engine. */}
        <form className="s0-pourin-web" onSubmit={addWebsite}>
          <label className="s0-pourin-web-k">{t('home.empty.website')}</label>
          <div className="s0-pourin-web-row">
            <input
              className="s0-pourin-web-input" type="text" inputMode="url" value={url}
              placeholder={t('home.empty.website.ph')} onChange={(e) => setUrl(e.target.value)} disabled={adding}
              aria-label={t('home.empty.website')}
            />
            <button type="submit" className="s0-btn s0-btn-inline" disabled={adding || !url.trim()}>
              {adding ? t('home.empty.adding') : t('home.empty.website.add')}
            </button>
          </div>
          {err ? <div className="s0-error" role="alert">{t('common.actionFailed')}</div> : null}
        </form>

        {/* The other connectors — visible, ordered, marked "next"; they lead to a calm wiring-up note. */}
        <ul className="s0-pourin-list">
          {soonConnectors.map((c) => (
            <li key={c.key}>
              <button type="button" className="s0-pourin-item" onClick={() => setSoon(true)}>
                <span className="s0-pourin-item-label">{t(c.key)}{c.hint ? <span className="s0-pourin-item-hint"> · {t(c.hint)}</span> : null}</span>
                <span className="s0-pourin-soon">{t('home.empty.soon')}</span>
              </button>
            </li>
          ))}
        </ul>
        {soon ? <p className="s0-pourin-wiring">{t('home.empty.wiring')}</p> : null}
      </div>

      {/* Demoted: the words fallback for a founder with no live business yet. */}
      <div className="s0-pourin-words">
        <button type="button" className="s0-linkbtn" onClick={onFocusInput}>{t('home.empty.words')}</button>
      </div>
    </>
  );
}
