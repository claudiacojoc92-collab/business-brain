import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import {
  getArc, arcAddSource, arcPourInDone, arcReading, arcConversation, arcConfirmUnderstanding,
  arcMirrorSeen, arcAdoptStrategy, arcChallengeStrategy, arcAdoptWeekDay, arcGenerateEmail,
  arcSaveEmail, arcExportEmail, arcContainerSeen, type ArcView,
} from '../api/client';

type T = (k: string, v?: Record<string, string>) => string;

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
  const started = useRef(false);

  const apply = useCallback((v: ArcView) => { if (v.moment === 'done') onDone(); else setView(v); }, [onDone]);
  const load = useCallback(async () => { apply(await getArc(businessId)); }, [businessId, apply]);
  useEffect(() => { if (started.current) return; started.current = true; void load(); }, [load]);

  // Run an arc action, replace the view (or hand off to the briefing when the arc completes).
  async function act(run: () => Promise<ArcView>) {
    setBusy(true);
    try { apply(await run()); setText(''); } finally { setBusy(false); }
  }

  if (!view) return <div className="s0-loading">{t('common.loading')}</div>;
  const weekday = new Date().toLocaleDateString(locale, { weekday: 'long' });

  return (
    <div className="s0-strat">
      <div className="s0-strat-ctx">{view.businessName} · {weekday}</div>
      {renderMoment()}
    </div>
  );

  function Msg({ lines }: { lines: string[] }) {
    return <div className="s0-strat-msg">{lines.filter(Boolean).map((l, i) => <p key={i} className="s0-strat-msg-line">{l}</p>)}</div>;
  }
  function Bullets({ k, items }: { k: string; items: string[] }) {
    if (!items.length) return null;
    return <div className="s0-arc-block"><div className="s0-arc-k">{t(k)}</div><ul className="s0-arc-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
  }
  function Input({ ph, onSend, cta }: { ph: string; onSend: (m: string) => Promise<ArcView>; cta?: string }) {
    return (
      <form className="s0-strat-input" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void act(() => onSend(text.trim())); }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={ph} aria-label={ph} rows={2} disabled={busy} />
        <button type="submit" className="s0-btn s0-btn-inline" disabled={busy || !text.trim()}>{cta ?? t('arc.send')}</button>
      </form>
    );
  }

  function renderMoment() {
    switch (view!.moment) {
      case 'pour_in': return <PourIn businessId={businessId} view={view!} busy={busy} onReload={load} onDone={() => act(() => arcPourInDone(businessId))} t={t} />;

      case 'reading':
        return (<>
          <Msg lines={[t('arc.reading')]} />
          <Input ph={t('arc.reading.ph')} onSend={(m) => arcReading(businessId, m)} cta={t('arc.reading.cta')} />
        </>);

      case 'understanding': {
        const u = view!.understanding!;
        return (<>
          <Msg lines={[t('arc.understanding.title', { name: view!.businessName }), u.does, u.serves, u.standsOut]} />
          <Bullets k="arc.understanding.confident" items={u.confident} />
          <Bullets k="arc.understanding.unsure" items={u.unsure} />
          <div className="s0-strat-actions">
            <button type="button" className="s0-btn" disabled={busy} onClick={() => act(() => arcConfirmUnderstanding(businessId))}>{t('arc.understanding.confirm')} →</button>
          </div>
          <Input ph={t('arc.understanding.ph')} onSend={(m) => arcConversation(businessId, m)} />
        </>);
      }

      case 'conversation': {
        const turns = view!.turns ?? [];
        const lastBb = [...turns].reverse().find((x) => x.role === 'bb');
        return (<>
          {lastBb ? <Msg lines={[lastBb.content]} /> : <Msg lines={[t('arc.conversation.opener')]} />}
          {turns.length > 1 ? (
            <details className="s0-arc-thread"><summary>{t('arc.conversation.history')}</summary>
              {turns.map((tn) => <p key={tn.id} className={tn.role === 'bb' ? 's0-turn-bb' : 's0-turn-founder'}>{tn.content}</p>)}
            </details>
          ) : null}
          <Input ph={t('arc.conversation.ph')} onSend={(m) => arcConversation(businessId, m)} />
        </>);
      }

      case 'mirror': {
        const m = view!.mirror;
        if (!m) return (<>
          <Msg lines={[t('arc.mirror.none')]} />
          <div className="s0-strat-actions"><button type="button" className="s0-btn" disabled={busy} onClick={() => act(() => arcMirrorSeen(businessId))}>{t('arc.continue')} →</button></div>
        </>);
        return (<>
          <Msg lines={[t('arc.mirror.intro')]} />
          <div className="s0-mirror-card">
            <p className="s0-mirror-said"><span className="s0-mirror-side-tag">{t('arc.mirror.yousaid')}</span> {m.founderWords}</p>
            <p className="s0-mirror-against"><span className="s0-mirror-side-tag">{t('arc.mirror.isaw')}</span> {m.against}</p>
            <p className="s0-mirror-tension">{m.tension}</p>
            <p className="s0-arc-q">{t('arc.mirror.which')}</p>
          </div>
          <Input ph={t('arc.mirror.ph')} onSend={(ans) => arcMirrorSeen(businessId, ans)} cta={t('arc.send')} />
          <div className="s0-strat-actions"><button type="button" className="s0-linkbtn" disabled={busy} onClick={() => act(() => arcMirrorSeen(businessId))}>{t('arc.mirror.skip')}</button></div>
        </>);
      }

      case 'strategy': {
        const s = view!.strategy!;
        return (<>
          <Msg lines={[t('arc.strategy.intro'), t('arc.strategy.bet', { bet: s.bet, over: s.over }), s.horizon ? t('arc.strategy.horizon', { horizon: s.horizon }) : '']} />
          <Bullets k="arc.strategy.reconsider" items={s.reconsider} />
          <div className="s0-strat-actions">
            <button type="button" className="s0-btn" disabled={busy || !s.adoptable || !s.proposalId} onClick={() => s.proposalId && act(() => arcAdoptStrategy(businessId, s.proposalId!))}>{t('arc.strategy.adopt')} →</button>
            <button type="button" className="s0-btn-ghost" disabled={busy} onClick={() => navigate(`/b/${businessId}/strategy`)}>{t('arc.showwhy')}</button>
          </div>
          <Input ph={t('arc.strategy.ph')} onSend={(m) => arcChallengeStrategy(businessId, m)} cta={t('arc.strategy.challenge')} />
        </>);
      }

      case 'week_day': {
        const w = view!.weekDay!;
        return (<>
          <Msg lines={[t('arc.week.intro')]} />
          <Bullets k="arc.week.week" items={w.week} />
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

// ── Moment 1: the pour-in (durable sources come from the server view; adding reuses the learn engine) ──
function PourIn({ businessId, view, busy, onReload, onDone, t }: { businessId: string; view: ArcView; busy: boolean; onReload: () => Promise<void>; onDone: () => void; t: T }) {
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [soonKey, setSoonKey] = useState<string | null>(null);
  const sources = view.sources ?? [];

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const u = url.trim(); if (!u || adding) return;
    setAdding(true); setErr(null);
    try {
      const res = await arcAddSource(businessId, u);
      if (res.state === 'synced' || res.state === 'partial') { setUrl(''); await onReload(); }
      else setErr(res.error?.trim() || t('home.empty.unreachable'));
    } catch { setErr(t('home.empty.unreachable')); } finally { setAdding(false); }
  }
  const next = [{ key: 'home.empty.ig' }, { key: 'home.empty.google' }, { key: 'home.empty.doc', hint: 'home.empty.doc.hint' }, { key: 'home.empty.link' }];

  return (
    <>
      <div className="s0-strat-msg">
        <p className="s0-strat-msg-line">{t('home.empty.lead')}</p>
        <p className="s0-strat-msg-line s0-strat-msg-sub">{t('home.empty.sub')}</p>
      </div>
      <div className="s0-pourin">
        <form className="s0-pourin-web" onSubmit={add}>
          <label className="s0-pourin-web-k">{t('home.empty.website')}</label>
          <div className="s0-pourin-web-row">
            <input className="s0-pourin-web-input" type="text" inputMode="url" value={url} placeholder={t('home.empty.website.ph')} onChange={(e) => setUrl(e.target.value)} aria-label={t('home.empty.website')} />
            <button type="submit" className="s0-btn s0-btn-inline" disabled={adding || !url.trim()}>{adding ? t('home.empty.adding') : t('home.empty.website.add')}</button>
          </div>
          {err ? <div className="s0-error" role="alert">{err}</div> : null}
          {sources.length > 0 ? (
            <ul className="s0-pourin-sources">
              {sources.map((s, i) => <li key={i} className="s0-pourin-source s0-pourin-source-done"><span className="s0-pourin-source-url">{s.url}</span><span className="s0-pourin-source-status s0-pourin-added">{t('home.empty.added')}</span></li>)}
            </ul>
          ) : null}
        </form>
        <ul className="s0-pourin-list">
          {next.map((c) => (
            <li key={c.key}>
              <button type="button" className="s0-pourin-item" onClick={() => setSoonKey(c.key)}>
                <span className="s0-pourin-item-label">{t(c.key)}{c.hint ? <span className="s0-pourin-item-hint"> · {t(c.hint)}</span> : null}</span>
                <span className="s0-pourin-soon">{t('home.empty.soon')}</span>
              </button>
              {soonKey === c.key ? <p className="s0-pourin-wiring">{t('home.empty.wiring')}</p> : null}
            </li>
          ))}
        </ul>
        {sources.length > 0 ? <button type="button" className="s0-pourin-done" disabled={busy} onClick={onDone}>{t('home.empty.done')}</button> : null}
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
