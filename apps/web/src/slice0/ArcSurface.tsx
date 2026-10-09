import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { translate, isLocale } from '../i18n/messages';
import { isNotFound } from './errors';
import { parseOpenerTurn, type ArcOpener } from './parse-briefing';
import {
  getArc, arcAddSource, arcAddLink, arcAddText, arcAddFile, arcAddInstagram, getInstagramConnectUrl, getArcSources, arcRemoveSource,
  arcPourInDone, arcConversation, arcConfirmUnderstanding, arcCorrectUnderstanding,
  arcMirrorSeen, arcAdoptStrategy, arcChallengeStrategy, arcAdoptWeekDay, arcGenerateEmail,
  arcSaveEmail, arcExportEmail, arcContainerSeen, arcConfirmGoal, arcSkipQuestion, type ArcView, type ArcSourceItem,
} from '../api/client';
// Instagram is back in the pour-in (2026-10-08) via the DIRECT Instagram Login connector: it authorizes whatever
// Instagram account the browser is logged into (no Business-vs-personal picker). The Page-picker flow via Facebook
// Login for Business is the later Option B, see docs/sources/instagram-arc-connector-later.md.

import { ArcWorking, type T } from './ArcWorking';

// Pour-in source errors arrive from the API as stable CODES (never English) — rendered here in the founder's
// language. Unknown/absent code falls back to the caller's generic key.
const SRC_ERR_KEY: Record<string, string> = {
  FILE_TOO_LARGE: 'arc.src.fileTooLarge', FILE_NONE: 'arc.src.fileNone', FILE_UNSUPPORTED: 'arc.src.fileUnsupported',
  FILE_UNREADABLE: 'arc.src.fileUnreadable', FILE_PDF_IMAGE: 'arc.src.filePdfImage', FILE_NO_TEXT: 'arc.src.fileNoText',
  IG_NOT_CONFIGURED: 'arc.src.igNotConfigured', IG_NOT_CONNECTED: 'arc.src.igNotConnected',
  IG_NO_CAPTIONS: 'arc.src.igNoCaptions', IG_READ_FAILED: 'arc.src.igReadFailed',
};
const srcErr = (code: string | undefined, t: T, fallbackKey: string): string =>
  (code && SRC_ERR_KEY[code]) ? t(SRC_ERR_KEY[code]) : t(fallbackKey);

// These MUST live at module scope — never inside ArcSurface's body. A component defined inside another
// component is recreated with a NEW identity on every render, so React unmounts + remounts it; a focused
// <textarea>/<input> then loses focus after a single keystroke (setText → re-render → remount). Hoisting keeps
// the DOM node stable across re-renders, so the founder can type continuously. State is passed in as props.
function ArcMsg({ lines }: { lines: string[] }) {
  return <div className="s0-strat-msg">{lines.filter(Boolean).map((l, i) => <p key={i} className="s0-strat-msg-line">{l}</p>)}</div>;
}
// A premium diagnosis CARD for the understanding moment — its own surface, a clay-accented label, and roomy
// bullets. `kind` gives each card a distinct, intentional treatment: primary (the diagnosis core, clay bar),
// evidence (warm/confident tint), inference (muted, hollow markers — "I could be wrong"), question (a dashed,
// clay-tinted invitation — "your turn"). Renders nothing when the section is empty. Design-only.
// One small, meaningful glyph per lane: ◆ the core reading, ✓ what the sources back, ~ what BB infers (unsure),
// → the open question for the founder. aria-hidden — the label carries the meaning for assistive tech.
const U_ICON: Record<string, string> = { primary: '◆', evidence: '✓', inference: '~', question: '→' };
function UCard({ label, kind, paragraph, bullets }: { label: string; kind: 'primary' | 'evidence' | 'inference' | 'question'; paragraph?: string; bullets?: string[] }) {
  const items = (bullets ?? []).map((b) => (b ?? '').trim()).filter(Boolean);
  const lead = (paragraph ?? '').trim();
  if (!lead && items.length === 0) return null;
  return (
    <div className={`s0-u-card s0-u-card--${kind}`}>
      <div className="s0-u-card-label"><span className="s0-u-ic" aria-hidden="true">{U_ICON[kind]}</span>{label}</div>
      {lead ? <p className="s0-u-card-lead">{lead}</p> : null}
      {items.length ? <ul className="s0-u-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
    </div>
  );
}
function ArcInput({ ph, onSend, cta, t, text, setText, busy, act, workingKey, autoFocus }: {
  ph: string; onSend: (m: string) => Promise<ArcView>; cta?: string; t: T;
  text: string; setText: (s: string) => void; busy: boolean; act: (run: () => Promise<ArcView>, workingKey?: string) => Promise<void>; workingKey?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // When a box is REVEALED on demand (the strategy "let's talk" box), bring it into view and focus it — otherwise it
  // renders below the buttons, can land below the fold, and reads as "the button did nothing".
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (el) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* jsdom / unsupported */ } el.focus(); }
  }, [autoFocus]);
  return (
    <form className="s0-strat-input" onSubmit={(e) => { e.preventDefault(); if (!busy && text.trim()) void act(() => onSend(text.trim()), workingKey); }}>
      {/* Enter submits (chat convention); Shift+Enter inserts a newline. Empty/whitespace or busy → no-op. The Send
          button below stays for mouse users. */}
      <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy && text.trim()) void act(() => onSend(text.trim()), workingKey); } }}
        placeholder={ph} aria-label={ph} rows={2} disabled={busy} />
      <button type="submit" className="s0-btn s0-btn-inline" disabled={busy || !text.trim()}>{cta ?? t('arc.send')}</button>
    </form>
  );
}

// FIX 2c — a tension card that shows each tension line + ONE muted grounding line, so the referent resolves in the
// card (the field the tension names) without stacking three sentences.
// Ranked, not listed: the first tension is THE primary insight (the server orders them: a capability gap first,
// otherwise the model's ranking), shown large; the rest sit under "Also" as secondary.
function TensionCard({ label, items, whyLabel, alsoLabel }: { label: string; items: { tension: string; grounding: string; sourceRefs: string[] }[]; whyLabel: string; alsoLabel: string }) {
  const rows = items.filter((x) => (x.tension ?? '').trim());
  if (!rows.length) return null; // zero tensions → the card is omitted silently (never narrate an absence)
  const row = (x: { tension: string; grounding: string; sourceRefs: string[] }) => (
    <>
      {x.tension}
      {x.grounding ? <span className="s0-u-grounding">{x.grounding}</span> : null}
      {/* proof on demand: collapsed by default — the grounding already carries the concrete fact. */}
      {x.sourceRefs.length ? (
        <details className="s0-u-why">
          <summary>{whyLabel}</summary>
          <ul className="s0-u-why-list">{x.sourceRefs.map((s, j) => <li key={j}>{s}</li>)}</ul>
        </details>
      ) : null}
    </>
  );
  const [primary, ...rest] = rows;
  return (
    <div className="s0-u-card s0-u-card--primary">
      <div className="s0-u-card-label"><span className="s0-u-ic" aria-hidden="true">◆</span>{label}</div>
      <div className="s0-u-primary">{row(primary!)}</div>
      {rest.length ? (
        <>
          <div className="s0-u-also">{alsoLabel}</div>
          <ul className="s0-u-list">{rest.map((x, i) => <li key={i}>{row(x)}</li>)}</ul>
        </>
      ) : null}
    </div>
  );
}

// FIX 3 — the quiet coverage "map": which core areas are mapped (●) and which are left (○). Not a progress bar —
// it conveys the terrain so a multi-turn interview reads as covering ground, not drifting.
function CoverageChips({ items, t }: { items: { key: string; covered: boolean }[]; t: T }) {
  if (!items.length) return null;
  return (
    <div className="s0-coverage" role="status" aria-label={t('arc.coverage.aria')}>
      {items.map((c) => (
        <span key={c.key} className={`s0-chip${c.covered ? ' is-covered' : ''}`}>
          <span className="s0-chip-dot" aria-hidden="true">{c.covered ? '●' : '○'}</span>{t(`arc.coverage.${c.key}`)}
        </span>
      ))}
    </div>
  );
}

// REFLECT-BACK goal confirmation. This is the best moment in the product, NOT a failure — the founder sees their
// own words reflected back correctly. Deliberately NOT styled as an error (no warning colour, no icon, no apology).
// The reflected statement renders VERBATIM in the language it was captured in (the founder's own words); the field
// holds the FULL statement (incl. the "nu"/"not" trade-off half) and never truncates. Editing writes what the
// founder leaves in the field. Hoisted to module scope so its text state survives re-renders (focus is kept).
function GoalConfirm({ candidate, t, busy, onConfirm }: {
  candidate: { stateId: string | null; statement: string } | null; t: T; busy: boolean;
  onConfirm: (statement: string, fromStateId: string | null) => void;
}) {
  const cold = !candidate;
  const [text, setText] = useState(candidate?.statement ?? '');
  return (
    <div className="s0-goal-confirm">
      <ArcMsg lines={[t('arc.goal.heading')]} />
      <p className="s0-strat-msg-line">{cold ? t('arc.goal.askcold') : t('arc.goal.reflect')}</p>
      <textarea
        className="s0-goal-field" value={text} onChange={(e) => setText(e.target.value)} rows={3} disabled={busy}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!busy && text.trim()) onConfirm(text.trim(), candidate?.stateId ?? null); } }}
        aria-label={t('arc.goal.fieldlabel')} placeholder={cold ? t('arc.goal.placeholder') : ''}
      />
      <div className="s0-strat-actions">
        <button type="button" className="s0-btn" disabled={busy || !text.trim()} onClick={() => onConfirm(text.trim(), candidate?.stateId ?? null)}>{t('arc.goal.confirm')} →</button>
        {!cold ? <button type="button" className="s0-btn-quiet" disabled={busy} onClick={() => setText('')}>{t('arc.goal.notit')}</button> : null}
      </div>
    </div>
  );
}

// THE shared "the strategist asks the founder a question" component. A question is the start of the next turn —
// it must be UNMISSABLE (its own bordered card + a "Question for you" label + prominent text), never quiet
// italic prose. Used everywhere the strategist asks: the Moment 3 correction reflection, the Moment 4
// conversation question, the Moment 5 mirror question — one place, so every question looks the same.
function ArcQuestion({ text, t }: { text: string; t: T }) {
  if (!text.trim()) return null;
  return (
    <div className="s0-arc-question" role="group" aria-label={t('arc.question.label')}>
      <div className="s0-arc-question-tag">{t('arc.question.label')}</div>
      <p className="s0-arc-question-text">{text}</p>
    </div>
  );
}

// THE conversation thread — the exchange rendered as a VISIBLE, growing sequence (not one current message with
// the history hidden behind a toggle). Every turn shows top-to-bottom: the founder's turns labelled "You" and
// visually distinct, the strategist's as plain "Business Brain" messages, and the CURRENT question (the last
// bb turn) as the prominent ArcQuestion at the end. Auto-scrolls to the newest exchange; the older ones stay
// above (scroll up = read the thread). The input sits below this. Rendering only — the engine is untouched.
type ThreadTurn = { id: string; role: 'founder' | 'bb'; content: string };
function ArcThread({ turns, t }: { turns: ThreadTurn[]; t: T }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [turns.length]);
  let lastBb = -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) { if (turns[i]?.role === 'bb') { lastBb = i; break; } }
  return (
    <div className="s0-cthread">
      {turns.map((tn, i) => {
        // The opener turn is STRUCTURED (a short pointer) — render it as such, never as a prose blob. Its
        // invitation is the clay question card only when it is the current (last) turn; once the conversation has
        // grown it's a plain trailing line.
        const opener = tn.role === 'bb' ? parseOpenerTurn(tn.content) : null;
        if (opener) return <ArcOpenerView key={tn.id} opener={opener} t={t} asQuestion={i === lastBb} />;
        return tn.role === 'bb' && i === lastBb
          ? <ArcQuestion key={tn.id} text={tn.content} t={t} />
          : (
            <div key={tn.id} className={tn.role === 'founder' ? 's0-cturn s0-cturn-you' : 's0-cturn s0-cturn-bb'}>
              <div className="s0-cturn-who">{tn.role === 'founder' ? t('arc.thread.you') : t('arc.thread.bb')}</div>
              <p className="s0-cturn-text">{tn.content}</p>
            </div>
          );
      })}
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}

// "BB is working" — an animated, alive progress state shown while a model runs (so the founder never sees a
// frozen screen). Escalates to a "still working…" line after ~12s so a long generation (strategy/plan) still
// reads as progress, not a hang. Message is content-language (via t).

// The Moment 4 opener — a SHORT structured pointer (lead + ≤3 one-line grounded bullets + one "not sure" line +
// the invitation). Differentiated from Moment 3 (the full diagnosis): this does NOT re-list every source. Only
// the invitation sits in the clay question card, and only when it's the current question.
function ArcOpenerView({ opener, t, asQuestion }: { opener: ArcOpener; t: T; asQuestion: boolean }) {
  return (
    <div className="s0-u">
      <div className="s0-u-hero">
        <div className="s0-u-hero-eyebrow">{t('arc.opener.eyebrow')}</div>
        <p className="s0-u-hero-title">{opener.lead}</p>
      </div>
      {opener.bullets.length ? <UCard label={t('arc.opener.stands')} kind="primary" bullets={opener.bullets} /> : null}
      {opener.notSure ? <UCard label={t('arc.opener.notsure')} kind="inference" bullets={[opener.notSure]} /> : null}
      {/* The closing question is the model's CONTEXTUAL invitation (varies per run, grounded in what stood out) —
          falling back to the fixed strategist sign-off only if the model gave none. Never "what did I get wrong?". */}
      {(() => { const q = (opener.invitation ?? '').trim() || t('arc.opener.invitation');
        return asQuestion
          ? <ArcQuestion text={q} t={t} />
          : <div className="s0-u-card"><p className="s0-u-card-lead">{q}</p></div>; })()}
    </div>
  );
}

/**
 * DAY ONE — the arc, one surface. The strategist carries the founder through nine moments; the surface never
 * changes shape (context line · message · actions · input) — only the message does. No tabs, no panels, no
 * stage numbers. Every moment drives an existing engine through the /arc endpoints; the moment itself is
 * server-derived (durable), so refresh/reopen lands exactly where the founder left off.
 */
export function ArcSurface({ businessId, onDone }: { businessId: string; onDone: () => void }) {
  const { locale } = useLocale() as { t: T; locale: string };
  const navigate = useNavigate();
  const [view, setView] = useState<ArcView | null>(null);
  const [loadErr, setLoadErr] = useState(false); // a TRANSIENT first-load failure (5xx/network) — never an endless spinner
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ack, setAck] = useState<string | null>(null);
  const [work, setWork] = useState<string | null>(null); // the "BB is working…" message key while a model runs
  // Back / History: the moments the founder has passed through (understanding onward), so they can re-read a
  // previous moment READ-ONLY without undoing progress. viewIdx null = viewing the live (current) moment.
  const [history, setHistory] = useState<ArcView[]>([]);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  // The pour-in re-opened from a later moment (Back from the first moment, History → Your sources, or Sources).
  // Also opens straight away when the browser comes back from Instagram consent while the arc is past pour-in.
  const [editingSources, setEditingSources] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get('connected') === 'instagram' || q.get('error') != null;
  });
  const [discuss, setDiscuss] = useState(false); // strategy: the "let's talk about it" box, revealed on demand
  const [stratDetails, setStratDetails] = useState(false); // strategy: the minor cards (not-now / reconsider) — collapsed by default so a tired founder reads the bet + 2 reasons + acts, details on demand
  const started = useRef(false);

  // Arc CHROME (labels, buttons, the question tag, provenance, error copy) is UI, so it is ENGLISH like the rest of
  // the product (operator rule 2026-10-07). What BB writes (the understanding, questions, strategy, email) arrives
  // from the server already in the business's content language and is rendered as-is.
  const t: T = useCallback((key: string, vars?: Record<string, string>) => translate(isLocale(locale) ? locale : 'en', key, vars), [locale]);

  // Track the arc-content moments (understanding onward) in history so the founder can go back read-only. pour_in
  // and reading-style transients are not tracked (nothing to re-read there). Same moment = refresh in place.
  const apply = useCallback((v: ArcView) => {
    if (v.moment === 'done') { onDone(); return; }
    setView(v);
    if (v.moment !== 'strategy') { setDiscuss(false); setStratDetails(false); } // collapse strategy discussion + details once we move on
    const TRACK = new Set(['understanding', 'conversation', 'mirror', 'strategy', 'week_day', 'email', 'container']);
    if (TRACK.has(v.moment)) {
      setHistory((h) => {
        const last = h[h.length - 1];
        if (!last) return [v];
        if (last.moment === v.moment) return [...h.slice(0, -1), v];
        return [...h, v];
      });
    }
    setViewIdx(null); // snap to the live moment
  }, [onDone]);
  // The arc GET can run understanding/mirror/strategy generation inline, so a slow or 5xx response must NOT
  // leave the founder on an endless ArcWorking spinner. A thrown error here is transport-level: 404/403 means the
  // business is genuinely gone (route away), anything else is transient → a real error state with a retry.
  // (Deterministic generation failures come back as a view with error.kind, handled in renderMoment, not thrown.)
  const load = useCallback(async () => {
    setLoadErr(false);
    try { apply(await getArc(businessId)); }
    catch (e) { if (isNotFound(e)) { navigate('/home', { replace: true }); return; } setLoadErr(true); }
  }, [businessId, apply, navigate]);
  useEffect(() => { if (started.current) return; started.current = true; void load(); }, [load]);

  // Run an arc action, replace the view (or hand off when the arc completes). A send must NEVER fail silently:
  // on error, surface a message and KEEP the founder's text; on success, clear the text and — when the moment
  // does not advance (a correction at Moment 3, a challenge at Moment 6) — acknowledge that BB received it, so
  // the founder always sees a response instead of "nothing happened".
  async function act(run: () => Promise<ArcView>, workingKey = 'arc.working') {
    setBusy(true); setErr(null); setAck(null); setWork(workingKey);
    const prevMoment = view?.moment;
    try {
      const v = await run();
      // A same-moment send gets a light "noted" — UNLESS it carried a substantive reply (a Moment 3 correction
      // reflection), which is the acknowledgment and renders in the moment itself.
      if (v.moment !== 'done' && v.moment === prevMoment && !v.correctionReflection && !v.error && !v.strategyChange) setAck(t('arc.noted'));
      apply(v);
      setText('');
    } catch {
      setErr(t('arc.senderror'));
    } finally {
      setBusy(false); setWork(null);
    }
  }

  // Initial load: a model may be generating this moment (understanding/mirror/strategy/plan run inside the GET),
  // so show an animated "working" state that escalates after a few seconds — never a bare, frozen-looking spinner.
  if (!view) {
    if (loadErr) return (
      <div className="s0-strat">
        <div className="s0-strat-ctx">{t('load.error.title')}</div>
        <p className="s0-strat-msg-line">{t('load.error.body')}</p>
        <div className="s0-strat-actions">
          <button type="button" className="s0-btn" onClick={() => void load()}>{t('common.retry')}</button>
          <a href="/home" className="s0-btn-quiet">{t('home.tobusinesses')}</a>
        </div>
      </div>
    );
    return <div className="s0-strat"><ArcWorking t={t} messageKey="arc.working" /></div>;
  }
  const weekday = new Date().toLocaleDateString(locale, { weekday: 'long' });

  // Which view is on screen: the live one, or a past moment being re-read (read-only). Back/History never
  // touch progress — they only change what is DISPLAYED.
  const liveIdx = Math.max(0, history.length - 1);
  const shownIdx = viewIdx ?? liveIdx;
  const shown = history[shownIdx] ?? view;
  const readOnly = viewIdx !== null && shownIdx < liveIdx;
  const openSources = () => { setHistOpen(false); setEditingSources(true); };
  // Back walks the moments re-readable in this session; from the earliest one it opens the sources (pour-in).
  const goBack = () => (shownIdx > 0 ? setViewIdx(shownIdx - 1) : openSources());
  const pastPourIn = view.moment !== 'pour_in';

  if (editingSources && pastPourIn) {
    return (
      <div className="s0-strat">
        <SourcesEditor
          businessId={businessId}
          onUpdated={(v) => { setEditingSources(false); setHistory([]); apply(v); }}
          onCancel={() => setEditingSources(false)}
          cancelLabel={t('arc.sources.backTo', { moment: t(`arc.moment.${view.moment}`) })}
        />
      </div>
    );
  }
  const goCurrent = () => setViewIdx(null);
  const selectHist = (i: number) => { setViewIdx(i >= liveIdx ? null : i); setHistOpen(false); };

  return (
    <div className="s0-strat">
      <div className="s0-topline">
        <div className="s0-strat-ctx">{shown.businessName} · {weekday}</div>
        {pastPourIn ? (
          <div className="s0-topnav">
            <button type="button" className="s0-navbtn" onClick={goBack}>← {t('arc.back')}</button>
            <button type="button" className="s0-navbtn" onClick={() => setHistOpen((o) => !o)} aria-expanded={histOpen}>{t('arc.history')}</button>
            <button type="button" className="s0-navbtn" onClick={openSources}>{t('arc.sources')}</button>
          </div>
        ) : null}
      </div>
      {histOpen ? (
        <ul className="s0-histlist" role="list">
          <li><button type="button" className="s0-histitem" onClick={openSources}>{t('arc.moment.pour_in')}</button></li>
          {history.map((h, i) => (
            <li key={i}><button type="button" className={`s0-histitem${i === shownIdx ? ' is-current' : ''}`} onClick={() => selectHist(i)}>{t(`arc.moment.${h.moment}`)}</button></li>
          ))}
        </ul>
      ) : null}
      {readOnly ? (
        <div className="s0-readonly-bar" role="status">
          <span>{t('arc.readonly')}</span>
          <button type="button" className="s0-navbtn" onClick={goCurrent}>{t('arc.tocurrent')} →</button>
        </div>
      ) : null}
      {renderMoment(shown, readOnly)}
      {/* live-only feedback: progress, ack, errors don't apply while re-reading a past moment */}
      {!readOnly && work ? <ArcWorking t={t} messageKey={work} /> : null}
      {!readOnly && ack ? <div className="s0-arc-ack" role="status">{ack}</div> : null}
      {!readOnly && err ? <div className="s0-error" role="alert">{err}</div> : null}
    </div>
  );

  // Render a moment's view. `ro` (read-only) = the founder is re-reading a past moment: show the content exactly
  // as it was, but hide the interactive controls (buttons/inputs) so going back never advances anything.
  function renderMoment(m: ArcView, ro: boolean) {
    // need_goal is NOT an error — it's the reflect-back confirm step. Render it as its own (non-error) surface.
    if (m.error?.kind === 'need_goal') {
      if (ro) return <ArcMsg lines={[t('arc.goal.heading')]} />;
      return <GoalConfirm candidate={m.error.goalCandidate ?? null} t={t} busy={busy} onConfirm={(s, id) => void act(() => arcConfirmGoal(businessId, s, id), 'arc.working')} />;
    }
    if (m.error?.kind === 'need_understanding') {
      return (<>
        <ArcMsg lines={[t('arc.error.needunderstanding')]} />
        {!ro ? <div className="s0-strat-actions"><button type="button" className="s0-btn" disabled={busy} onClick={() => void load()}>{t('arc.error.retry')} →</button><a href="/home" className="s0-btn-quiet">{t('home.tobusinesses')}</a></div> : null}
      </>);
    }
    if (m.error?.kind === 'strategy_insufficient') {
      // Deterministic: a bet can't form from what BB has, so re-running the SAME generation is the same wall.
      // The real forward action is to give BB more — route to the conversation. When the gate carries a concrete
      // "what's thin" detail, lead with the colon + that detail; when it does NOT, use a variant with no dangling
      // colon (never an empty list under a heading).
      const lines = m.error.detail ? [t('arc.error.strategyinsufficient'), m.error.detail] : [t('arc.error.strategyinsufficientNoDetail')];
      return (<>
        <ArcMsg lines={lines} />
        {!ro ? <div className="s0-strat-actions"><button type="button" className="s0-btn" disabled={busy} onClick={() => navigate(`/b/${businessId}/talk`)}>{t('arc.error.tellmemore')} →</button><a href="/home" className="s0-btn-quiet">{t('home.tobusinesses')}</a></div> : null}
      </>);
    }
    if (m.error?.kind === 'generation') {
      return (<>
        <ArcMsg lines={[t('arc.error.generation')]} />
        {!ro ? <div className="s0-strat-actions"><button type="button" className="s0-btn" disabled={busy} onClick={() => void load()}>{t('arc.error.retry')} →</button><a href="/home" className="s0-btn-quiet">{t('home.tobusinesses')}</a></div> : null}
      </>);
    }
    switch (m.moment) {
      case 'pour_in': return <PourIn businessId={businessId} view={m} busy={busy} onReload={load} onDone={() => act(() => arcPourInDone(businessId), 'arc.working.reading')} t={t} />;

      case 'understanding': {
        const u = m.understanding!;
        const cr = m.correctionReflection;
        return (<>
          <div className="s0-u">
            <div className="s0-u-hero">
              <div className="s0-u-hero-eyebrow">{t('arc.understanding.eyebrow')}</div>
              <p className="s0-u-hero-title">{t('arc.understanding.title', { name: m.businessName })}</p>
            </div>
            {/* 1 — What I read: proof it read the business (2–3 sentences), no connectors that would mix languages. */}
            <div className="s0-u-card s0-u-card--read">
              <div className="s0-u-card-label">{t('arc.understanding.read')}</div>
              {[u.does, u.standsOut].filter(Boolean).length ? <p className="s0-u-card-lead">{[u.does, u.standsOut].filter(Boolean).join(' ')}</p> : null}
              {u.serves ? <p className="s0-u-card-lead s0-u-serves">{t('arc.understanding.servesLead', { who: u.serves })}</p> : null}
            </div>
            {/* 2 — What stood out: ≤3 tensions, sharpest first, each grounded + proof on demand. Omitted if none. */}
            <TensionCard label={t('arc.understanding.stoodout')} items={u.tensions} whyLabel={t('arc.understanding.why')} alsoLabel={t('arc.understanding.also')} />
            {/* 3 — What I'll ask about: the site's unknowns, framed forward as the agenda for the conversation next. */}
            {u.unanswered.length ? (
              <div className="s0-u-card s0-u-card--question">
                <div className="s0-u-card-label"><span className="s0-u-ic" aria-hidden="true">→</span>{t('arc.understanding.willask')}</div>
                <p className="s0-u-card-lead s0-u-agenda">{t('arc.understanding.willask.lead')}</p>
                <ul className="s0-u-list">{u.unanswered.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            ) : null}
          </div>
          {cr ? (<>
            <div className="s0-arc-reflection" role="status">
              <p className="s0-arc-reflection-lead">{cr.reflection}</p>
              {cr.changes ? <div className="s0-arc-reflection-part"><div className="s0-arc-reflection-label">{t('arc.correct.changes')}</div><p className="s0-arc-reflection-body">{cr.changes}</p></div> : null}
              {cr.holds ? <div className="s0-arc-reflection-part"><div className="s0-arc-reflection-label">{t('arc.correct.holds')}</div><p className="s0-arc-reflection-body">{cr.holds}</p></div> : null}
            </div>
            {cr.ask ? <ArcQuestion text={cr.ask} t={t} /> : null}
          </>) : null}
          {!ro ? (<>
            <div className="s0-strat-actions">
              <button type="button" className="s0-btn" disabled={busy} onClick={() => act(() => arcConfirmUnderstanding(businessId), 'arc.working.mirror')}>{t('arc.understanding.confirm')} →</button>
            </div>
            <ArcInput ph={t('arc.understanding.ph')} onSend={(msg) => arcCorrectUnderstanding(businessId, msg)} t={t} text={text} setText={setText} busy={busy} act={act} />
          </>) : null}
        </>);
      }

      case 'conversation': {
        const turns = m.turns ?? [];
        if (turns.length === 0) {
          return <div className="s0-arc-thinking" role="status" aria-live="polite">{t('arc.conversation.preparing')}</div>;
        }
        return (<>
          {m.coverage && m.coverage.length ? <CoverageChips items={m.coverage} t={t} /> : null}
          <ArcThread turns={turns} t={t} />
          {!ro ? (<>
            <ArcInput ph={t('arc.conversation.ph')} onSend={(msg) => arcConversation(businessId, msg)} t={t} text={text} setText={setText} busy={busy} act={act} workingKey="arc.working.thinking" />
            <div className="s0-strat-actions"><button type="button" className="s0-btn-quiet" disabled={busy} onClick={() => void act(() => arcSkipQuestion(businessId, t('arc.skip.msg')), 'arc.working.thinking')}>{t('arc.skip')}</button></div>
          </>) : null}
        </>);
      }

      case 'mirror': {
        const mm = m.mirror;
        if (!mm) return (<>
          <div className="s0-u"><div className="s0-u-hero"><div className="s0-u-hero-eyebrow">{t('arc.mirror.eyebrow')}</div><p className="s0-u-hero-title">{t('arc.mirror.none')}</p></div></div>
          {!ro ? <div className="s0-strat-actions"><button type="button" className="s0-btn" disabled={busy} onClick={() => act(() => arcMirrorSeen(businessId), 'arc.working.strategy')}>{t('arc.continue')} →</button></div> : null}
        </>);
        return (<>
          <div className="s0-u">
            <div className="s0-u-hero"><div className="s0-u-hero-eyebrow">{t('arc.mirror.eyebrow')}</div><p className="s0-u-hero-title">{t('arc.mirror.intro')}</p></div>
            <div className="s0-u-card s0-u-card--primary"><div className="s0-u-card-label"><span className="s0-u-ic" aria-hidden="true">“</span>{t('arc.mirror.yousaid')}</div><p className="s0-u-card-lead">{mm.founderWords}</p></div>
            <div className="s0-u-card s0-u-card--evidence"><div className="s0-u-card-label"><span className="s0-u-ic" aria-hidden="true">✓</span>{t('arc.mirror.isaw')}</div><p className="s0-u-card-lead">{mm.against}</p></div>
            <div className="s0-u-card s0-u-card--inference"><div className="s0-u-card-label"><span className="s0-u-ic" aria-hidden="true">~</span>{t('arc.mirror.tension')}</div><p className="s0-u-card-lead">{mm.tension}</p></div>
            {!ro ? <ArcQuestion text={t('arc.mirror.which')} t={t} /> : null}
          </div>
          {!ro ? (<>
            <ArcInput ph={t('arc.mirror.ph')} onSend={(ans) => arcMirrorSeen(businessId, ans)} cta={t('arc.send')} t={t} text={text} setText={setText} busy={busy} act={act} workingKey="arc.working.strategy" />
            <div className="s0-strat-actions"><button type="button" className="s0-linkbtn" disabled={busy} onClick={() => act(() => arcMirrorSeen(businessId), 'arc.working.strategy')}>{t('arc.mirror.skip')}</button></div>
          </>) : null}
        </>);
      }

      case 'strategy': {
        const s = m.strategy!;
        return (<>
          {!ro && m.strategyChange ? <div className="s0-arc-ack" role="status">{t('arc.strategy.changed', { because: m.strategyChange.because })}</div> : null}
          <div className="s0-u">
            <div className="s0-u-hero">
              <div className="s0-u-hero-eyebrow">{t('arc.strategy.eyebrow')}</div>
              <p className="s0-u-hero-title">{s.bet}</p>
              {s.over || s.horizon ? <p className="s0-u-hero-sub">{[s.over ? t('arc.strategy.over', { over: s.over }) : '', s.horizon ? t('arc.strategy.horizon', { horizon: s.horizon }) : ''].filter(Boolean).join(' · ')}</p> : null}
            </div>
            {/* Default view for a tired founder at 22:00: the bet + at most 2 reasons + the actions. The full
                trade-offs and the minor cards (not-now / reconsider) live behind "Arată detalii". */}
            <UCard label={t('arc.strategy.tradeoffs')} kind="primary" bullets={stratDetails ? s.tradeOffs : s.tradeOffs.slice(0, 2)} />
            {stratDetails ? (<>
              <UCard label={t('arc.strategy.notnow')} kind="inference" bullets={s.notNow} />
              <UCard label={t('arc.strategy.reconsider')} kind="evidence" bullets={s.reconsider} />
            </>) : null}
            {!ro && (s.tradeOffs.length > 2 || s.notNow.length > 0 || s.reconsider.length > 0)
              ? <button type="button" className="s0-linkbtn s0-strat-details" aria-expanded={stratDetails} onClick={() => setStratDetails((v) => !v)}>{stratDetails ? t('arc.strategy.detailshide') : t('arc.strategy.details')}</button>
              : null}
          </div>
          {!ro ? (<>
            <div className="s0-strat-actions">
              <button type="button" className="s0-btn" disabled={busy || !s.adoptable || !s.proposalId} onClick={() => s.proposalId && act(() => arcAdoptStrategy(businessId, s.proposalId!), 'arc.working.plan')}>{t('arc.strategy.adopt')} →</button>
              {/* One button, not two: a labelled "reject" with no reasoning attached just regenerates the same way a
                  challenge does (both hold the founder's text as a constraint + regenerate). The value is the text the
                  founder writes, so we open one box. Excluding the rejected bet from regeneration is known debt —
                  it earns building when a founder rejects the same bet twice in a row. */}
              <button type="button" className="s0-btn-ghost" disabled={busy} onClick={() => setDiscuss(true)}>{t('arc.strategy.discuss')}</button>
            </div>
            {discuss ? <ArcInput ph={t('arc.strategy.ph')} onSend={(msg) => arcChallengeStrategy(businessId, msg)} cta={t('arc.send')} t={t} text={text} setText={setText} busy={busy} act={act} autoFocus /> : null}
          </>) : null}
        </>);
      }

      case 'week_day': {
        const w = m.weekDay!;
        return (<>
          <div className="s0-u">
            <div className="s0-u-hero"><div className="s0-u-hero-eyebrow">{t('arc.week.eyebrow')}</div><p className="s0-u-hero-title">{t('arc.week.intro')}</p></div>
            <UCard label={t('arc.week.week')} kind="primary" bullets={w.week} />
            {w.today ? <UCard label={t('arc.week.today')} kind="evidence" paragraph={w.today} /> : null}
          </div>
          {!ro ? (
            <div className="s0-strat-actions">
              <button type="button" className="s0-btn" disabled={busy} onClick={() => act(async () => {
                const after = await arcAdoptWeekDay(businessId);
                if (after.moment === 'email') await arcGenerateEmail(businessId);
                return getArc(businessId);
              }, 'arc.working.email')}>{t('arc.week.draft')} →</button>
              <button type="button" className="s0-btn-ghost" disabled={busy} onClick={() => act(() => arcAdoptWeekDay(businessId))}>{t('arc.week.writefirst')}</button>
            </div>
          ) : null}
        </>);
      }

      case 'email': return <EmailMoment businessId={businessId} view={m} busy={busy} readOnly={ro} onAct={act} t={t} />;

      case 'container':
        return <ContainerMoment businessId={businessId} view={m} busy={busy} readOnly={ro} onSeen={() => act(() => arcContainerSeen(businessId))} t={t} />;

      default: return null;
    }
  }
}

// The prominent "✓ Added" state, shown INSIDE each connector card so the founder sees, at a glance, exactly
// what BB took in from that source (the URL/file + a short confirmation like "10 pages read").
function PourInAdded({ items, t, onRemove }: { items: ArcSourceItem[]; t: T; onRemove?: (item: ArcSourceItem) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="s0-pourin-added-list">
      {items.map((s, i) => (
        <div key={i} className="s0-pourin-added-card">
          <span className="s0-pourin-added-check" aria-hidden="true">✓</span>
          <div className="s0-pourin-added-body">
            <div className="s0-pourin-added-url">{s.url}</div>
            <div className="s0-pourin-added-detail">{t('home.empty.added')}{s.detail ? ` · ${s.detail}` : ''}</div>
          </div>
          {onRemove ? (
            <button type="button" className="s0-btn-ghost s0-pourin-remove" onClick={() => onRemove(s)} aria-label={`${t('arc.sources.remove')} ${s.url}`}>{t('arc.sources.remove')}</button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// ── Moment 1: the multi-source pour-in. Every connector shown is REAL and functional (website, paste-a-link,
//    file upload, Instagram); nothing is a "coming soon" stub. Durable sources come from the server view. Adding
//    only INGESTS — the strategist synthesizes over the union when the founder clicks "Done adding — start". ──
function PourIn({ businessId, view, busy, onReload, onDone, t, editing = false }: { businessId: string; view: ArcView; busy: boolean; onReload: () => Promise<void>; onDone: () => void; t: T; editing?: boolean }) {
  const [url, setUrl] = useState('');
  const [link, setLink] = useState('');
  const [desc, setDesc] = useState('');
  const [adding, setAdding] = useState<null | 'website' | 'link' | 'file' | 'text' | 'instagram'>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sources = view.sources ?? [];
  const igConnected = view.igConnected ?? false;
  const disabled = adding !== null || busy;
  const addedOf = (types: string[]) => sources.filter((s) => types.includes(s.type));

  const ok = (state: string) => state === 'synced' || state === 'partial';

  // Remove = unlink from the business (the next understanding no longer reads it). Re-adding brings it back.
  async function removeSource(item: ArcSourceItem) {
    if (disabled) return;
    setErr(null);
    try { await arcRemoveSource(businessId, item.url, item.type); await onReload(); }
    catch { setErr(t('arc.sources.removeFail')); }
  }
  const removable = disabled ? undefined : removeSource;

  async function addWebsite(e: React.FormEvent) {
    e.preventDefault();
    const u = url.trim(); if (!u || disabled) return;
    setAdding('website'); setErr(null);
    try {
      const res = await arcAddSource(businessId, u);
      if (ok(res.state)) { setUrl(''); await onReload(); } else setErr(res.error?.trim() || t('home.empty.unreachable'));
    } catch { setErr(t('home.empty.unreachable')); } finally { setAdding(null); }
  }

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    const u = link.trim(); if (!u || disabled) return;
    setAdding('link'); setErr(null);
    try {
      const res = await arcAddLink(businessId, u);
      if (ok(res.state)) { setLink(''); await onReload(); } else setErr(res.error?.trim() || t('home.empty.unreachable'));
    } catch { setErr(t('home.empty.unreachable')); } finally { setAdding(null); }
  }

  async function addText(e: React.FormEvent) {
    e.preventDefault();
    const d = desc.trim(); if (!d || disabled) return;
    setAdding('text'); setErr(null);
    try {
      const res = await arcAddText(businessId, d);
      if (ok(res.state)) { setDesc(''); await onReload(); } else setErr(srcErr(res.error, t, 'home.empty.filefail'));
    } catch { setErr(t('home.empty.filefail')); } finally { setAdding(null); }
  }

  async function addInstagram() {
    setAdding('instagram'); setErr(null);
    try {
      const res = await arcAddInstagram(businessId);
      if (ok(res.state)) await onReload(); else setErr(srcErr(res.error, t, 'home.empty.igfail'));
    } catch { setErr(t('home.empty.igfail')); } finally { setAdding(null); }
  }

  // Not connected yet → Instagram consent. The callback returns the browser to THIS page with ?connected=instagram
  // (or ?error=...), and the effect below reads the account in, so the founder clicks once.
  async function connectInstagram() {
    if (disabled) return;
    setErr(null);
    try {
      const res = await getInstagramConnectUrl(window.location.pathname);
      if (res.authUrl) window.location.href = res.authUrl;
      else setErr(t('home.empty.igfail'));
    } catch { setErr(t('home.empty.igfail')); }
  }

  // Back from Instagram consent: strip the query (a refresh must not re-trigger), then read the account in once.
  const igReturn = useRef(false);
  useEffect(() => {
    if (igReturn.current) return;
    const q = new URLSearchParams(window.location.search);
    const connected = q.get('connected') === 'instagram';
    const failed = q.get('error');
    if (!connected && failed == null) return;
    igReturn.current = true;
    window.history.replaceState(null, '', window.location.pathname);
    if (connected) void addInstagram();
    else setErr(t('home.empty.igfail'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on the OAuth return
  }, []);

  // Multi-file: the founder can select several documents at once (brochures, offers, a case study). Each is
  // uploaded as its OWN source (one request per file, in parallel) → its own added ✓ card, or its own error line.
  async function addFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0 || disabled) return;
    setAdding('file'); setErr(null);
    const results = await Promise.allSettled(files.map((f) => arcAddFile(businessId, f)));
    const failures: string[] = [];
    results.forEach((r, i) => {
      const name = files[i]?.name ?? 'file';
      if (r.status === 'fulfilled' && ok(r.value.state)) return; // success → appears as its own added card after reload
      const msg = r.status === 'fulfilled' ? srcErr(r.value.error, t, 'home.empty.filefail') : t('home.empty.filefail');
      failures.push(`${name}: ${msg}`);
    });
    await onReload();
    setErr(failures.length ? failures.join(' · ') : null);
    setAdding(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <>
      <div className="s0-strat-msg">
        <p className="s0-strat-msg-line">{t(editing ? 'arc.moment.pour_in' : 'home.empty.lead')}</p>
        <p className="s0-strat-msg-line s0-strat-msg-sub">{t(editing ? 'arc.sources.sub' : 'home.empty.sub')}</p>
      </div>
      <div className="s0-pourin">
        {/* WEBSITE */}
        <div className={`s0-pourin-web${addedOf(['website']).length ? ' s0-pourin-web-has' : ''}`}>
          <label className="s0-pourin-web-k">{t('home.empty.website')}</label>
          <PourInAdded onRemove={removable} items={addedOf(['website'])} t={t} />
          <form className="s0-pourin-web-row" onSubmit={addWebsite}>
            <input className="s0-pourin-web-input" type="text" inputMode="url" value={url} placeholder={t('home.empty.website.ph')} onChange={(e) => setUrl(e.target.value)} aria-label={t('home.empty.website')} />
            <button type="submit" className="s0-btn s0-btn-inline" disabled={disabled || !url.trim()}>{adding === 'website' ? t('home.empty.adding') : t('home.empty.website.add')}</button>
          </form>
        </div>

        {/* INSTAGRAM — connect (Instagram Login), then read the profile + recent posts in as observed evidence */}
        <div className={`s0-pourin-web${addedOf(['instagram']).length ? ' s0-pourin-web-has' : ''}`}>
          <label className="s0-pourin-web-k">{t('home.empty.ig')}{igConnected ? <span className="s0-pourin-item-hint"> · {t('home.empty.ig.connected')}</span> : null}</label>
          <PourInAdded onRemove={removable} items={addedOf(['instagram'])} t={t} />
          <div className="s0-pourin-web-row">
            {igConnected
              ? <button type="button" className="s0-btn s0-btn-inline" disabled={disabled} onClick={() => { if (!disabled) void addInstagram(); }}>{adding === 'instagram' ? t('home.empty.adding') : t('home.empty.ig.add')}</button>
              : <button type="button" className="s0-btn-ghost" disabled={disabled} onClick={() => void connectInstagram()}>{t('home.empty.ig.connect')}</button>}
          </div>
        </div>

        {/* PASTE A LINK — the universal catch-all (a competitor page, a testimonial, any page) */}
        <div className={`s0-pourin-web${addedOf(['link']).length ? ' s0-pourin-web-has' : ''}`}>
          <label className="s0-pourin-web-k">{t('home.empty.link')} <span className="s0-pourin-item-hint">· {t('home.empty.link.hint')}</span></label>
          <PourInAdded onRemove={removable} items={addedOf(['link'])} t={t} />
          <form className="s0-pourin-web-row" onSubmit={addLink}>
            <input className="s0-pourin-web-input" type="text" inputMode="url" value={link} placeholder={t('home.empty.link.ph')} onChange={(e) => setLink(e.target.value)} aria-label={t('home.empty.link')} />
            <button type="submit" className="s0-btn s0-btn-inline" disabled={disabled || !link.trim()}>{adding === 'link' ? t('home.empty.adding') : t('home.empty.website.add')}</button>
          </form>
        </div>

        {/* UPLOAD A FILE — PDF / Word / text (offer, brochure, proposal, case study) */}
        <div className={`s0-pourin-web${addedOf(['pdf', 'docx', 'text']).length ? ' s0-pourin-web-has' : ''}`}>
          <label className="s0-pourin-web-k" htmlFor="s0-pourin-file">{t('home.empty.upload')} <span className="s0-pourin-item-hint">· {t('home.empty.upload.hint')}</span></label>
          <PourInAdded onRemove={removable} items={addedOf(['pdf', 'docx', 'text'])} t={t} />
          <div className="s0-pourin-web-row">
            <input id="s0-pourin-file" ref={fileRef} className="s0-pourin-file" type="file" multiple accept=".pdf,.docx,.doc,.txt,.md" onChange={addFiles} disabled={disabled} aria-label={t('home.empty.upload')} />
            {adding === 'file' ? <span className="s0-pourin-adding-tag">{t('home.empty.adding')}</span> : null}
          </div>
        </div>

        {/* DESCRIBE IN TEXT — the always-available fallback: a founder with no website and an unreadable file can
            still tell BB what their business is, in words, and reach the Start CTA. */}
        <div className={`s0-pourin-web${addedOf(['description']).length ? ' s0-pourin-web-has' : ''}`}>
          <label className="s0-pourin-web-k" htmlFor="s0-pourin-desc">{t('home.empty.describe')} <span className="s0-pourin-item-hint">· {t('home.empty.describe.hint')}</span></label>
          <PourInAdded onRemove={removable} items={addedOf(['description'])} t={t} />
          <form onSubmit={addText}>
            <textarea id="s0-pourin-desc" className="s0-pourin-desc" value={desc} rows={4} placeholder={t('home.empty.describe.ph')} onChange={(e) => setDesc(e.target.value)} aria-label={t('home.empty.describe')} />
            <div className="s0-pourin-web-row">
              <button type="submit" className="s0-btn s0-btn-inline" disabled={disabled || !desc.trim()}>{adding === 'text' ? t('home.empty.adding') : t('home.empty.website.add')}</button>
            </div>
          </form>
        </div>

        {/* Instagram is intentionally NOT rendered here — hidden until after MVP validation (see note at top). */}

        {err ? <div className="s0-error" role="alert">{err}</div> : null}
        {/* "Done" produced no readable understanding / threw — the arc stays here so the founder fixes their sources. */}
        {view.error?.kind === 'pourin_empty' ? <div className="s0-error" role="alert">{t('arc.error.pourinEmpty')}</div> : null}
        {view.error?.kind === 'pourin_failed' ? <div className="s0-error" role="alert">{t('arc.error.pourinFailed')}</div> : null}

        {/* THE decision that triggers the whole arc — a prominent, unmissable CTA (not a "terms"-weight link). */}
        {sources.length > 0 ? (
          <div className="s0-pourin-cta">
            <p className="s0-pourin-cta-line">{t(sources.length === 1 ? 'home.empty.ready.one' : 'home.empty.ready.many', { n: String(sources.length) })}</p>
            <button type="button" className="s0-pourin-done" disabled={disabled} onClick={onDone}>{t(editing ? 'arc.sources.update' : 'home.empty.done')}</button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * The pour-in, re-opened AFTER the founder has moved past it: from the arc ("Sources" / Back from the first
 * moment) and from the Sources page once the arc is done. Same affordances (add website, Instagram, link, file,
 * text; remove), loaded from GET /arc/sources since the arc view only carries sources at pour-in. "Update my
 * understanding" re-reads everything (POST /arc/pour-in/done) and hands back the fresh view.
 */
export function SourcesEditor({ businessId, onUpdated, onCancel, cancelLabel }: {
  businessId: string; onUpdated: (v: ArcView) => void; onCancel?: () => void; cancelLabel?: string;
}) {
  const { locale } = useLocale() as { t: T; locale: string };
  const t: T = useCallback((key: string, vars?: Record<string, string>) => translate(isLocale(locale) ? locale : 'en', key, vars), [locale]);
  const [data, setData] = useState<{ sources: ArcSourceItem[]; igConnected: boolean } | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ArcView['error']>(null);
  const reload = useCallback(async () => {
    try { setData(await getArcSources(businessId)); setLoadErr(false); } catch { setLoadErr(true); }
  }, [businessId]);
  useEffect(() => { void reload(); }, [reload]);

  async function update() {
    setBusy(true); setResult(null);
    try {
      const v = await arcPourInDone(businessId);
      if (v.error?.kind === 'pourin_empty' || v.error?.kind === 'pourin_failed') setResult(v.error);
      else onUpdated(v);
    } catch { setResult({ kind: 'pourin_failed' }); }
    finally { setBusy(false); }
  }

  const back = onCancel ? (
    <div className="s0-topline"><div className="s0-topnav">
      <button type="button" className="s0-navbtn" onClick={onCancel}>← {cancelLabel ?? t('arc.back')}</button>
    </div></div>
  ) : null;
  if (loadErr) return <>{back}<div className="s0-error" role="alert">{t('arc.sources.loadFail')}</div></>;
  if (!data) return <>{back}<ArcWorking t={t} messageKey="arc.working" /></>;
  const view: ArcView = { moment: 'pour_in', businessName: '', sources: data.sources, igConnected: data.igConnected, error: result };
  return (
    <>
      {back}
      <PourIn businessId={businessId} view={view} busy={busy} onReload={reload} onDone={() => void update()} t={t} editing />
      {busy ? <ArcWorking t={t} messageKey="arc.working.reading" /> : null}
    </>
  );
}

// ── Moment 8 (email) — the first work item, in the shared card language: a hero + an editable email card. ──
function EmailMoment({ businessId, view, busy, readOnly, onAct, t }: { businessId: string; view: ArcView; busy: boolean; readOnly?: boolean; onAct: (run: () => Promise<ArcView>) => Promise<void>; t: T }) {
  const [subject, setSubject] = useState(view.email?.subject ?? '');
  const [body, setBody] = useState(view.email?.body ?? '');
  const [copied, setCopied] = useState(false);
  useEffect(() => { setSubject(view.email?.subject ?? ''); setBody(view.email?.body ?? ''); }, [view.email?.subject, view.email?.body]);

  async function exportEmail() {
    try { await navigator.clipboard?.writeText(`${subject}\n\n${body}`); setCopied(true); } catch { /* clipboard may be blocked */ }
    await arcSaveEmail(businessId, subject, body).catch(() => undefined);
    await onAct(() => arcExportEmail(businessId));
  }

  return (
    <>
      <div className="s0-u">
        <div className="s0-u-hero"><div className="s0-u-hero-eyebrow">{t('arc.email.eyebrow')}</div><p className="s0-u-hero-title">{t('arc.email.intro')}</p></div>
        <div className="s0-u-card s0-u-card--primary">
          <div className="s0-u-card-label"><span className="s0-u-ic" aria-hidden="true">✉</span>{t('arc.email.card')}</div>
          <div className="s0-arc-email">
            <input className="s0-arc-email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('arc.email.subject')} aria-label={t('arc.email.subject')} readOnly={readOnly} />
            <textarea className="s0-arc-email-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} aria-label={t('arc.email.body')} readOnly={readOnly} />
          </div>
        </div>
      </div>
      {copied ? <p className="s0-arc-copied">{t('arc.email.copied')}</p> : null}
      {!readOnly ? (
        <div className="s0-strat-actions">
          <button type="button" className="s0-btn" disabled={busy || !subject.trim() || !body.trim()} onClick={exportEmail}>{t('arc.email.export')} →</button>
          <button type="button" className="s0-btn-ghost" disabled={busy} onClick={() => onAct(async () => { const r = await arcGenerateEmail(businessId); setSubject(r.email.subject); setBody(r.email.body); return getArc(businessId); })}>{t('arc.email.revise')}</button>
        </div>
      ) : null}
    </>
  );
}

// ── Moment 9 (container) — the read-only "what I know" view, in the shared card language. ──
function ContainerMoment({ view, busy, readOnly, onSeen, t }: { businessId: string; view: ArcView; busy: boolean; readOnly?: boolean; onSeen: () => void; t: T }) {
  const [open, setOpen] = useState(false);
  const items = view.container?.items ?? [];
  if (!open && !readOnly) {
    return (<>
      <div className="s0-u"><div className="s0-u-hero"><div className="s0-u-hero-eyebrow">{t('arc.container.eyebrow')}</div><p className="s0-u-hero-title">{t('arc.container.offer')}</p></div></div>
      <div className="s0-strat-actions">
        <button type="button" className="s0-btn" disabled={busy} onClick={() => setOpen(true)}>{t('arc.container.show')} →</button>
        <button type="button" className="s0-btn-ghost" disabled={busy} onClick={onSeen}>{t('arc.container.notnow')}</button>
      </div>
    </>);
  }
  return (<>
    <div className="s0-u">
      <div className="s0-u-hero"><div className="s0-u-hero-eyebrow">{t('arc.container.eyebrow')}</div><p className="s0-u-hero-title">{t('arc.container.title', { name: view.businessName })}</p></div>
      <div className="s0-u-card">
        <ul className="s0-arc-container">
          {items.map((it, i) => (
            <li key={i}><span className="s0-arc-container-label">{t(it.labelKey)}</span><span className="s0-arc-container-stmt">{it.statement}</span><span className={`s0-arc-prov s0-arc-prov-${it.provenance}`}>{t(`arc.prov.${it.provenance}`)}</span></li>
          ))}
        </ul>
      </div>
    </div>
    {!readOnly ? <div className="s0-strat-actions"><button type="button" className="s0-btn" disabled={busy} onClick={onSeen}>{t('arc.container.done')} →</button></div> : null}
  </>);
}
