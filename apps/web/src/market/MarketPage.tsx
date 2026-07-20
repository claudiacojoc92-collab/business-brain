import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  getMarketEntities, addMarketEntity, createMarketReview, getMarketReview, retryMarketReview, getEntityFindings, getEntityReviews, respondToFinding, patchMarketEntity, ApiError,
  type MarketEntity, type MarketFinding, type ReviewStatus, type FindingResponseInput, type AccuracyStatus, type RelevanceResponseStatus, type EntityType,
} from '../api/client';
import { AppShell, Button, Field, Thinking } from '../system/ui';

const ACTIVE_REVIEW: ReadonlySet<string> = new Set(['QUEUED', 'RETRIEVING', 'EXTRACTING', 'INFERRING']);
const STAGE: Record<ReviewStatus, string> = {
  QUEUED: 'Getting ready…', RETRIEVING: 'Reading their public site…', EXTRACTING: 'Taking in what it says…',
  INFERRING: 'Forming a careful reading…', READY: 'Done.', INSUFFICIENT_EVIDENCE: '', FAILED: '',
};

/**
 * Wave 3 — Public positioning context (/market). Known-entity, source-backed public evidence — NOT market
 * intelligence. The founder adds a company + its website; BB reads its PUBLIC self-presentation; observation
 * and BB's tentative inference are shown SEPARATELY. Session-guarded.
 */
export function MarketPage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [entities, setEntities] = useState<MarketEntity[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [etype, setEtype] = useState<EntityType>('direct');
  const [note, setNote] = useState('');
  const [findings, setFindings] = useState<Record<string, MarketFinding[]>>({});
  const [reviewState, setReviewState] = useState<Record<string, { reviewId: string; status: ReviewStatus; message: string | null; retryable: boolean }>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [editError, setEditError] = useState('');

  const on401 = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) navigate('/signin', { replace: true }); }, [navigate]);
  const refresh = useCallback(() => { getMarketEntities().then(setEntities).catch(on401); }, [on401]);
  const poll = useCallback(async (entityId: string, reviewId: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      let r;
      try { r = await getMarketReview(reviewId); } catch (e) { on401(e); return; }
      setReviewState((s) => ({ ...s, [entityId]: { reviewId, status: r.status, message: r.message, retryable: r.retryable ?? false } }));
      if (r.status === 'READY') { try { const f = await getEntityFindings(entityId); setFindings((s) => ({ ...s, [entityId]: f })); } catch (e) { on401(e); } return; }
      if (r.status === 'INSUFFICIENT_EVIDENCE' || r.status === 'FAILED') return;
    }
  }, [on401]);

  // On mount (and founder change): load entities, HYDRATE each entity's existing findings, and RECONNECT to
  // any in-flight review — so a page refresh restores the full state (findings + responses + live polling)
  // instead of losing it.
  useEffect(() => {
    if (!founderId) return;
    let live = true;
    (async () => {
      let ents;
      try { ents = await getMarketEntities(); } catch (e) { on401(e); return; }
      if (!live) return;
      setEntities(ents);
      for (const e of ents) {
        try {
          const f = await getEntityFindings(e.id);
          if (live && f.length) setFindings((s) => ({ ...s, [e.id]: f }));
          const reviews = await getEntityReviews(e.id); // newest first
          const active = reviews.find((rv) => ACTIVE_REVIEW.has(rv.status));
          if (live && active) { setReviewState((s) => ({ ...s, [e.id]: { reviewId: active.reviewId, status: active.status, message: active.message, retryable: active.retryable ?? false } })); void poll(e.id, active.reviewId); }
          else if (live && reviews[0] && (reviews[0].status === 'FAILED' || reviews[0].status === 'INSUFFICIENT_EVIDENCE')) {
            // Restore a terminal-failed latest review so the founder-safe message + retry survive a refresh.
            const r0 = reviews[0];
            setReviewState((s) => ({ ...s, [e.id]: { reviewId: r0.reviewId, status: r0.status, message: r0.message, retryable: r0.retryable ?? false } }));
          }
        } catch (e2) { on401(e2); }
      }
    })();
    return () => { live = false; };
  }, [founderId, on401, poll]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/signin" replace />;

  const add = async () => {
    if (!name.trim()) return;
    try { await addMarketEntity({ name: name.trim(), websiteUrl: url.trim() || undefined, entityType: etype, relevanceNote: note.trim() || undefined }); setName(''); setUrl(''); setEtype('direct'); setNote(''); refresh(); } catch (e) { on401(e); }
  };
  const review = async (entityId: string) => {
    setFindings((s) => { const n = { ...s }; delete n[entityId]; return n; });
    try {
      const r = await createMarketReview(entityId);
      setReviewState((s) => ({ ...s, [entityId]: { reviewId: r.reviewId, status: r.status, message: r.message, retryable: r.retryable ?? false } }));
      void poll(entityId, r.reviewId);
    } catch (e) { on401(e); }
  };
  const retry = async (entityId: string, reviewId: string) => {
    try {
      const r = await retryMarketReview(reviewId);
      setReviewState((s) => ({ ...s, [entityId]: { reviewId: r.reviewId, status: r.status, message: r.message, retryable: r.retryable ?? false } }));
      void poll(entityId, r.reviewId);
    } catch (e) { on401(e); }
  };
  const respond = async (entityId: string, findingId: string, input: FindingResponseInput) => {
    try {
      const rec = await respondToFinding(findingId, input);
      setFindings((s) => ({ ...s, [entityId]: s[entityId]!.map((f) => f.id === findingId ? { ...f, effectiveResponse: rec, hasPriorResponses: true } : f) }));
    } catch (e) { on401(e); }
  };
  // Edit an entity's metadata. History (reviews/findings/responses) is preserved server-side; a website change
  // marks prior findings historical (needsFreshReview) — orchestration excludes them until a fresh review.
  const saveEdit = async (entityId: string, fields: { name?: string; websiteUrl?: string | null; entityType?: EntityType; relevanceNote?: string }) => {
    setEditError('');
    try { await patchMarketEntity(entityId, fields); setEditing(null); refresh(); }
    catch (e) { if (e instanceof ApiError && e.status === 409) setEditError('You already have a company with that name.'); else on401(e); }
  };

  return (
    <AppShell actions={<button type="button" onClick={() => navigate('/welcome')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>Back</button>}>
      <div style={{ maxWidth: 640 }}>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 var(--sp-3)' }}>Public positioning context</p>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, color: 'var(--ink)', margin: '0 0 var(--sp-3)' }}>Who are we compared with?</h1>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-6)' }}>
          Add a company you compete with, an alternative your customer might choose, or a brand you admire. I’ll read
          how it presents itself <em>publicly</em> — what it claims about itself, not what the market thinks. You confirm what’s relevant.
        </p>

        <div style={{ marginBottom: 'var(--sp-7)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 160px' }}><Field label="Company name" id="m-name" value={name} onChange={setName} /></div>
            <div style={{ flex: '1 1 160px' }}><Field label="Website (optional)" id="m-url" type="url" value={url} onChange={setUrl} placeholder="https://…" /></div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', flex: '1 1 160px' }}>Relationship
              <select value={etype} onChange={(e) => setEtype(e.target.value as EntityType)} style={{ padding: '10px 12px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', background: 'var(--surface)', color: 'var(--ink)' }}>
                <option value="direct">Direct competitor</option>
                <option value="indirect">Indirect competitor</option>
                <option value="alternative">Alternative</option>
                <option value="reference">Reference / admired</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 'var(--sp-3)' }}>
            <div style={{ flex: 1 }}><Field label="Why it’s relevant (optional)" id="m-note" value={note} onChange={setNote} placeholder="e.g. same audience, different price point" /></div>
            <Button variant="primary" onClick={() => void add()}>Add</Button>
          </div>
        </div>

        {entities.length === 0 && <p style={{ fontFamily: 'var(--serif)', color: 'var(--ink-3)' }}>No companies added yet.</p>}
        {entities.map((e) => {
          const rs = reviewState[e.id];
          const active = rs != null && (rs.status === 'QUEUED' || rs.status === 'RETRIEVING' || rs.status === 'EXTRACTING' || rs.status === 'INFERRING');
          const stalled = rs != null && (rs.status === 'INSUFFICIENT_EVIDENCE' || rs.status === 'FAILED');
          return (
          <div key={e.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', boxShadow: 'var(--elev-1)', marginBottom: 'var(--sp-4)', opacity: e.relevanceStatus === 'dismissed' ? 0.5 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <div>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-3)', color: 'var(--ink)' }}>{e.name}</span>
                <span style={{ marginLeft: 8, fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{e.entityType}{e.origin === 'bb_suggested' && e.relevanceStatus !== 'confirmed' ? ' · suggested' : ''}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {e.websiteUrl && e.relevanceStatus !== 'dismissed' && !stalled && <Button variant="secondary" loading={active} onClick={() => void review(e.id)}>{e.needsFreshReview ? 'Review new site' : 'Read public site'}</Button>}
                {stalled && rs!.retryable && <Button variant="secondary" onClick={() => void retry(e.id, rs!.reviewId)}>Try again</Button>}
                {e.relevanceStatus !== 'dismissed' && <button type="button" onClick={() => { setEditing(editing === e.id ? null : e.id); setEditError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)' }}>{editing === e.id ? 'close' : 'edit'}</button>}
                {e.relevanceStatus !== 'dismissed'
                  ? <button type="button" onClick={() => void patchMarketEntity(e.id, { status: 'dismissed' }).then(refresh)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)' }}>dismiss</button>
                  : <button type="button" onClick={() => void patchMarketEntity(e.id, { status: 'restored' }).then(refresh)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)' }}>restore</button>}
              </div>
            </div>
            {editing === e.id && <EntityEditForm entity={e} error={editError} onSave={(fields) => saveEdit(e.id, fields)} onCancel={() => { setEditing(null); setEditError(''); }} />}
            {e.needsFreshReview && editing !== e.id && <p style={{ marginTop: 8, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--gold)' }}>The website changed. The reading below is from the old site — run a fresh review to update it.</p>}
            {active && <div style={{ marginTop: 'var(--sp-4)' }}><Thinking message={STAGE[rs.status]} /></div>}
            {stalled && <p style={{ marginTop: 8, fontFamily: 'var(--serif)', color: 'var(--ink-3)' }}>{rs.message ?? 'Not enough public evidence to read yet.'}</p>}
            {(findings[e.id] ?? []).map((f) => (
              <div key={f.id} style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line)' }}>
                {f.inferenceText === null ? (
                  <>
                    <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ok-ink)' }}>What their site says</span>
                    <blockquote style={{ margin: '6px 0 0', paddingLeft: 'var(--sp-4)', borderLeft: '2px solid var(--line-2)', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>{f.observedText.slice(0, 300)}…<br /><a href={f.sourceUrl} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>{f.sourceUrl}</a></blockquote>
                  </>
                ) : (
                  <>
                    <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--gold)' }}>My reading (not a market fact)</span>
                    <p style={{ margin: '6px 0 var(--sp-3)', fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)' }}>{f.inferenceText}</p>
                  </>
                )}
                <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: '6px 0 0' }}>
                  {f.inferenceText === null ? `Read via ${f.retrievalAdapter} (${f.extractionVersion})` : `My reading · model ${f.modelVersion ?? 'n/a'}${f.promptVersion ? ` · prompt ${f.promptVersion}` : ''}`}
                </p>
                <FindingReview finding={f} onSave={(input) => respond(e.id, f.id, input)} />
              </div>
            ))}
          </div>
          );
        })}
      </div>
    </AppShell>
  );
}

const ENTITY_TYPE_OPTIONS: Array<{ v: EntityType; label: string }> = [{ v: 'direct', label: 'Direct competitor' }, { v: 'indirect', label: 'Indirect competitor' }, { v: 'alternative', label: 'Alternative' }, { v: 'reference', label: 'Reference / admired' }];

/** Compact inline edit form for an existing entity — name / website / type / relevance note. History is
 *  preserved server-side; changing the website marks prior evidence historical (a fresh review is needed). */
function EntityEditForm({ entity, error, onSave, onCancel }: { entity: MarketEntity; error: string; onSave: (fields: { name?: string; websiteUrl?: string | null; entityType?: EntityType; relevanceNote?: string }) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(entity.name);
  const [website, setWebsite] = useState(entity.websiteUrl ?? '');
  const [etype, setEtype] = useState<EntityType>(entity.entityType);
  const [note, setNote] = useState(entity.relevanceNote ?? '');
  const [saving, setSaving] = useState(false);
  const websiteChanged = (website.trim() || '') !== (entity.websiteUrl ?? '');
  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onSave({ name: name.trim(), websiteUrl: website.trim() || null, entityType: etype, relevanceNote: note.trim() }); } finally { setSaving(false); }
  };
  const inp = { width: '100%', padding: '8px 10px', borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', background: 'var(--surface)', color: 'var(--ink)', boxSizing: 'border-box' as const };
  return (
    <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>Company name<input value={name} onChange={(ev) => setName(ev.target.value)} style={{ ...inp, marginTop: 4 }} /></label>
      <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>Website<input type="url" value={website} onChange={(ev) => setWebsite(ev.target.value)} placeholder="https://…" style={{ ...inp, marginTop: 4 }} /></label>
      <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>Relationship<select value={etype} onChange={(ev) => setEtype(ev.target.value as EntityType)} style={{ ...inp, marginTop: 4 }}>{ENTITY_TYPE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select></label>
      <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>Why it’s relevant<input value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="e.g. same audience, different price point" style={{ ...inp, marginTop: 4 }} /></label>
      {websiteChanged && <p style={{ margin: 0, fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--gold)' }}>Changing the website makes the current reading historical — you’ll need a fresh review of the new site.</p>}
      {error && <p role="alert" style={{ margin: 0, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--warn-ink)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

const ACC_OPTIONS: Array<{ v: AccuracyStatus; label: string }> = [{ v: 'yes', label: 'Yes' }, { v: 'partly', label: 'Partly' }, { v: 'no', label: 'No' }];
const REL_OPTIONS: Array<{ v: RelevanceResponseStatus; label: string }> = [{ v: 'relevant', label: 'Relevant' }, { v: 'partly_relevant', label: 'Partly relevant' }, { v: 'not_relevant', label: 'Not relevant' }];

function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ v: T; label: string }>; value: string; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const on = value === o.v;
        return <button key={o.v} type="button" onClick={() => onChange(o.v)} style={{ cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', padding: '4px 12px', borderRadius: 'var(--r-1)', border: `1px solid ${on ? 'var(--ink)' : 'var(--line-2)'}`, background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--surface)' : 'var(--ink-2)' }}>{o.label}</button>;
      })}
    </div>
  );
}

/**
 * Two SEPARATE founder judgments per finding — accuracy (BB's reading of the source) and relevance (strategic
 * usefulness), never one control. Shows the current effective answer, allows revision, and indicates a prior
 * response was revised. Applies to observation AND inference findings alike.
 */
function FindingReview({ finding, onSave }: { finding: MarketFinding; onSave: (input: FindingResponseInput) => Promise<void> }) {
  const eff = finding.effectiveResponse;
  const [acc, setAcc] = useState<AccuracyStatus>(eff?.accuratelyReflectsSource ?? 'unreviewed');
  const [rel, setRel] = useState<RelevanceResponseStatus>(eff?.relevanceStatus ?? 'unreviewed');
  const [accQ, setAccQ] = useState(eff?.accuracyQualification ?? '');
  const [relQ, setRelQ] = useState(eff?.relevanceQualification ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canSave = (acc !== 'unreviewed' || rel !== 'unreviewed') && !(acc === 'partly' && !accQ.trim()) && !(rel === 'partly_relevant' && !relQ.trim());
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try { await onSave({ accuratelyReflectsSource: acc, relevanceStatus: rel, accuracyQualification: accQ.trim() || undefined, relevanceQualification: relQ.trim() || undefined }); setSaved(true); }
    finally { setSaving(false); }
  };
  const label = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: 'var(--sp-3) 0 0' } as const;
  const hint = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: '2px 0 0' } as const;
  const qual = { width: '100%', marginTop: 6, fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', padding: 8, borderRadius: 'var(--r-1)', border: '1px solid var(--line-2)', boxSizing: 'border-box' as const };

  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      <p style={label}>Does this reflect the source?</p>
      <p style={hint}>Whether BB read the public page correctly — not whether the claim is true in the market.</p>
      <Segmented options={ACC_OPTIONS} value={acc} onChange={(v) => { setAcc(v); setSaved(false); }} />
      {acc === 'partly' && <textarea value={accQ} onChange={(ev) => { setAccQ(ev.target.value); setSaved(false); }} placeholder="What did BB get partly wrong about the source?" rows={2} style={qual} />}

      <p style={label}>Is this relevant to your business?</p>
      <p style={hint}>Whether it matters strategically — separate from whether it’s accurate.</p>
      <Segmented options={REL_OPTIONS} value={rel} onChange={(v) => { setRel(v); setSaved(false); }} />
      {rel === 'partly_relevant' && <textarea value={relQ} onChange={(ev) => { setRelQ(ev.target.value); setSaved(false); }} placeholder="How is it only partly relevant?" rows={2} style={qual} />}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 'var(--sp-3)' }}>
        <Button variant={canSave ? 'secondary' : 'ghost'} loading={saving} onClick={() => void save()}>{eff ? 'Update' : 'Save'}</Button>
        {saved
          ? <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ok-ink)' }}>Saved{finding.hasPriorResponses ? ' — revised' : ''}. You can revise anytime.</span>
          : eff && <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' }}>Your current answer is shown{finding.hasPriorResponses ? ' (revised)' : ''}. You can change it.</span>}
      </div>
    </div>
  );
}
