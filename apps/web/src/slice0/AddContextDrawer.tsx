import { createContext, useCallback, useContext, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { learnFromMaterial, learnBusiness, submitCorrection } from '../api/client';

/**
 * Add context — the persistent "something changed / add material / add a link" strategist action, a global
 * right-side drawer like Talk. It NEVER makes the founder classify epistemically: three founder-language
 * intents route to the correct existing primitive, preserving the frozen lanes —
 *   • "I have something to add"  → learnFromMaterial  → DECLARED evidence (material to inspect, not truth)
 *   • "Something changed"        → submitCorrection   → FOUNDER-OWNED TRUTH (overrides what BB read)
 *   • "Add a link"               → learnBusiness      → OBSERVED website evidence
 * Then it shows the founder WHAT it updated. No new backend, no new epistemic bucket.
 */

interface AddCtx { open: () => void; close: () => void; isOpen: boolean }
const Ctx = createContext<AddCtx | null>(null);
export function useAddContext(): AddCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAddContext must be used within AddContextProvider');
  return c;
}

function businessIdOf(path: string): string | null {
  return path.match(/^\/b\/([^/]+)/)?.[1] ?? null;
}

export function AddContextProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Ctx.Provider value={{ open, close, isOpen }}>
      {children}
      {isOpen && <AddContextDrawer onClose={close} />}
    </Ctx.Provider>
  );
}

type Intent = 'material' | 'changed' | 'link';
type Subject = 'offer' | 'positioning' | 'audience';

function AddContextDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const { pathname } = useLocation();
  const businessId = businessIdOf(pathname);

  const [intent, setIntent] = useState<Intent | null>(null);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [subject, setSubject] = useState<Subject>('offer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try { const raw = await f.text(); setText((prev) => (prev.trim() ? `${prev}\n\n${raw}` : raw).slice(0, 20000)); }
    catch { setError(t('add.err.file')); }
  }

  async function submit() {
    if (!businessId || !intent) return;
    setBusy(true); setError(null);
    try {
      if (intent === 'material') {
        if (text.trim().length < 20) { setError(t('add.err.short')); setBusy(false); return; }
        await learnFromMaterial(businessId, text.trim(), 'add_context');
        setDone(t('add.done.material'));
      } else if (intent === 'link') {
        if (!url.trim()) { setError(t('add.err.url')); setBusy(false); return; }
        await learnBusiness(businessId, url.trim());
        setDone(t('add.done.link'));
      } else {
        if (text.trim().length < 3) { setError(t('add.err.short')); setBusy(false); return; }
        await submitCorrection(businessId, subject, text.trim());
        setDone(t('add.done.changed'));
      }
    } catch { setError(t('add.err.generic')); } finally { setBusy(false); }
  }

  const reset = () => { setIntent(null); setText(''); setUrl(''); setDone(null); setError(null); };

  return (
    <>
      <div className="s0-talk-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="s0-talk-drawer" role="dialog" aria-label={t('add.title')}>
        <div className="s0-talk-head">
          <span className="s0-talk-title">{t('add.title')}</span>
          <button type="button" className="s0-talk-x" onClick={onClose} aria-label={t('talk.close')}>✕</button>
        </div>

        <div className="s0-talk-scroll">
          {!businessId ? (
            <p className="s0-talk-note">{t('add.nobiz')}</p>
          ) : done ? (
            <div className="s0-add-done">
              <div className="s0-lp-k">{t('add.updated')}</div>
              <p className="s0-talk-msg">{done}</p>
              <div className="s0-today2-actions" style={{ marginTop: 16 }}>
                <button type="button" className="s0-btn" onClick={onClose}>{t('add.close')}</button>
                <button type="button" className="s0-today2-defer" onClick={reset}>{t('add.another')}</button>
              </div>
            </div>
          ) : (
            <>
              <p className="s0-talk-note">{t('add.lead')}</p>
              <div className="s0-add-intents">
                {(['material', 'changed', 'link'] as const).map((k) => (
                  <button key={k} type="button" className={intent === k ? 's0-add-intent on' : 's0-add-intent'} onClick={() => { setIntent(k); setError(null); }}>
                    <span className="s0-add-intent-t">{t(`add.intent.${k}`)}</span>
                    <span className="s0-add-intent-d">{t(`add.intent.${k}.d`)}</span>
                  </button>
                ))}
              </div>

              {error && <div className="s0-error" role="alert">{error}</div>}

              {intent === 'link' ? (
                <div className="s0-blk-form">
                  <input className="s0-blk-input" type="text" inputMode="url" placeholder={t('add.link.ph')} value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy} />
                </div>
              ) : intent === 'changed' ? (
                <div className="s0-blk-form">
                  <div className="s0-blk-chips">
                    {(['offer', 'positioning', 'audience'] as const).map((s) => (
                      <button key={s} type="button" className={subject === s ? 's0-chip s0-chip-on' : 's0-chip'} disabled={busy} onClick={() => setSubject(s)}>
                        {t(`today2.blk.corr${s === 'offer' ? 'Offer' : s === 'positioning' ? 'Pos' : 'Aud'}`)}
                      </button>
                    ))}
                  </div>
                  <textarea className="s0-blk-input" rows={4} placeholder={t('add.changed.ph')} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
                </div>
              ) : intent === 'material' ? (
                <div className="s0-blk-form">
                  <textarea className="s0-blk-input" rows={6} placeholder={t('add.material.ph')} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
                  <label className="s0-add-file">
                    <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={onFile} disabled={busy} />
                    <span>{t('add.material.file')}</span>
                  </label>
                </div>
              ) : null}

              {intent ? (
                <button type="button" className="s0-btn" style={{ marginTop: 14 }} disabled={busy} onClick={submit}>
                  {busy ? t('add.working') : t('add.submit')}
                </button>
              ) : null}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
