import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import {
  getBusiness, uploadPhotoSet, photoAlternative, acceptPhotoOpportunity, fileToDataUrl,
  type Business, type PhotoOpportunity,
} from '../api/client';
import { uploadRejectKey, actionErrorKey, isNotFound, LoadError } from './errors';

type Phase = 'pick' | 'working' | 'recommended' | 'blocked' | 'rejected';

/** Slice 6.1 — Create from Photos. Upload founder photos → BB recommends ONE strategy-specific angle → accept →
 *  hands off to the frozen Slice-6 carousel (Preview/Revision/Export). No internal ontology is shown. */
export function PhotoCreatePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>('pick');
  const [opp, setOpp] = useState<PhotoOpportunity | null>(null);
  const [rejected, setRejected] = useState<{ code: string; imageIndex: number; filename: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const loadBusiness = useCallback(async () => {
    if (!id) return;
    setLoadErr(false);
    // A DEFINITIVE 404/403 means the business isn't ours → route away; a TRANSIENT failure must NOT eject the
    // founder as "not found" — it stays and offers a retry.
    try { setBusiness(await getBusiness(id)); }
    catch (e) { if (isNotFound(e)) setBusiness(null); else setLoadErr(true); }
  }, [id]);

  useEffect(() => {
    if (!id || started.current) return; started.current = true;
    void loadBusiness();
  }, [id, loadBusiness]);

  async function analyze() {
    if (!id || !files.length) return;
    setErr(null); setPhase('working');
    try {
      const images = await Promise.all(files.slice(0, 10).map(async (f) => ({ dataBase64: await fileToDataUrl(f), filename: f.name })));
      const v = await uploadPhotoSet(id, images);
      if (v.state === 'recommended') { setOpp(v.opportunity); setPhase(v.opportunity.canCreate ? 'recommended' : 'blocked'); }
      else if (v.state === 'rejected') { setRejected({ code: v.code, imageIndex: v.imageIndex, filename: v.filename }); setPhase('rejected'); }
      else setPhase('blocked');
    } catch (e) {
      // A thrown upload/analysis failure is NOT a structured rejection — keep the founder's selected photos and
      // say what went wrong (busy vs broke), so they can retry without re-picking the whole set.
      setErr(t(actionErrorKey(e))); setPhase('pick');
    }
  }

  async function anotherAngle() {
    if (!id || !opp) return;
    setErr(null); setBusy(true);
    try { const v = await photoAlternative(id, opp.opportunityId); if (v.state === 'recommended' && 'opportunity' in v) { setOpp(v.opportunity); setPhase(v.opportunity.canCreate ? 'recommended' : 'blocked'); } }
    catch (e) { setErr(t(actionErrorKey(e))); }
    finally { setBusy(false); }
  }

  async function createIt() {
    if (!id || !opp) return;
    setErr(null); setBusy(true);
    try { const v = await acceptPhotoOpportunity(id, opp.opportunityId); if (v.state === 'accepted') navigate(`/b/${id}/create/${v.createHandoffId}`); else setPhase('blocked'); }
    catch (e) { setErr(t(actionErrorKey(e))); }
    finally { setBusy(false); }
  }

  if (business === null) return <Navigate to="/" replace />;
  if (loadErr) return <LoadError onRetry={loadBusiness} />;
  if (business === undefined) return <AppShell showSignOut><div className="s0-loading">{t('common.loading')}</div></AppShell>;

  return (
    <AppShell showSignOut>
      <div className="s0-panel s0-panel-wide">
        <button type="button" className="s0-linkbtn" onClick={() => navigate(`/b/${id}/today`)} style={{ marginBottom: 18 }}>← {t('carousel.back')}</button>

        {phase === 'pick' && (
          <>
            <h1 className="s0-h1">{t('photo.title')}</h1>
            <p className="s0-lede">{t('photo.body')}</p>
            <label className="s0-linkbtn s0-car-upload">
              {t('photo.add')}
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setErr(null); }} />
            </label>
            {files.length > 0 && <p className="s0-plan-band">{t('photo.selected', { n: String(files.length) })}</p>}
            {/* A thrown upload/analysis failure returns here with the selection intact — show why and let them retry. */}
            {err && <p className="s0-error" role="alert">{err}</p>}
            <div className="s0-strat-actions">
              <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} disabled={!files.length} onClick={analyze}>{t('photo.analyze')}</button>
            </div>
          </>
        )}

        {phase === 'working' && (<><h1 className="s0-h1">{t('photo.working.title')}</h1><p className="s0-lede">{t('photo.working.body')}</p></>)}

        {phase === 'recommended' && opp && (
          <>
            <h1 className="s0-h1">{t('photo.found.title')}</h1>
            <p className="s0-lede">{opp.recommendation}</p>
            <div className="s0-plan-band">{t('photo.using', { n: String(opp.usingPhotos), total: String(opp.usingPhotos + opp.excludedPhotos) })}</div>
            {opp.sufficiency === 'sufficient_with_gap' && opp.missing.length > 0 && (
              <div className="s0-plan-stale">{t('photo.gap', { what: opp.missing[0]! })}</div>
            )}
            {err && <p className="s0-error" role="alert">{err}</p>}
            <div className="s0-strat-actions">
              <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} disabled={busy} onClick={createIt}>{busy ? '…' : t('photo.create')}</button>
              {opp.alternativeAvailable && <button type="button" className="s0-linkbtn" disabled={busy} onClick={anotherAngle}>{t('photo.another')}</button>}
            </div>
          </>
        )}

        {phase === 'blocked' && (
          <>
            <h1 className="s0-h1">{t('photo.blocked.title')}</h1>
            <p className="s0-lede">{opp?.recommendation || t('photo.blocked.body')}</p>
            <div className="s0-strat-actions">
              <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} onClick={() => { setPhase('pick'); setFiles([]); setOpp(null); }}>{t('photo.addmore')}</button>
            </div>
          </>
        )}

        {/* One rejected photo fails the whole set (a photo set is a single composed thing). Name WHICH photo —
            label above, reason below — and let the founder re-pick. */}
        {phase === 'rejected' && rejected && (
          <>
            <div className="s0-plan-band">{rejected.filename ? t('upload.photoLabelNamed', { n: String(rejected.imageIndex), name: rejected.filename }) : t('upload.photoLabel', { n: String(rejected.imageIndex) })}</div>
            <p className="s0-lede">{t(uploadRejectKey(rejected.code))}</p>
            <div className="s0-strat-actions">
              <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} onClick={() => { setPhase('pick'); setFiles([]); setRejected(null); }}>{t('photo.add')}</button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
