import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import {
  getBusiness, generateCarousel, reviseCarousel, tryDifferentAngle, uploadCarouselMedia, fileToDataUrl,
  carouselSlideObjectUrl, downloadCarouselZip,
  type Business, type CarouselView, type CarouselSlideView,
} from '../api/client';

type T = (k: string, v?: Record<string, string>) => string;

export function CarouselPage() {
  const { id, handoffId } = useParams<{ id: string; handoffId: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [view, setView] = useState<CarouselView | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ headline: string; body: string }>({ headline: '', body: '' });
  const [rejected, setRejected] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<'gate' | 'working'>('gate');
  const [files, setFiles] = useState<File[]>([]);
  const started = useRef(false);

  async function loadImages(v: CarouselView) {
    if (v.state !== 'ready') return;
    const next: Record<string, string> = {};
    for (const s of v.slides) if (s.imageUrl) { try { next[s.slideId] = await carouselSlideObjectUrl(s.imageUrl); } catch { /* skip */ } }
    setUrls((prev) => { Object.values(prev).forEach((u) => URL.revokeObjectURL(u)); return next; });
  }

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    (async () => { try { setBusiness(await getBusiness(id)); } catch { setBusiness(null); } })();
  }, [id]);

  // Optional media moment (§12): upload any selected visuals, then generate. "Continue without photos" skips upload.
  async function proceed() {
    if (!id || !handoffId) return;
    setPhase('working');
    try {
      for (const f of files.slice(0, 6)) { try { const d = await fileToDataUrl(f); await uploadCarouselMedia(id, d, f.name); } catch { /* skip a bad file */ } }
      const v = await generateCarousel(id, handoffId);
      setView(v); await loadImages(v);
    } catch {
      // A couldn't-produce state is honest and calm — never a technical crash. (No internals surfaced.)
      setView({ state: 'insufficient' });
    }
  }

  // Fail-closed recovery: re-run generation (no re-upload); the founder never sees why it failed, only that it did.
  async function retry() {
    if (!id || !handoffId) return;
    setView(null); setPhase('working');
    try { const v = await generateCarousel(id, handoffId); setView(v); await loadImages(v); }
    catch { setView({ state: 'insufficient' }); }
  }
  // "Add more source material" returns to the media moment so the founder can supply visuals/assets, then regenerate.
  function addMoreSource() { setView(null); setFiles([]); setPhase('gate'); }

  async function applyRevision(slideId: string) {
    if (!id || view?.state !== 'ready') return;
    setBusy(true); setRejected(null);
    try {
      const v = await reviseCarousel(id, view.assetId, { scope: 'slide', slideId, headline: draft.headline, body: draft.body || undefined, request: 'edit' });
      if (v.state === 'revision_rejected') { setRejected(v.reasons); }
      else { setView(v); setEditing(null); await loadImages(v); }
    } finally { setBusy(false); }
  }

  async function angle() {
    if (!id || view?.state !== 'ready') return;
    setBusy(true); setRejected(null); setNotice(null);
    try {
      const v = await tryDifferentAngle(id, view.assetId);
      if (v.state === 'not_different') setNotice(t('carousel.angle.same'));
      else if (v.state === 'insufficient') setNotice(t('carousel.angle.insufficient'));
      else { setView(v); setEditing(null); await loadImages(v); }
    } finally { setBusy(false); }
  }

  if (business === null) return <Navigate to="/" replace />;
  if (business === undefined) return <AppShell showSignOut><div className="s0-loading">{t('common.loading')}</div></AppShell>;

  // §12 optional media moment — shown once before generating; never a brand wall.
  if (phase === 'gate') {
    return (
      <AppShell showSignOut>
        <div className="s0-panel s0-panel-wide">
          <button type="button" className="s0-linkbtn" onClick={() => navigate(`/b/${id}/today`)} style={{ marginBottom: 18 }}>← {t('carousel.back')}</button>
          <h1 className="s0-h1">{t('carousel.media.title')}</h1>
          <p className="s0-lede">{t('carousel.media.body')}</p>
          <label className="s0-linkbtn s0-car-upload">
            {t('carousel.media.add')}
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
          {files.length > 0 && <p className="s0-plan-band">{t('carousel.media.selected', { n: String(files.length) })}</p>}
          <div className="s0-strat-actions">
            <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} onClick={proceed}>{files.length ? t('carousel.media.use') : t('carousel.media.skip')}</button>
            {files.length > 0 && <button type="button" className="s0-linkbtn" onClick={() => { setFiles([]); proceed(); }}>{t('carousel.media.skip')}</button>}
          </div>
        </div>
      </AppShell>
    );
  }
  if (!view) {
    return <AppShell showSignOut><div className="s0-panel s0-panel-wide"><h1 className="s0-h1">{t('carousel.composing.title')}</h1><p className="s0-lede">{t('carousel.composing.body')}</p></div></AppShell>;
  }

  return (
    <AppShell showSignOut>
      <div className="s0-panel s0-panel-wide">
        <button type="button" className="s0-linkbtn" onClick={() => navigate(`/b/${id}/today`)} style={{ marginBottom: 18 }}>← {t('carousel.back')}</button>

        {view?.state === 'unavailable_format' && (<><h1 className="s0-h1">{t('carousel.unavailable.title')}</h1><p className="s0-lede">{t('carousel.unavailable.body', { format: view.requested })}</p></>)}
        {view?.state === 'no_strategy' && (<><h1 className="s0-h1">{t('carousel.nostrategy.title')}</h1><p className="s0-lede">{t('carousel.nostrategy.body')}</p></>)}
        {view?.state === 'insufficient' && (
          <>
            <h1 className="s0-h1">{t('carousel.insufficient.title')}</h1>
            <p className="s0-lede">{t('carousel.insufficient.body')}</p>
            <div className="s0-strat-actions">
              <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} onClick={retry}>{t('carousel.retry')}</button>
              <button type="button" className="s0-linkbtn" onClick={addMoreSource}>{t('carousel.addmore')}</button>
            </div>
          </>
        )}

        {view?.state === 'ready' && (
          <>
            <h1 className="s0-h1">{t('carousel.ready.title')}</h1>
            <p className="s0-lede">{view.direction}</p>
            {rejected && <div className="s0-plan-stale"><strong>{t('carousel.rejected.title')}</strong><ul className="s0-strat-list">{rejected.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
            {notice && <div className="s0-plan-stale">{notice}</div>}

            <div className="s0-car-strip">
              {view.slides.map((s) => (
                <SlideCard key={s.slideId} s={s} url={urls[s.slideId]} t={t} busy={busy}
                  editing={editing === s.slideId}
                  onEdit={() => { setEditing(s.slideId); setDraft({ headline: s.headline, body: s.body }); setRejected(null); }}
                  onCancel={() => setEditing(null)}
                  draft={draft} setDraft={setDraft} onApply={() => applyRevision(s.slideId)} />
              ))}
            </div>

            <div className="s0-strat-actions">
              {view.exportUrl && <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} onClick={() => view.exportUrl && downloadCarouselZip(view.exportUrl)}>{t('carousel.export')}</button>}
              <button type="button" className="s0-linkbtn" disabled={busy} onClick={angle}>{t('carousel.angle')}</button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function SlideCard(props: {
  s: CarouselSlideView; url: string | undefined; t: T; busy: boolean; editing: boolean;
  onEdit: () => void; onCancel: () => void; draft: { headline: string; body: string }; setDraft: (d: { headline: string; body: string }) => void; onApply: () => void;
}) {
  const { s, url, t, busy, editing, onEdit, onCancel, draft, setDraft, onApply } = props;
  return (
    <div className="s0-car-slide">
      <div className="s0-car-frame">{url ? <img src={url} alt={`Slide ${s.order + 1}`} className="s0-car-img" /> : <div className="s0-car-ph" />}</div>
      {!editing ? (
        s.canRevise && <button type="button" className="s0-linkbtn" onClick={onEdit}>{t('carousel.change')}</button>
      ) : (
        <div className="s0-car-edit">
          <input className="s0-input" value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} aria-label={t('carousel.headline')} placeholder={t('carousel.headline')} />
          {s.body !== '' && <textarea className="s0-car-body" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label={t('carousel.body')} placeholder={t('carousel.body')} />}
          <div className="s0-car-edit-actions">
            <button type="button" className="s0-plan-primary s0-btn-inline" disabled={busy} onClick={onApply}>{busy ? '…' : t('carousel.apply')}</button>
            <button type="button" className="s0-linkbtn" onClick={onCancel}>{t('carousel.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
