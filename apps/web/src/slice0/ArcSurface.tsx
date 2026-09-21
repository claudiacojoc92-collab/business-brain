import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import {
  getArc, arcAddSource, arcAddLink, arcAddFile,
  arcPourInDone, arcReading, arcConversation, arcConfirmUnderstanding, arcCorrectUnderstanding,
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
function ArcInput({ ph, onSend, cta, t, text, setText, busy, act }: {
  ph: string; onSend: (m: string) => Promise<ArcView>; cta?: string; t: T;
  text: string; setText: (s: string) => void; busy: boolean; act: (run: () => Promise<ArcView>) => Promise<void>;
}) {
  return (
    <form className="s0-strat-input" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void act(() => onSend(text.trim())); }}>
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
      {turns.map((tn, i) => (
        tn.role === 'bb' && i === lastBb
          ? <ArcQuestion key={tn.id} text={tn.content} t={t} />
          : (
            <div key={tn.id} className={tn.role === 'founder' ? 's0-cturn s0-cturn-you' : 's0-cturn s0-cturn-bb'}>
              <div className="s0-cturn-who">{tn.role === 'founder' ? t('arc.thread.you') : t('arc.thread.bb')}</div>
              <p className="s0-cturn-text">{tn.content}</p>
            </div>
          )
      ))}
      <div ref={endRef} aria-hidden="true" />
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
  const { t, locale } = useLocale() as { t: T; locale: string };
  const navigate = useNavigate();
  const [view, setView] = useState<ArcView | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ack, setAck] = useState<string | null>(null);
  const started = useRef(false);

  const apply = useCallback((v: ArcView) => { if (v.moment === 'done') onDone(); else setView(v); }, [onDone]);
  const load = useCallback(async () => { apply(await getArc(businessId)); }, [businessId, apply]);
  useEffect(() => { if (started.current) return; started.current = true; void load(); }, [load]);

  // Run an arc action, replace the view (or hand off when the arc completes). A send must NEVER fail silently:
  // on error, surface a message and KEEP the founder's text; on success, clear the text and — when the moment
  // does not advance (a correction at Moment 3, a challenge at Moment 6) — acknowledge that BB received it, so
  // the founder always sees a response instead of "nothing happened".
  async function act(run: () => Promise<ArcView>) {
    setBusy(true); setErr(null); setAck(null);
    const prevMoment = view?.moment;
    try {
      const v = await run();
      // A same-moment send gets a light "noted" — UNLESS it carried a substantive reply (a Moment 3 correction
      // reflection), which is the acknowledgment and renders in the moment itself.
      if (v.moment !== 'done' && v.moment === prevMoment && !v.correctionReflection) setAck(t('arc.noted'));
      apply(v);
      setText('');
    } catch {
      setErr(t('arc.senderror'));
    } finally {
      setBusy(false);
    }
  }

  if (!view) return <div className="s0-loading">{t('common.loading')}</div>;
  const weekday = new Date().toLocaleDateString(locale, { weekday: 'long' });

  return (
    <div className="s0-strat">
      <div className="s0-strat-ctx">{view.businessName} · {weekday}</div>
      {renderMoment()}
      {ack ? <div className="s0-arc-ack" role="status">{ack}</div> : null}
      {err ? <div className="s0-error" role="alert">{err}</div> : null}
    </div>
  );

  function renderMoment() {
    switch (view!.moment) {
      case 'pour_in': return <PourIn businessId={businessId} view={view!} busy={busy} onReload={load} onDone={() => act(() => arcPourInDone(businessId))} t={t} />;

      case 'reading':
        return (<>
          <ArcMsg lines={[t('arc.reading')]} />
          <ArcInput ph={t('arc.reading.ph')} onSend={(m) => arcReading(businessId, m)} cta={t('arc.reading.cta')} t={t} text={text} setText={setText} busy={busy} act={act} />
        </>);

      case 'understanding': {
        const u = view!.understanding!;
        const cr = view!.correctionReflection;
        return (<>
          <ArcMsg lines={[t('arc.understanding.title', { name: view!.businessName }), [u.does, u.serves].filter(Boolean).join(' · ')]} />
          {u.standsOut ? <div className="s0-arc-block"><div className="s0-arc-k">{t('arc.understanding.standsout')}</div><p className="s0-strat-msg-line">{u.standsOut}</p></div> : null}
          <ArcBullets k="arc.understanding.tensions" items={u.tensions} t={t} />
          <ArcBullets k="arc.understanding.confident" items={u.confident} t={t} />
          <ArcBullets k="arc.understanding.inferring" items={u.inferring} t={t} />
          <ArcBullets k="arc.understanding.unanswered" items={u.unanswered} t={t} />
          {cr ? (<>
            <div className="s0-arc-reflection" role="status">
              <p className="s0-arc-reflection-lead">{cr.reflection}</p>
              {cr.changes ? <div className="s0-arc-reflection-part"><div className="s0-arc-reflection-label">{t('arc.correct.changes')}</div><p className="s0-arc-reflection-body">{cr.changes}</p></div> : null}
              {cr.holds ? <div className="s0-arc-reflection-part"><div className="s0-arc-reflection-label">{t('arc.correct.holds')}</div><p className="s0-arc-reflection-body">{cr.holds}</p></div> : null}
            </div>
            {cr.ask ? <ArcQuestion text={cr.ask} t={t} /> : null}
          </>) : null}
          <div className="s0-strat-actions">
            <button type="button" className="s0-btn" disabled={busy} onClick={() => act(() => arcConfirmUnderstanding(businessId))}>{t('arc.understanding.confirm')} →</button>
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
        // The whole conversation is the surface — a visible thread that grows, not a single message + a toggle.
        return (<>
          <ArcThread turns={turns} t={t} />
          <ArcInput ph={t('arc.conversation.ph')} onSend={(m) => arcConversation(businessId, m)} t={t} text={text} setText={setText} busy={busy} act={act} />
        </>);
      }

      case 'mirror': {
        const m = view!.mirror;
        if (!m) return (<>
          <ArcMsg lines={[t('arc.mirror.none')]} />
          <div className="s0-strat-actions"><button type="button" className="s0-btn" disabled={busy} onClick={() => act(() => arcMirrorSeen(businessId))}>{t('arc.continue')} →</button></div>
        </>);
        return (<>
          <ArcMsg lines={[t('arc.mirror.intro')]} />
          <div className="s0-mirror-card">
            <p className="s0-mirror-said"><span className="s0-mirror-side-tag">{t('arc.mirror.yousaid')}</span> {m.founderWords}</p>
            <p className="s0-mirror-against"><span className="s0-mirror-side-tag">{t('arc.mirror.isaw')}</span> {m.against}</p>
            <p className="s0-mirror-tension">{m.tension}</p>
          </div>
          <ArcQuestion text={t('arc.mirror.which')} t={t} />
          <ArcInput ph={t('arc.mirror.ph')} onSend={(ans) => arcMirrorSeen(businessId, ans)} cta={t('arc.send')} t={t} text={text} setText={setText} busy={busy} act={act} />
          <div className="s0-strat-actions"><button type="button" className="s0-linkbtn" disabled={busy} onClick={() => act(() => arcMirrorSeen(businessId))}>{t('arc.mirror.skip')}</button></div>
        </>);
      }

      case 'strategy': {
        const s = view!.strategy!;
        return (<>
          <ArcMsg lines={[t('arc.strategy.intro'), t('arc.strategy.bet', { bet: s.bet, over: s.over }), s.horizon ? t('arc.strategy.horizon', { horizon: s.horizon }) : '']} />
          <ArcBullets k="arc.strategy.reconsider" items={s.reconsider} t={t} />
          <div className="s0-strat-actions">
            <button type="button" className="s0-btn" disabled={busy || !s.adoptable || !s.proposalId} onClick={() => s.proposalId && act(() => arcAdoptStrategy(businessId, s.proposalId!))}>{t('arc.strategy.adopt')} →</button>
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
            <button type="button" className="s0-btn" disabled={busy} onClick={() => act(async () => { await arcAdoptWeekDay(businessId); await arcGenerateEmail(businessId); return getArc(businessId); })}>{t('arc.week.draft')} →</button>
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

        {sources.length > 0 ? <button type="button" className="s0-pourin-done" disabled={disabled} onClick={onDone}>{t('home.empty.done')}</button> : null}
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
