import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import {
  getBusiness, uploadPhotoSet, photoAlternative, acceptPhotoOpportunity, fileToDataUrl,
  type Business, type PhotoOpportunity,
} from '../api/client';

type Phase = 'pick' | 'working' | 'recommended' | 'blocked';

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
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!id || started.current) return; started.current = true;
    (async () => { try { setBusiness(await getBusiness(id)); } catch { setBusiness(null); } })();
  }, [id]);

  async function analyze() {
    if (!id || !files.length) return;
    setPhase('working');
    try {
      const images = await Promise.all(files.slice(0, 10).map(async (f) => ({ dataBase64: await fileToDataUrl(f), filename: f.name })));
      const v = await uploadPhotoSet(id, images);
      if (v.state === 'recommended') { setOpp(v.opportunity); setPhase(v.opportunity.canCreate ? 'recommended' : 'blocked'); }
      else setPhase('blocked');
    } catch { setPhase('blocked'); }
  }

  async function anotherAngle() {
    if (!id || !opp) return;
    setBusy(true);
    try { const v = await photoAlternative(id, opp.opportunityId); if (v.state === 'recommended' && 'opportunity' in v) { setOpp(v.opportunity); setPhase(v.opportunity.canCreate ? 'recommended' : 'blocked'); } }
    finally { setBusy(false); }
  }

  async function createIt() {
    if (!id || !opp) return;
    setBusy(true);
    try { const v = await acceptPhotoOpportunity(id, opp.opportunityId); if (v.state === 'accepted') navigate(`/b/${id}/create/${v.createHandoffId}`); else setPhase('blocked'); }
    finally { setBusy(false); }
  }

  if (business === null) return <Navigate to="/" replace />;
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
              <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            </label>
            {files.length > 0 && <p className="s0-plan-band">{t('photo.selected', { n: String(files.length) })}</p>}
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
      </div>
    </AppShell>
  );
}
