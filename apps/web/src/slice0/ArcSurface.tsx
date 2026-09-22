import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { translate, isLocale, type Locale } from '../i18n/messages';
import { parseOpenerTurn, type ArcOpener } from './parse-briefing';
import {
  getArc, arcAddSource, arcAddLink, arcAddFile,
  arcPourInDone, arcConversation, arcConfirmUnderstanding, arcCorrectUnderstanding,
  arcMirrorSeen, arcAdoptStrategy, arcChallengeStrategy, arcAdoptWeekDay, arcGenerateEmail,
  arcSaveEmail, arcExportEmail, arcContainerSeen, type ArcView,
} from '../api/client';
// NOTE: Instagram is intentionally HIDDEN from the pour-in until after MVP validation (founder decision).
// The direct Instagram Login connector + the /arc/source/instagram route are left in place, unused, for when
// we return to it (via Facebook Login for Business). See docs/sources/instagram-arc-connector-later.md.

type T = (k: string, v?: Record<string, string>) => string;

// These MUST live at module scope — never inside ArcSurface's body. A component defined inside another
// component is recreated with a NEW identity on every render, so React unmounts + remounts it; a focused
// <textarea>/<input> then loses focus after a single keystroke (setText → re-render → remount). Hoisting keeps
// the DOM node stable across re-renders, so the founder can type continuously. State is passed in as props.
function ArcMsg({ lines }: { lines: string[] }) {
  return <div className="s0-strat-msg">{lines.filter(Boolean).map((l, i) => <p key={i} className="s0-strat-msg-line">{l}</p>)}</div>;
}
function ArcBullets({ k, items, t }: { k: string; items: string[]; t: T }) {
  if (!items.length) return null;
  return <div className="s0-arc-block"><div className="s0-arc-k">{t(k)}</div><ul className="s0-arc-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
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
function ArcInput({ ph, onSend, cta, t, text, setText, busy, act, workingKey }: {
  ph: string; onSend: (m: string) => Promise<ArcView>; cta?: string; t: T;
  text: string; setText: (s: string) => void; busy: boolean; act: (run: () => Promise<ArcView>, workingKey?: string) => Promise<void>; workingKey?: string;
}) {
  return (
    <form className="s0-strat-input" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void act(() => onSend(text.trim()), workingKey); }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={ph} aria-label={ph} rows={2} disabled={busy} />
      <button type="submit" className="s0-btn s0-btn-inline" disabled={busy || !text.trim()}>{cta ?? t('arc.send')}</button>
    </form>
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
function ArcWorking({ t, messageKey }: { t: T; messageKey: string }) {
  const [longWait, setLongWait] = useState(false);
  useEffect(() => { const id = setTimeout(() => setLongWait(true), 12000); return () => clearTimeout(id); }, []);
  return (
    <div className="s0-arc-working" role="status" aria-live="polite">
      <span className="s0-arc-working-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="s0-arc-working-text">{longWait ? t('arc.working.still') : t(messageKey)}</span>
    </div>
  );
}

// The Moment 4 opener — a SHORT structured pointer (lead + ≤3 one-line grounded bullets + one "not sure" line +
// the invitation). Differentiated from Moment 3 (the full diagnosis): this does NOT re-list every source. Only
// the invitation sits in the clay question card, and only when it's the current question.
function ArcOpenerView({ opener, t, asQuestion }: { opener: ArcOpener; t: T; asQuestion: boolean }) {
  return (
    <div className="s0-arc-briefing">
      <div className="s0-strat-msg"><p className="s0-strat-msg-line">{opener.lead}</p></div>
      {opener.bullets.length ? <ul className="s0-arc-list">{opener.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul> : null}
      {opener.notSure ? <p className="s0-arc-notsure">{opener.notSure}</p> : null}
      {asQuestion
        ? <ArcQuestion text={opener.invitation} t={t} />
        : <div className="s0-strat-msg"><p className="s0-strat-msg-line">{opener.invitation}</p></div>}
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
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ack, setAck] = useState<string | null>(null);
  const [work, setWork] = useState<string | null>(null); // the "BB is working…" message key while a model runs
  const started = useRef(false);

  // Arc CHROME (labels, buttons, the question tag, provenance, error copy) follows the CONTENT language — the
  // language BB read the business in — so it never mismatches the content. `t` here resolves keys in that
  // language (falls back to the UI locale before any understanding exists). Date formatting stays on the UI locale.
  const contentLocale: Locale = view && isLocale(view.contentLanguage) ? (view.contentLanguage as Locale) : (isLocale(locale) ? locale : 'en');
  const t: T = useCallback((key: string, vars?: Record<string, string>) => translate(contentLocale, key, vars), [contentLocale]);

  const apply = useCallback((v: ArcView) => { if (v.moment === 'done') onDone(); else setView(v); }, [onDone]);
  const load = useCallback(async () => { apply(await getArc(businessId)); }, [businessId, apply]);
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
  if (!view) return <div className="s0-strat"><ArcWorking t={t} messageKey="arc.working" /></div>;
  const weekday = new Date().toLocaleDateString(locale, { weekday: 'long' });

  return (
    <div className="s0-strat">
      <div className="s0-strat-ctx">{view.businessName} · {weekday}</div>
      {renderMoment()}
      {/* While a model runs (a transition BB is thinking through), show progress — escalates to "still working…". */}
      {work ? <ArcWorking t={t} messageKey={work} /> : null}
      {ack ? <div className="s0-arc-ack" role="status">{ack}</div> : null}
      {err ? <div className="s0-error" role="alert">{err}</div> : null}
    </div>
  );

  function renderMoment() {
    // A model generation for THIS moment failed (mirror / strategy / plan / opener). Show a per-moment error with
    // a retry — never a whole-arc failure. (pour-in errors are handled inside the PourIn card, so it stays usable.)
    if (view!.error?.kind === 'generation') {
      return (<>
        <ArcMsg lines={[t('arc.error.generation')]} />
        <div className="s0-strat-actions"><button type="button" className="s0-btn" disabled={busy} onClick={() => void load()}>{t('arc.error.retry')} →</button></div>
      </>);
    }
    switch (view!.moment) {
      case 'pour_in': return <PourIn businessId={businessId} view={view!} busy={busy} onReload={load} onDone={() => act(() => arcPourInDone(businessId), 'arc.working.reading')} t={t} />;

      case 'understanding': {
        const u = view!.understanding!;
        const cr = view!.correctionReflection;
        const ctx = [u.does, u.serves].filter(Boolean).join(' · ');
        return (<>
          {/* Premium diagnostic reading: a hero headline card + one card per diagnostic lane (design-only). */}
          <div className="s0-u">
            <div className="s0-u-hero">
              <div className="s0-u-hero-eyebrow">{t('arc.understanding.eyebrow')}</div>
              <p className="s0-u-hero-title">{t('arc.understanding.title', { name: view!.businessName })}</p>
              {ctx ? <p className="s0-u-hero-sub">{ctx}</p> : null}
            </div>
            <UCard label={t('arc.understanding.standsout')} kind="primary" paragraph={u.standsOut} />
            <UCard label={t('arc.understanding.tensions')} kind="primary" bullets={u.tensions} />
            <UCard label={t('arc.understanding.confident')} kind="evidence" bullets={u.confident} />
            <UCard label={t('arc.understanding.inferring')} kind="inference" bullets={u.inferring} />
            <UCard label={t('arc.understanding.unanswered')} kind="question" bullets={u.unanswered} />
          </div>
          {cr ? (<>
            <div className="s0-arc-reflection" role="status">
              <p className="s0-arc-reflection-lead">{cr.reflection}</p>
              {cr.changes ? <div className="s0-arc-reflection-part"><div className="s0-arc-reflection-label">{t('arc.correct.changes')}</div><p className="s0-arc-reflection-body">{cr.changes}</p></div> : null}
              {cr.holds ? <div className="s0-arc-reflection-part"><div className="s0-arc-reflection-label">{t('arc.correct.holds')}</div><p className="s0-arc-reflection-body">{cr.holds}</p></div> : null}
            </div>
            {cr.ask ? <ArcQuestion text={cr.ask} t={t} /> : null}
          </>) : null}
          <div className="s0-strat-actions">
            <button type="button" className="s0-btn" disabled={busy} onClick={() => act(() => arcConfirmUnderstanding(businessId), 'arc.working.mirror')}>{t('arc.understanding.confirm')} →</button>
          </div>
          <ArcInput ph={t('arc.understanding.ph')} onSend={(m) => arcCorrectUnderstanding(businessId, m)} t={t} text={text} setText={setText} busy={busy} act={act} />
        </>);
      }

      case 'conversation': {
        const turns = view!.turns ?? [];
        // The opener is the model-generated RECAP, created server-side on view (lazy startOrResume) and returned
        // as the first turn — never a static placeholder. If it isn't here yet (a brief transient), show a quiet
        // thinking state, not a generic question, until the real recap arrives.
        if (turns.length === 0) {
          return <div className="s0-arc-thinking" role="status" aria-live="polite">{t('arc.conversation.preparing')}</div>;
        }
        // The whole exchange is a visible thread. The opener turn renders as a short structured pointer (handled
        // inside ArcThread via parseOpenerTurn); the current question is the clay card. No prose parsing.
        return (<>
          <ArcThread turns={turns} t={t} />
          <ArcInput ph={t('arc.conversation.ph')} onSend={(m) => arcConversation(businessId, m)} t={t} text={text} setText={setText} busy={busy} act={act} workingKey="arc.working.thinking" />
        </>);
      }

      case 'mirror': {
        const m = view!.mirror;
        if (!m) return (<>
          <ArcMsg lines={[t('arc.mirror.none')]} />
          <div className="s0-strat-actions"><button type="button" className="s0-btn" disabled={busy} onClick={() => act(() => arcMirrorSeen(businessId), 'arc.working.strategy')}>{t('arc.continue')} →</button></div>
        </>);
        return (<>
          <ArcMsg lines={[t('arc.mirror.intro')]} />
          <div className="s0-mirror-card">
            <p className="s0-mirror-said"><span className="s0-mirror-side-tag">{t('arc.mirror.yousaid')}</span> {m.founderWords}</p>
            <p className="s0-mirror-against"><span className="s0-mirror-side-tag">{t('arc.mirror.isaw')}</span> {m.against}</p>
            <p className="s0-mirror-tension">{m.tension}</p>
          </div>
          <ArcQuestion text={t('arc.mirror.which')} t={t} />
          <ArcInput ph={t('arc.mirror.ph')} onSend={(ans) => arcMirrorSeen(businessId, ans)} cta={t('arc.send')} t={t} text={text} setText={setText} busy={busy} act={act} workingKey="arc.working.strategy" />
          <div className="s0-strat-actions"><button type="button" className="s0-linkbtn" disabled={busy} onClick={() => act(() => arcMirrorSeen(businessId), 'arc.working.strategy')}>{t('arc.mirror.skip')}</button></div>
        </>);
      }

      case 'strategy': {
        const s = view!.strategy!;
        return (<>
          {/* after a challenge: the bet was regenerated — say so, then show the updated bet below */}
          {view!.strategyChange ? <div className="s0-arc-ack" role="status">{t('arc.strategy.changed', { because: view!.strategyChange.because })}</div> : null}
          <ArcMsg lines={[t('arc.strategy.intro'), t('arc.strategy.bet', { bet: s.bet, over: s.over }), s.horizon ? t('arc.strategy.horizon', { horizon: s.horizon }) : '']} />
          <ArcBullets k="arc.strategy.tradeoffs" items={s.tradeOffs} t={t} />
          <ArcBullets k="arc.strategy.notnow" items={s.notNow} t={t} />
          <ArcBullets k="arc.strategy.reconsider" items={s.reconsider} t={t} />
          <div className="s0-strat-actions">
            <button type="button" className="s0-btn" disabled={busy || !s.adoptable || !s.proposalId} onClick={() => s.proposalId && act(() => arcAdoptStrategy(businessId, s.proposalId!), 'arc.working.plan')}>{t('arc.strategy.adopt')} →</button>
            <button type="button" className="s0-btn-ghost" disabled={busy} onClick={() => navigate(`/b/${businessId}/strategy`)}>{t('arc.showwhy')}</button>
          </div>
          <ArcInput ph={t('arc.strategy.ph')} onSend={(m) => arcChallengeStrategy(businessId, m)} cta={t('arc.strategy.challenge')} t={t} text={text} setText={setText} busy={busy} act={act} />
        </>);
      }

      case 'week_day': {
        const w = view!.weekDay!;
        return (<>
          <ArcMsg lines={[t('arc.week.intro')]} />
          <ArcBullets k="arc.week.week" items={w.week} t={t} />
          {w.today ? <div className="s0-arc-block"><div className="s0-arc-k">{t('arc.week.today')}</div><p className="s0-strat-msg-line">{w.today}</p></div> : null}
          <div className="s0-strat-actions">
            <button type="button" className="s0-btn" disabled={busy} onClick={() => act(async () => {
              // Only draft the email AFTER the plan is confirmed accepted (moment advanced to 'email'); otherwise the
              // email would be generated but never shown (the moment would stay 'week_day').
              const after = await arcAdoptWeekDay(businessId);
              if (after.moment === 'email') await arcGenerateEmail(businessId);
              return getArc(businessId);
            })}>{t('arc.week.draft')} →</button>
            <button type="button" className="s0-btn-ghost" disabled={busy} onClick={() => act(() => arcAdoptWeekDay(businessId))}>{t('arc.week.writefirst')}</button>
          </div>
        </>);
      }

      case 'email': return <EmailMoment businessId={businessId} view={view!} busy={busy} onAct={act} t={t} />;

      case 'container':
        return <ContainerMoment businessId={businessId} view={view!} busy={busy} onSeen={() => act(() => arcContainerSeen(businessId))} t={t} />;

      default: return null;
    }
  }
}

// The prominent "✓ Added" state, shown INSIDE each connector card so the founder sees, at a glance, exactly
// what BB took in from that source (the URL/file + a short confirmation like "10 pages read").
function PourInAdded({ items, t }: { items: { url: string; type: string; detail?: string }[]; t: T }) {
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
        </div>
      ))}
    </div>
  );
}

// ── Moment 1: the multi-source pour-in. Every connector shown is REAL and functional (website, paste-a-link,
//    file upload, Instagram); nothing is a "coming soon" stub. Durable sources come from the server view. Adding
//    only INGESTS — the strategist synthesizes over the union when the founder clicks "Done adding — start". ──
function PourIn({ businessId, view, busy, onReload, onDone, t }: { businessId: string; view: ArcView; busy: boolean; onReload: () => Promise<void>; onDone: () => void; t: T }) {
  const [url, setUrl] = useState('');
  const [link, setLink] = useState('');
  const [adding, setAdding] = useState<null | 'website' | 'link' | 'file'>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sources = view.sources ?? [];
  const disabled = adding !== null || busy;
  const addedOf = (types: string[]) => sources.filter((s) => types.includes(s.type));

  const ok = (state: string) => state === 'synced' || state === 'partial';

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
      const msg = r.status === 'fulfilled' ? (r.value.error?.trim() || t('home.empty.filefail')) : t('home.empty.filefail');
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
        <p className="s0-strat-msg-line">{t('home.empty.lead')}</p>
        <p className="s0-strat-msg-line s0-strat-msg-sub">{t('home.empty.sub')}</p>
      </div>
      <div className="s0-pourin">
        {/* WEBSITE */}
        <div className={`s0-pourin-web${addedOf(['website']).length ? ' s0-pourin-web-has' : ''}`}>
          <label className="s0-pourin-web-k">{t('home.empty.website')}</label>
          <PourInAdded items={addedOf(['website'])} t={t} />
          <form className="s0-pourin-web-row" onSubmit={addWebsite}>
            <input className="s0-pourin-web-input" type="text" inputMode="url" value={url} placeholder={t('home.empty.website.ph')} onChange={(e) => setUrl(e.target.value)} aria-label={t('home.empty.website')} />
            <button type="submit" className="s0-btn s0-btn-inline" disabled={disabled || !url.trim()}>{adding === 'website' ? t('home.empty.adding') : t('home.empty.website.add')}</button>
          </form>
        </div>

        {/* PASTE A LINK — the universal catch-all (a competitor page, a testimonial, any page) */}
        <div className={`s0-pourin-web${addedOf(['link']).length ? ' s0-pourin-web-has' : ''}`}>
          <label className="s0-pourin-web-k">{t('home.empty.link')} <span className="s0-pourin-item-hint">· {t('home.empty.link.hint')}</span></label>
          <PourInAdded items={addedOf(['link'])} t={t} />
          <form className="s0-pourin-web-row" onSubmit={addLink}>
            <input className="s0-pourin-web-input" type="text" inputMode="url" value={link} placeholder={t('home.empty.link.ph')} onChange={(e) => setLink(e.target.value)} aria-label={t('home.empty.link')} />
            <button type="submit" className="s0-btn s0-btn-inline" disabled={disabled || !link.trim()}>{adding === 'link' ? t('home.empty.adding') : t('home.empty.website.add')}</button>
          </form>
        </div>

        {/* UPLOAD A FILE — PDF / Word / text (offer, brochure, proposal, case study) */}
        <div className={`s0-pourin-web${addedOf(['pdf', 'docx', 'text']).length ? ' s0-pourin-web-has' : ''}`}>
          <label className="s0-pourin-web-k" htmlFor="s0-pourin-file">{t('home.empty.upload')} <span className="s0-pourin-item-hint">· {t('home.empty.upload.hint')}</span></label>
          <PourInAdded items={addedOf(['pdf', 'docx', 'text'])} t={t} />
          <div className="s0-pourin-web-row">
            <input id="s0-pourin-file" ref={fileRef} className="s0-pourin-file" type="file" multiple accept=".pdf,.docx,.doc,.txt,.md" onChange={addFiles} disabled={disabled} aria-label={t('home.empty.upload')} />
            {adding === 'file' ? <span className="s0-pourin-adding-tag">{t('home.empty.adding')}</span> : null}
          </div>
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
            <button type="button" className="s0-pourin-done" disabled={disabled} onClick={onDone}>{t('home.empty.done')}</button>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ── Moment 8: the email — editable, exportable (copy), regenerate ──
function EmailMoment({ businessId, view, busy, onAct, t }: { businessId: string; view: ArcView; busy: boolean; onAct: (run: () => Promise<ArcView>) => Promise<void>; t: T }) {
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
      <div className="s0-strat-msg"><p className="s0-strat-msg-line">{t('arc.email.intro')}</p></div>
      <div className="s0-arc-email">
        <input className="s0-arc-email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('arc.email.subject')} aria-label={t('arc.email.subject')} />
        <textarea className="s0-arc-email-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} aria-label={t('arc.email.body')} />
      </div>
      {copied ? <p className="s0-arc-copied">{t('arc.email.copied')}</p> : null}
      <div className="s0-strat-actions">
        <button type="button" className="s0-btn" disabled={busy || !subject.trim() || !body.trim()} onClick={exportEmail}>{t('arc.email.export')} →</button>
        <button type="button" className="s0-btn-ghost" disabled={busy} onClick={() => onAct(async () => { const r = await arcGenerateEmail(businessId); setSubject(r.email.subject); setBody(r.email.body); return getArc(businessId); })}>{t('arc.email.revise')}</button>
      </div>
    </>
  );
}

// ── Moment 9: the container offer + read-only view ──
function ContainerMoment({ view, busy, onSeen, t }: { businessId: string; view: ArcView; busy: boolean; onSeen: () => void; t: T }) {
  const [open, setOpen] = useState(false);
  const items = view.container?.items ?? [];
  if (!open) {
    return (<>
      <div className="s0-strat-msg"><p className="s0-strat-msg-line">{t('arc.container.offer')}</p></div>
      <div className="s0-strat-actions">
        <button type="button" className="s0-btn" disabled={busy} onClick={() => setOpen(true)}>{t('arc.container.show')} →</button>
        <button type="button" className="s0-btn-ghost" disabled={busy} onClick={onSeen}>{t('arc.container.notnow')}</button>
      </div>
    </>);
  }
  return (<>
    <div className="s0-strat-msg"><p className="s0-strat-msg-line">{t('arc.container.title', { name: view.businessName })}</p></div>
    <ul className="s0-arc-container">
      {items.map((it, i) => (
        <li key={i}><span className="s0-arc-container-label">{it.label}</span><span className="s0-arc-container-stmt">{it.statement}</span><span className={`s0-arc-prov s0-arc-prov-${it.provenance}`}>{t(`arc.prov.${it.provenance}`)}</span></li>
      ))}
    </ul>
    <div className="s0-strat-actions"><button type="button" className="s0-btn" disabled={busy} onClick={onSeen}>{t('arc.container.done')} →</button></div>
  </>);
}
