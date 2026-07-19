import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  getMarketEntities, addMarketEntity, createMarketReview, getMarketReview, retryMarketReview, getEntityFindings, respondToFinding, patchMarketEntity, ApiError,
  type MarketEntity, type MarketFinding, type ReviewStatus,
} from '../api/client';
import { AppShell, Button, Field, Thinking } from '../system/ui';

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
  const [findings, setFindings] = useState<Record<string, MarketFinding[]>>({});
  const [reviewState, setReviewState] = useState<Record<string, { reviewId: string; status: ReviewStatus; message: string | null }>>({});

  const on401 = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) navigate('/signin', { replace: true }); }, [navigate]);
  const refresh = useCallback(() => { getMarketEntities().then(setEntities).catch(on401); }, [on401]);
  useEffect(() => { if (founderId) refresh(); }, [founderId, refresh]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/signin" replace />;

  const add = async () => {
    if (!name.trim()) return;
    try { await addMarketEntity({ name: name.trim(), websiteUrl: url.trim() || undefined }); setName(''); setUrl(''); refresh(); } catch (e) { on401(e); }
  };
  const poll = async (entityId: string, reviewId: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      let r;
      try { r = await getMarketReview(reviewId); } catch (e) { on401(e); return; }
      setReviewState((s) => ({ ...s, [entityId]: { reviewId, status: r.status, message: r.message } }));
      if (r.status === 'READY') { try { const f = await getEntityFindings(entityId); setFindings((s) => ({ ...s, [entityId]: f })); } catch (e) { on401(e); } return; }
      if (r.status === 'INSUFFICIENT_EVIDENCE' || r.status === 'FAILED') return;
    }
  };
  const review = async (entityId: string) => {
    setFindings((s) => { const n = { ...s }; delete n[entityId]; return n; });
    try {
      const r = await createMarketReview(entityId);
      setReviewState((s) => ({ ...s, [entityId]: { reviewId: r.reviewId, status: r.status, message: r.message } }));
      void poll(entityId, r.reviewId);
    } catch (e) { on401(e); }
  };
  const retry = async (entityId: string, reviewId: string) => {
    try {
      const r = await retryMarketReview(reviewId);
      setReviewState((s) => ({ ...s, [entityId]: { reviewId: r.reviewId, status: r.status, message: r.message } }));
      void poll(entityId, r.reviewId);
    } catch (e) { on401(e); }
  };
  const respond = async (entityId: string, findingId: string, response: 'confirmed' | 'dismissed' | 'qualified', q?: string) => {
    try { await respondToFinding(findingId, response, q); setFindings((s) => ({ ...s, [entityId]: s[entityId]!.map((f) => f.id === findingId ? { ...f, founderResponse: response, founderQualification: q ?? null } : f) })); } catch (e) { on401(e); }
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

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 'var(--sp-7)' }}>
          <div style={{ flex: 1 }}><Field label="Company name" id="m-name" value={name} onChange={setName} /></div>
          <div style={{ flex: 1 }}><Field label="Website (optional)" id="m-url" type="url" value={url} onChange={setUrl} placeholder="https://…" /></div>
          <Button variant="primary" onClick={() => void add()}>Add</Button>
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
              <div style={{ display: 'flex', gap: 8 }}>
                {e.websiteUrl && e.relevanceStatus !== 'dismissed' && !stalled && <Button variant="secondary" loading={active} onClick={() => void review(e.id)}>Read public site</Button>}
                {stalled && <Button variant="secondary" onClick={() => void retry(e.id, rs!.reviewId)}>Try again</Button>}
                {e.relevanceStatus !== 'dismissed' && <button type="button" onClick={() => void patchMarketEntity(e.id, { status: 'dismissed' }).then(refresh)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)' }}>dismiss</button>}
              </div>
            </div>
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
                    {f.founderResponse === 'unreviewed' ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button variant="secondary" onClick={() => void respond(e.id, f.id, 'confirmed')}>Relevant</Button>
                        <Button variant="ghost" onClick={() => void respond(e.id, f.id, 'dismissed')}>Not relevant</Button>
                      </div>
                    ) : <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>You marked this {f.founderResponse}.</p>}
                  </>
                )}
              </div>
            ))}
          </div>
          );
        })}
      </div>
    </AppShell>
  );
}
