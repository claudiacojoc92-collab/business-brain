import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import {
  startConversation, submitTurn, getCurrentStrategy, getToday, generateCarousel,
  type ConvView,
} from '../api/client';

/**
 * M6 — Talk to BB as a GLOBAL ACTION (not a sixth nav place). A right-side drawer that opens OVER the current
 * surface from anywhere, keeping the page behind it. It reuses the ONE persisted business conversation thread
 * (startOrResume) — so it survives close/reopen, navigation, and refresh — and sends a compact snapshot of the
 * surface the founder is looking at (strategy bet / today's move / the asset copy) so BB can resolve "this"
 * without the founder restating the page. It never mutates product state; product changes stay in their
 * governed surfaces.
 */

interface TalkCtx { open: () => void; close: () => void; isOpen: boolean }
const Ctx = createContext<TalkCtx | null>(null);
export function useTalk(): TalkCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTalk must be used within TalkProvider');
  return c;
}

const clip = (s: string, n: number): string => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s || '');

type Surface = 'business' | 'strategy' | 'today' | 'create' | 'home' | 'other';
function surfaceOf(path: string): { businessId: string | null; surface: Surface; handoffId: string | null } {
  const m = path.match(/^\/b\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/);
  const businessId = m?.[1] ?? null;
  const seg = m?.[2] ?? '';
  const handoffId = seg === 'create' ? (m?.[3] ?? null) : null;
  const surface: Surface = seg === '' ? 'business' : seg === 'strategy' ? 'strategy' : seg === 'today' ? 'today'
    : seg === 'create' ? 'create' : seg === 'home' ? 'home' : 'other';
  return { businessId, surface, handoffId };
}

export function TalkProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Ctx.Provider value={{ open, close, isOpen }}>
      {children}
      {isOpen && <TalkDrawer onClose={close} />}
    </Ctx.Provider>
  );
}

function TalkDrawer({ onClose }: { onClose: () => void }) {
  const { t, locale } = useLocale();
  const loc = useLocation();
  const { businessId, surface, handoffId } = surfaceOf(loc.pathname);

  const [view, setView] = useState<ConvView | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const contextRef = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Resume the ONE persisted thread on open (survives close/reopen, navigation, refresh).
  useEffect(() => {
    if (!businessId) return;
    (async () => { try { setView(await startConversation(businessId)); } catch { setLoadErr(true); } })();
  }, [businessId]);

  // Build a compact, high-signal snapshot of the current surface (fetched once per open). Not shown to the founder.
  useEffect(() => {
    if (!businessId) return;
    (async () => {
      const lines: string[] = [`Surface the founder is on: ${surface}`];
      try {
        if (surface === 'strategy' || surface === 'today' || surface === 'create') {
          const st = await getCurrentStrategy(businessId);
          const c = st.strategy?.core;
          if (c) {
            if (c.goal) lines.push(`Current strategy goal: ${clip(c.goal, 240)}`);
            if (c.coreBet?.priority) lines.push(`Core bet: ${clip(c.coreBet.priority, 260)}`);
            const nn = (c.notNow ?? []).map((x) => x.item).filter(Boolean);
            if (nn.length) lines.push(`Not doing now: ${clip(nn.join('; '), 260)}`);
          }
        }
        if (surface === 'today') {
          const td = await getToday(businessId);
          const move = (td.ready ?? [])[0];
          if (move) { lines.push(`Today's move: ${clip(move.what, 260)}`); if (move.whyNow) lines.push(`Why now: ${clip(move.whyNow, 220)}`); }
        }
        if (surface === 'create' && handoffId) {
          const a = await generateCarousel(businessId, handoffId);
          if (a.state === 'ready') {
            lines.push(`The founder is reviewing a ${a.slides.length}-slide carousel. Its slide copy is:`);
            for (const s of a.slides) lines.push(`- ${clip([s.headline, s.body].filter(Boolean).join(' — '), 160)}`);
          }
        }
      } catch { /* context is best-effort; absence just means less grounding */ }
      contextRef.current = lines.join('\n').slice(0, 1500);
    })();
  }, [businessId, surface, handoffId]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [view?.turns.length, busy]);

  async function send() {
    const msg = input.trim();
    if (!msg || !businessId || busy) return;
    setInput(''); setBusy(true);
    // optimistic: show the founder's line immediately
    setView((v) => v ? { ...v, turns: [...v.turns, { id: 'tmp', role: 'founder', content: msg, language: locale, seq: -1, createdAt: '' }] } : v);
    try { setView(await submitTurn(businessId, msg, contextRef.current || undefined)); }
    catch { setView((v) => v); }
    finally { setBusy(false); }
  }

  const opener = t(`talk.opener.${surface}` as string) || t('talk.opener.other');

  return (
    <>
      <div className="s0-talk-scrim" onClick={onClose} aria-hidden />
      <aside className="s0-talk-drawer" role="dialog" aria-label={t('nav.talk')} lang={locale}>
        <header className="s0-talk-head">
          <span className="s0-talk-title">{t('nav.talk')}</span>
          <button type="button" className="s0-talk-x" onClick={onClose} aria-label={t('talk.close')}>×</button>
        </header>

        <div className="s0-talk-scroll" ref={scrollRef}>
          {loadErr ? (
            <p className="s0-talk-note">{t('talk.error')}</p>
          ) : !view ? (
            <p className="s0-talk-note">{t('common.loading')}</p>
          ) : (
            <>
              {view.turns.filter((tn) => tn.content.trim()).map((tn) => (
                <div key={tn.id} className={tn.role === 'bb' ? 's0-talk-bb' : 's0-talk-you'}>
                  <span className="s0-talk-role">{tn.role === 'bb' ? t('talk.bb') : t('talk.you')}</span>
                  <p className="s0-talk-msg">{tn.content}</p>
                </div>
              ))}
              {busy && <div className="s0-talk-bb"><span className="s0-talk-role">{t('talk.bb')}</span><p className="s0-talk-msg s0-talk-thinking">{t('talk.thinking')}</p></div>}
            </>
          )}
        </div>

        <div className="s0-talk-compose">
          {view && view.turns.filter((tn) => tn.content.trim()).length <= 1 && <p className="s0-talk-opener">{opener}</p>}
          <textarea
            className="s0-talk-input" value={input} rows={2}
            placeholder={t('talk.placeholder')} aria-label={t('talk.placeholder')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          />
          <button type="button" className="s0-talk-send" disabled={busy || !input.trim()} onClick={() => void send()}>{t('talk.send')}</button>
        </div>
      </aside>
    </>
  );
}
