import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  reelProposeConcept, reelGetShootPlan, reelConstrain, reelAnotherAngle,
  reelShootUploads, reelShootPutBlob, reelShootRegister, reelShootProcess, reelShootAddShot, reelGetFulfillment, reelCreateFromPlan,
  type ShootPlanView,
} from '../api/client';

type Phase = 'loading' | 'plan' | 'uploading' | 'reviewing' | 'fulfilled' | 'building' | 'blocked';
const CONSTRAINTS: { key: string; label: string }[] = [
  { key: 'no_talking_head', label: "I don't want to talk on camera" },
  { key: 'no_clients', label: "I can't film clients" },
  { key: 'location_only', label: 'I can only film at home' },
  { key: 'make_it_easier', label: 'Make it easier' },
];

/** Slice 7 V2 — "Tell me what to film". BB proposes the reel + the shots; the founder films, uploads, and BB checks
 *  the footage, asks for at most one missing shot, then hands off to the FROZEN V1 reel (playback/swap/export).
 *  Resumable via /b/:id/reel/shoot/:planId — persistence is authoritative, never React-only state. */
export function ShootPlanPage(): JSX.Element {
  const { id: businessId = '', planId } = useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [view, setView] = useState<ShootPlanView | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [missing, setMissing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);
  useEffect(() => { stopped.current = false; return () => { stopped.current = true; }; }, []);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // entry: no planId → propose the reel worth making next, then deep-link to it
  useEffect(() => {
    (async () => {
      try {
        if (!planId) { const v = await reelProposeConcept(businessId); navigate(`/b/${businessId}/reel/shoot/${v.planId}`, { replace: true }); return; }
        const v = await reelGetShootPlan(businessId, planId);
        setView(v);
        if (v.assetId) { navigate(`/b/${businessId}/reel/${v.assetId}`, { replace: true }); return; }  // already created → frozen reel
        if (v.fulfillment && v.fulfillment.status !== 'processing') { setMissing(v.fulfillment.missing); setPhase(v.fulfillment.status === 'insufficient' ? 'blocked' : 'fulfilled'); }
        else if (v.fulfillment && v.fulfillment.status === 'processing') { setPhase('reviewing'); void pollFulfillment(); }
        else setPhase('plan');
      } catch (e) { setError((e as Error).message); setPhase('blocked'); }
    })();
  }, [planId, businessId]);

  const pollFulfillment = useCallback(async () => {
    setPhase('reviewing');
    for (let i = 0; i < 120 && !stopped.current; i++) {
      const f = await reelGetFulfillment(businessId, planId!).catch(() => null);
      if (f && f.status !== 'processing') { setMissing(f.missing); setPhase(f.status === 'insufficient' ? 'blocked' : 'fulfilled'); return; }
      await sleep(2500);
    }
  }, [businessId, planId]);

  async function doUpload(list: File[], isAdd: boolean) {
    if (!planId || !list.length) return;
    setBusy(true); setError(null); setPhase('reviewing');
    try {
      const p = await reelShootUploads(businessId, planId, list.map((f) => ({ filename: f.name, contentType: f.type || 'video/mp4' })));
      for (let i = 0; i < p.uploads.length; i++) await reelShootPutBlob(businessId, planId, p.uploads[i]!.objectKey, list[i]!);
      await reelShootRegister(businessId, planId, p.uploads.map((u) => ({ sourceRefId: u.sourceRefId, objectKey: u.objectKey, filename: u.filename ?? undefined })));
      if (isAdd) await reelShootAddShot(businessId, planId); else await reelShootProcess(businessId, planId);
      setFiles([]);
      void pollFulfillment();
    } catch (e) { setError((e as Error).message); setPhase('blocked'); } finally { setBusy(false); }
  }

  async function onConstraint(key: string) {
    if (!planId) return; setBusy(true);
    try { const v = await reelConstrain(businessId, planId, key); setView(v); setPhase('plan'); navigate(`/b/${businessId}/reel/shoot/${v.planId}`, { replace: true }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function onAnotherAngle() {
    if (!view) return; setBusy(true);
    const alt = await reelAnotherAngle(businessId, view.conceptId).catch(() => null);
    if (alt) navigate(`/b/${businessId}/reel/shoot/${alt.planId}`, { replace: true }); else setError('There isn’t a genuinely different reel to make right now.');
    setBusy(false);
  }
  async function onCreate() {
    if (!planId) return; setBusy(true); setPhase('building');
    try {
      const r = await reelCreateFromPlan(businessId, planId);
      if (r.status === 'created' && r.assetId) navigate(`/b/${businessId}/reel/${r.assetId}`);
      else { setError(r.reason ?? 'I couldn’t make an honest reel from this yet.'); setPhase('blocked'); }
    } catch (e) { setError((e as Error).message); setPhase('blocked'); } finally { setBusy(false); }
  }

  const wrap = (children: React.ReactNode) => <div className="reel-create" style={{ maxWidth: 620, margin: '0 auto', padding: 24 }}>{children}</div>;
  if (phase === 'loading') return wrap(<p>Thinking about the reel worth making next…</p>);
  if (phase === 'reviewing') return wrap(<p>Checking what you filmed… <span style={{ color: '#8a8275' }}>(you can leave and come back)</span></p>);
  if (phase === 'building') return wrap(<p>Making your reel… <span style={{ color: '#8a8275' }}>(you can leave and come back)</span></p>);
  if (phase === 'blocked') return wrap(<div><p>{error ?? 'I couldn’t make an honest reel from this yet.'}</p><button onClick={() => navigate(`/b/${businessId}`)}>Back</button></div>);

  if (phase === 'fulfilled') return wrap(
    <div>
      {missing
        ? (<><h2>I have almost everything</h2><p>{missing}</p>
            <input type="file" accept="video/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            <p>{files.length} clip(s) selected</p>
            <button disabled={busy || files.length < 1} onClick={() => doUpload(files, true)}>Add this shot</button></>)
        : (<><h2>Got it — I have what I need.</h2><button disabled={busy} onClick={onCreate}>Create my reel</button></>)}
    </div>
  );

  // phase 'plan' / 'uploading'
  return wrap(
    <div>
      <h1>I think this is the reel worth making next.</h1>
      {view && <>
        <p style={{ fontSize: 18 }}><strong>{view.idea}</strong></p>
        <p style={{ color: '#6b6255' }}>{view.whyNow}</p>
        <p>{view.accomplishes}</p>
        <h3>Film these {view.shots.length} clips <span style={{ color: '#8a8275', fontWeight: 400 }}>· {view.effort}</span></h3>
        <ol>
          {view.shots.map((s) => (
            <li key={s.n} style={{ marginBottom: 10 }}>
              {s.instruction}
              {s.sayThis && <div style={{ color: '#3a6', marginTop: 4 }}>Say this: “{s.sayThis}”</div>}
            </li>
          ))}
        </ol>
        {view.guidance.length > 0 && <p style={{ color: '#8a8275', fontSize: 13 }}>{view.guidance.join(' · ')}</p>}

        {phase === 'plan' && (
          <div style={{ marginTop: 18 }}>
            <button style={{ fontSize: 16 }} onClick={() => setPhase('uploading')}>I'll film this</button>
            {view.anotherAngleAvailable && <button style={{ marginLeft: 8 }} disabled={busy} onClick={onAnotherAngle}>Show me another angle</button>}
            <div style={{ marginTop: 18, borderTop: '1px solid #e7e2d8', paddingTop: 12 }}>
              <p style={{ color: '#8a8275', fontSize: 13, margin: '0 0 6px' }}>Need to make it easier?</p>
              {CONSTRAINTS.map((c) => (
                <button key={c.key} disabled={busy} onClick={() => onConstraint(c.key)} style={{ marginRight: 6, marginBottom: 6, fontSize: 13, background: '#f2efe9', border: '1px solid #ddd6c9', borderRadius: 14, padding: '4px 10px' }}>{c.label}</button>
              ))}
            </div>
          </div>
        )}

        {phase === 'uploading' && (
          <div style={{ marginTop: 18 }}>
            <p>Upload the clips you filmed.</p>
            <input type="file" accept="video/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            <p>{files.length} clip(s) selected</p>
            <button disabled={busy || files.length < 1} onClick={() => doUpload(files, false)}>Send my clips</button>
          </div>
        )}
      </>}
      {error && <p style={{ color: '#b4462f' }}>{error}</p>}
    </div>
  );
}
