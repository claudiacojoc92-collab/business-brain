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
type Source = { id: number; url: string; status: 'reading' | 'done' | 'failed'; error?: string };

function EmptyState({ t, businessId, onFocusInput }: { t: Tf; businessId: string; onFocusInput: () => void }) {
  const [url, setUrl] = useState('');
  const [bridged, setBridged] = useState(false);
  const [soonKey, setSoonKey] = useState<string | null>(null); // WHICH not-yet-wired connector was tapped
  const [sources, setSources] = useState<Source[]>([]);        // the pour-in is a PHASE: many sources, one at a time
  const nextId = useRef(0);

  // Adding a website does NOT end the pour-in. It appends a source, reads it in the BACKGROUND (so the founder
  // can keep adding), and marks it added ✓ / the real reason on failure. The phase ends only on "Done adding".
  function addWebsite(e: React.FormEvent) {
    e.preventDefault();
    const u = url.trim();
    if (!u || !businessId) return;
    const id = nextId.current++;
    setSources((prev) => [...prev, { id, url: u, status: 'reading' }]);
    setUrl('');
    const settle = (patch: Partial<Source>) => setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    learnBusiness(businessId, u)
      .then((res) => {
        if (res.state === 'synced' || res.state === 'partial') settle({ status: 'done' });
        else settle({ status: 'failed', error: res.error?.trim() || (res.state === 'empty' ? t('home.empty.readfail') : t('home.empty.unreachable')) });
      })
      .catch(() => settle({ status: 'failed', error: t('home.empty.unreachable') }));
  }

  // Once a source is added, the strategist responds and invites a few words — the bridge into the arc.
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
  // "Done adding — start" appears as soon as at least one source is in (reading or read) — the founder chooses
  // when the pour-in ends. A source that only failed doesn't count.
  const canStart = sources.some((s) => s.status !== 'failed');

  return (
    <>
      <div className="s0-strat-msg">
        <p className="s0-strat-msg-line">{t('home.empty.lead')}</p>
        <p className="s0-strat-msg-line s0-strat-msg-sub">{t('home.empty.sub')}</p>
      </div>

      <div className="s0-pourin">
        {/* Website — the primary path, a real field that runs the learn engine. It stays open to add more. */}
        <form className="s0-pourin-web" onSubmit={addWebsite}>
          <label className="s0-pourin-web-k">{t('home.empty.website')}</label>
          <div className="s0-pourin-web-row">
            <input
              className="s0-pourin-web-input" type="text" inputMode="url" value={url}
              placeholder={t('home.empty.website.ph')} onChange={(e) => setUrl(e.target.value)}
              aria-label={t('home.empty.website')}
            />
            <button type="submit" className="s0-btn s0-btn-inline" disabled={!url.trim()}>{t('home.empty.website.add')}</button>
          </div>
          {sources.length > 0 ? (
            <ul className="s0-pourin-sources">
              {sources.map((s) => (
                <li key={s.id} className={`s0-pourin-source s0-pourin-source-${s.status}`}>
                  <span className="s0-pourin-source-url">{s.url}</span>
                  {s.status === 'reading' ? <span className="s0-pourin-source-status">{t('home.empty.reading')}</span> : null}
                  {s.status === 'done' ? <span className="s0-pourin-source-status s0-pourin-added">{t('home.empty.added')}</span> : null}
                  {s.status === 'failed' ? <span className="s0-pourin-source-err">{s.error}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </form>

        {/* The other connectors — visible, ordered, marked "next". The wiring note is PER-CONNECTOR. */}
        <ul className="s0-pourin-list">
          {soonConnectors.map((c) => (
            <li key={c.key}>
              <button type="button" className="s0-pourin-item" onClick={() => setSoonKey(c.key)}>
                <span className="s0-pourin-item-label">{t(c.key)}{c.hint ? <span className="s0-pourin-item-hint"> · {t(c.hint)}</span> : null}</span>
                <span className="s0-pourin-soon">{t('home.empty.soon')}</span>
              </button>
              {soonKey === c.key ? <p className="s0-pourin-wiring">{t('home.empty.wiring')}</p> : null}
            </li>
          ))}
        </ul>

        {/* Quiet "I'm finished, start" — appears once a source is in; the founder ends the pour-in, not the product. */}
        {canStart ? (
          <button type="button" className="s0-pourin-done" onClick={() => { setBridged(true); onFocusInput(); }}>{t('home.empty.done')}</button>
        ) : null}
      </div>

      {/* Demoted: the words fallback for a founder with no live business yet. */}
      <div className="s0-pourin-words">
        <button type="button" className="s0-linkbtn" onClick={onFocusInput}>{t('home.empty.words')}</button>
      </div>
    </>
  );
}
