import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { ApiError, getLandingDraft, acceptLandingDraft, rewriteLandingSection, editLandingSection, type LandingDraftView, type LandingSectionView } from '../api/client';

// The draft is the primary object: sections render top-to-bottom as readable copy in this order, never as a
// wall of form fields. Edit/rewrite controls are per section and quiet until used.
const ORDER = ['hero_headline', 'hero_subhead', 'what', 'who', 'how_it_works', 'proof'];
const ordered = (sections: LandingSectionView[]): LandingSectionView[] =>
  [...sections].sort((a, b) => (ORDER.indexOf(a.role) + 1 || 99) - (ORDER.indexOf(b.role) + 1 || 99));

export function LandingMovePage(): JSX.Element {
  const { id = '', actionId = '' } = useParams();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [view, setView] = useState<LandingDraftView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);        // role currently acting on
  const [sectionError, setSectionError] = useState<{ role: string; message: string } | null>(null);
  const [editing, setEditing] = useState<{ role: string; heading: string; body: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try { setError(null); setView(await getLandingDraft(id, actionId)); }
    catch { setError(t('landing.error')); }
  }, [id, actionId, t]);

  useEffect(() => { void load(); return () => { if (pollRef.current) clearTimeout(pollRef.current); }; }, [load]);
  // While pending (job producing), poll quietly — never a spinner that resolves into nothing.
  useEffect(() => {
    if (view?.status === 'pending') { pollRef.current = setTimeout(() => void load(), 4000); }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [view, load]);

  const act = async (role: string, fn: () => Promise<LandingDraftView>) => {
    setBusy(role); setSectionError(null);
    try { setView(await fn()); setEditing(null); }
    catch (e) { setSectionError({ role, message: e instanceof ApiError ? e.message : t('landing.error') }); } // previous text intact
    finally { setBusy(null); }
  };

  if (error) return <main className="s0-main"><p className="s0-lede">{error}</p><button className="s0-btn" onClick={() => void load()}>{t('landing.retry')}</button></main>;
  if (!view) return <main className="s0-main"><p className="s0-lede">{t('landing.loading')}</p></main>;

  // Blocked / pending — plain language, the reason, and the action that unblocks it. Never a blank screen.
  if (view.status === 'blocked') {
    const isNoStrategy = view.reason === 'no_adopted_strategy';
    return (
      <main className="s0-main">
        <h1 className="s0-h1">{t(isNoStrategy ? 'landing.blocked.noStrategy.title' : 'landing.blocked.noSafeCopy.title')}</h1>
        <p className="s0-lede">{t(isNoStrategy ? 'landing.blocked.noStrategy.body' : 'landing.blocked.noSafeCopy.body')}</p>
        {view.unblock === 'adopt_strategy' && (
          <button className="s0-btn" onClick={() => navigate(`/b/${id}/strategy`)}>{t('landing.blocked.noStrategy.action')}</button>
        )}
      </main>
    );
  }
  if (view.status === 'pending') return <main className="s0-main"><p className="s0-lede">{t('landing.pending')}</p></main>;

  const accepted = view.status === 'accepted';
  const sections = ordered(view.sections);

  return (
    <main className="s0-main s0-landing">
      {/* Draft FIRST — the finished work, readable. */}
      {sections.map((s) => (
        <section key={s.role} className="s0-landing-section">
          {editing?.role === s.role ? (
            <div className="s0-landing-edit">
              {s.heading !== null && <input className="s0-input" value={editing.heading} onChange={(e) => setEditing({ ...editing, heading: e.target.value })} aria-label="heading" />}
              <textarea className="s0-textarea" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={4} aria-label="body" />
              <div className="s0-landing-controls">
                <button className="s0-btn" disabled={busy === s.role} onClick={() => void act(s.role, () => editLandingSection(id, actionId, s.role, editing.body, s.heading !== null ? editing.heading : undefined))}>{t('landing.save')}</button>
                <button className="s0-btn-quiet" onClick={() => setEditing(null)}>{t('landing.cancel')}</button>
              </div>
            </div>
          ) : (
            <>
              {s.heading && <h2 className="s0-landing-h">{s.heading}</h2>}
              <p className="s0-landing-body">{s.body}</p>
              {!accepted && (
                <div className="s0-landing-controls">
                  <button className="s0-btn-quiet" onClick={() => setEditing({ role: s.role, heading: s.heading ?? '', body: s.body })}>{t('landing.edit')}</button>
                  <button className="s0-btn-quiet" disabled={busy === s.role} onClick={() => void act(s.role, () => rewriteLandingSection(id, actionId, s.role))}>{busy === s.role ? t('landing.rewriting') : t('landing.rewrite')}</button>
                </div>
              )}
            </>
          )}
          {sectionError?.role === s.role && <p className="s0-landing-err">{sectionError.message}</p>}
        </section>
      ))}

      <section className="s0-landing-cta">
        <p className="s0-landing-body">{view.cta}</p>
      </section>

      {!accepted ? (
        <button className="s0-btn s0-landing-accept" disabled={busy !== null} onClick={() => void act('__accept', () => acceptLandingDraft(id, actionId))}>{t('landing.accept')}</button>
      ) : (
        <p className="s0-landing-accepted">{t('landing.accepted')}</p>
      )}
    </main>
  );
}
