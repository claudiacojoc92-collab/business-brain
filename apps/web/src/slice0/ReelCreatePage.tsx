import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  reelPresignUploads, reelPutBlobLocal, reelRegister, reelProcess, reelGetJob, reelGetOpportunity,
  reelAccept, reelGetAsset, reelSwapOpening, reelObjectUrl, ApiError,
  type ReelOpportunityView, type ReelAssetView,
} from '../api/client';

type Phase = 'pick' | 'reviewing' | 'opportunity' | 'building' | 'ready' | 'blocked';

/** Slice 7 — "Use my clips". Async: uploads → a BullMQ worker does the vision/render; the page polls persisted
 *  job state and is resumable via /b/:id/reel/:reelId (reelId = a job while processing, an asset once created).
 *  Founder sees no EDL/ffmpeg/enum/ids beyond what routing needs. */
export function ReelCreatePage(): JSX.Element {
  const { id: businessId = '', reelId } = useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('pick');
  const [files, setFiles] = useState<File[]>([]);
  const [opp, setOpp] = useState<ReelOpportunityView | null>(null);
  const [asset, setAsset] = useState<ReelAssetView | null>(null);
  const [mp4, setMp4] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);
  useEffect(() => () => { stopped.current = true; }, []);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function loadReel(a: ReelAssetView) { setAsset(a); if (a.mp4Url) setMp4(await reelObjectUrl(a.mp4Url)); }

  // poll a processing job until the opportunity is ready (or it fails)
  const pollProcessing = useCallback(async (jobId: string) => {
    setPhase('reviewing');
    for (let i = 0; i < 120 && !stopped.current; i++) {
      const j = await reelGetJob(businessId, jobId).catch(() => null);
      if (j?.failed) { setError('I couldn’t find a strong reel in these clips yet.'); setPhase('blocked'); return; }
      if (j?.opportunityId) { setOpp(await reelGetOpportunity(businessId, j.opportunityId)); setPhase('opportunity'); return; }
      await sleep(2500);
    }
  }, [businessId]);

  // poll a render job (or an asset) until the MP4 is ready
  const pollRender = useCallback(async (assetId: string) => {
    setPhase('building');
    for (let i = 0; i < 120 && !stopped.current; i++) {
      const a = await reelGetAsset(businessId, assetId).catch(() => null);
      if (a?.ready) { await loadReel(a); setPhase('ready'); return; }
      await sleep(2500);
    }
  }, [businessId]);

  // resume/deep-link: reelId may be an asset (ready/rendering) or a processing job
  useEffect(() => {
    if (!reelId) return;
    (async () => {
      const a = await reelGetAsset(businessId, reelId).catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; });
      if (a) { if (a.ready) { await loadReel(a); setPhase('ready'); } else { void pollRender(reelId); } return; }
      const j = await reelGetJob(businessId, reelId).catch(() => null);
      if (!j) { setError('That reel is no longer available.'); setPhase('blocked'); return; }
      if (j.failed) { setError('I couldn’t make an honest reel from this yet.'); setPhase('blocked'); }
      else if (j.opportunityId) { setOpp(await reelGetOpportunity(businessId, j.opportunityId)); setPhase('opportunity'); }
      else void pollProcessing(reelId);
    })().catch((e) => { setError((e as Error).message); setPhase('blocked'); });
  }, [reelId, businessId, pollProcessing, pollRender]);

  async function onUpload() {
    setError(null); setPhase('reviewing');
    try {
      const p = await reelPresignUploads(businessId, files.map((f) => ({ filename: f.name, contentType: f.type || 'video/mp4' })));
      for (let i = 0; i < p.uploads.length; i++) await reelPutBlobLocal(businessId, p.uploads[i]!.objectKey, files[i]!);
      await reelRegister(businessId, p.uploadSetId, p.uploads.map((u) => ({ sourceRefId: u.sourceRefId, objectKey: u.objectKey, filename: u.filename ?? undefined })));
      const res = await reelProcess(businessId, p.uploadSetId);
      if (res.opportunity) { setOpp(res.opportunity); setPhase('opportunity'); }            // inline fallback
      else { navigate(`/b/${businessId}/reel/${res.jobId}`, { replace: true }); void pollProcessing(res.jobId); } // async worker
    } catch (e) { setError((e as Error).message); setPhase('blocked'); }
  }

  async function onCreate() {
    if (!opp) return;
    setPhase('building');
    try {
      const res = await reelAccept(businessId, opp.opportunityId);
      if (res.status !== 'created' || !res.assetId) { setError(res.reason ?? 'I couldn’t make an honest reel from this yet.'); setPhase('blocked'); return; }
      navigate(`/b/${businessId}/reel/${res.assetId}`, { replace: true });
      if (res.ready) { await loadReel(await reelGetAsset(businessId, res.assetId)); setPhase('ready'); }
      else void pollRender(res.assetId);
    } catch (e) { setError((e as Error).message); setPhase('blocked'); }
  }

  async function onSwapOpening() {
    if (!asset) return;
    setPhase('building');
    try {
      const res = await reelSwapOpening(businessId, asset.assetId);
      if (res.ready === false) void pollRender(asset.assetId);
      else { await loadReel(await reelGetAsset(businessId, asset.assetId)); setPhase('ready'); }
    } catch {
      // no alternative opening (or a transient failure) — keep the founder on the reel they already have
      await loadReel(await reelGetAsset(businessId, asset.assetId)).catch(() => undefined);
      setPhase('ready');
    }
  }

  return (
    <div className="reel-create" style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
      <h1>Create a reel</h1>
      {phase === 'pick' && (
        <div>
          <p>Upload the clips you already have. I’ll find the strongest reel in them and make it for you.</p>
          <input type="file" accept="video/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          <p>{files.length} clip(s) selected</p>
          <button disabled={files.length < 1} onClick={onUpload}>Find my reel</button>
        </div>
      )}
      {phase === 'reviewing' && <p>Reviewing your footage… <span style={{ color: '#8a8275' }}>(you can leave and come back)</span></p>}
      {phase === 'opportunity' && opp && (
        <div>
          <h2>I found a strong reel</h2>
          <p>{opp.recommendation}</p>
          <p>I’d use {opp.usingClips} of your clips.{opp.missing.length ? ` One thing would make it stronger: ${opp.missing[0]}.` : ''}</p>
          <button disabled={!opp.canCreate} onClick={onCreate}>Create this reel</button>
        </div>
      )}
      {phase === 'building' && <p>Building the reel… <span style={{ color: '#8a8275' }}>(you can leave and come back)</span></p>}
      {phase === 'ready' && asset && (
        <div>
          {mp4 && <video src={mp4} controls playsInline style={{ width: '100%', borderRadius: 12, background: '#000' }} />}
          <p>{Math.round(asset.durationMs / 1000)}s · {asset.clips} clips{asset.versionNumber > 1 ? ` · v${asset.versionNumber}` : ''}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {asset.canSwapOpening && <button onClick={onSwapOpening}>Use a different opening clip</button>}
            <button onClick={async () => { const url = await reelObjectUrl(asset.mp4Url ?? ''); const a = document.createElement('a'); a.href = url; a.download = 'reel.mp4'; a.click(); }}>Export MP4</button>
          </div>
        </div>
      )}
      {phase === 'blocked' && (
        <div>
          <p>{error ?? 'I couldn’t make an honest reel yet.'}</p>
          <button onClick={() => { setError(null); setPhase('pick'); navigate(`/b/${businessId}/reel/create`, { replace: true }); }}>Try again</button>
        </div>
      )}
    </div>
  );
}
