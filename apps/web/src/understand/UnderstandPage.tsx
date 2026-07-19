import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  createUnderstandingRun, getUnderstandingRun, retryUnderstandingRun, getUnderstanding, respondToConclusion, getUnderstandingEvidence, ApiError,
  type UnderstandingView, type UnderstandingConclusion, type EpistemicStatus, type RunStatus,
} from '../api/client';
import { AppShell, Button, Field, Thinking, RevealBlock } from '../system/ui';

const STAGE: Record<RunStatus, string> = {
  QUEUED: 'Getting ready…',
  INGESTING: 'Reading your website…',
  ANALYZING: 'Cross-referencing what I found…',
  SYNTHESIZING: 'Writing what I understand…',
  READY: 'Done.',
  FAILED: '',
};
const FAIL_COPY: Record<string, string> = {
  unreachable_website: "I couldn't reach that website. Check the address and try again.",
  insufficient_evidence: "I don't have enough to read yet — add your website so I have something to work from.",
  analysis_failed: 'Something went wrong on my side. Nothing was lost — try again.',
  synthesis_failed: 'Something went wrong on my side. Nothing was lost — try again.',
  unknown: 'Something went wrong on my side. Nothing was lost — try again.',
};

/**
 * Wave 2 — Business Understanding (/understand). Guided website entry → honest processing → a small set of
 * synthesized, epistemically-banded conclusions the founder can confirm/partly/correct/reject. Synthesis
 * only (never raw evidence as the primary result); supporting evidence is fetched on demand. Session-guarded.
 */
const BAND: Record<EpistemicStatus, { label: string; color: string }> = {
  OBSERVED: { label: 'From your site', color: 'var(--ok-ink)' },
  SYNTHESIZED_FROM_OBSERVED: { label: 'My read', color: 'var(--ink-2)' },
  HYPOTHESIS: { label: 'A hypothesis to check', color: 'var(--gold)' },
  NEEDS_MORE_EVIDENCE: { label: 'I need more to say this', color: 'var(--ink-3)' },
};

export function UnderstandPage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<'loading' | 'intro' | 'processing' | 'reveal' | 'failed'>('loading');
  const [url, setUrl] = useState('');
  const [view, setView] = useState<UnderstandingView | null>(null);
  const [notice, setNotice] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [stage, setStage] = useState<RunStatus>('QUEUED');
  const [failCode, setFailCode] = useState<string>('unknown');

  const on401 = useCallback((e: unknown): boolean => { if (e instanceof ApiError && e.status === 401) { navigate('/signin', { replace: true }); return true; } return false; }, [navigate]);

  useEffect(() => {
    if (!founderId) return;
    getUnderstanding().then((u) => { if (u) { setView(u); setPhase('reveal'); } else setPhase('intro'); }).catch((e) => { if (!on401(e)) setPhase('intro'); });
  }, [founderId, on401]);

  // Poll the active run until it reaches a terminal state; survives page refresh (runId re-created idempotently).
  useEffect(() => {
    if (phase !== 'processing' || !runId) return;
    let live = true;
    const poll = async () => {
      if (!live) return;
      try {
        const r = await getUnderstandingRun(runId);
        setStage(r.status);
        if (r.status === 'READY') { const u = await getUnderstanding(); if (u) { setView(u); setPhase('reveal'); } return; }
        if (r.status === 'FAILED') { setFailCode(r.errorCode ?? 'unknown'); setPhase('failed'); return; }
        setTimeout(() => void poll(), 1500);
      } catch (e) { if (!on401(e)) setTimeout(() => void poll(), 2500); }
    };
    void poll();
    return () => { live = false; };
  }, [phase, runId, on401]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/signin" replace />;

  const run = async () => {
    setNotice('');
    try { const r = await createUnderstandingRun(url.trim() || undefined); setRunId(r.runId); setStage(r.status); setPhase('processing'); }
    catch (e) { if (on401(e)) return; setNotice('Something went wrong on my side. Nothing was lost — try again.'); }
  };
  const retry = async () => {
    if (!runId) { setPhase('intro'); return; }
    try { const r = await retryUnderstandingRun(runId); setStage(r.status); setPhase('processing'); }
    catch (e) { if (!on401(e)) setPhase('intro'); }
  };

  const respond = async (c: UnderstandingConclusion, response: 'confirmed' | 'partly' | 'corrected' | 'rejected', fields?: { acceptedText?: string; qualificationText?: string; correctionText?: string }) => {
    try { setView(await respondToConclusion(c.id, response, fields)); } catch (e) { if (!on401(e)) setNotice('Could not save that just now.'); }
  };

  return (
    <AppShell actions={<button type="button" onClick={() => navigate('/welcome')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>Back</button>}>
      {phase === 'loading' && <Thinking message="One moment…" />}

      {phase === 'intro' && (
        <div className="bb-rise" style={{ maxWidth: 560 }}>
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, color: 'var(--ink)', margin: '0 0 var(--sp-4)' }}>Let me read your business</h1>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-6)' }}>
            Give me your website and I’ll read what it says about your business — what you offer, who you speak
            to, and where your positioning is clear or unclear. I’ll tell you what I actually understand, and
            I’ll be honest about what I can’t yet claim about your market.
          </p>
          <form onSubmit={(e) => { e.preventDefault(); void run(); }} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)', maxWidth: 440 }}>
            <Field label="Your website" id="u-url" type="url" value={url} onChange={setUrl} placeholder="https://yourbusiness.com" autoFocus />
            {notice && <p role="status" style={{ margin: 0, color: 'var(--ink-2)', fontFamily: 'var(--serif)' }}>{notice}</p>}
            <div><Button type="submit" variant="primary">Read my business</Button></div>
          </form>
        </div>
      )}

      {phase === 'processing' && (
        <div style={{ maxWidth: 520, padding: '8vh 0' }}>
          <Thinking message={STAGE[stage] || 'Reading your business…'} />
          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)', marginTop: 'var(--sp-4)' }}>This takes a minute. You can leave this page and come back — I’ll keep working.</p>
        </div>
      )}

      {phase === 'failed' && (
        <div className="bb-rise" style={{ maxWidth: 520, padding: '6vh 0' }}>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-3)', color: 'var(--ink)', margin: '0 0 var(--sp-5)' }}>{FAIL_COPY[failCode] ?? FAIL_COPY['unknown']}</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" onClick={() => void retry()}>Try again</Button>
            <Button variant="secondary" onClick={() => setPhase('intro')}>Change website</Button>
          </div>
        </div>
      )}

      {phase === 'reveal' && view && (
        <div style={{ maxWidth: 620 }}>
          <p className="bb-rise" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 var(--sp-3)' }}>What I understand</p>
          <h1 className="bb-rise" style={{ ['--i' as string]: 1, fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, color: 'var(--ink)', margin: '0 0 var(--sp-6)' }}>Here’s your business, as I read it.</h1>
          {notice && <p role="status" style={{ color: 'var(--warn-ink)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)' }}>{notice}</p>}
          {view.conclusions.map((c, i) => <ConclusionCard key={c.id} c={c} index={i} onRespond={respond} />)}
          <div style={{ marginTop: 'var(--sp-6)' }}>
            <Button variant="secondary" onClick={() => setPhase('intro')}>Read another source</Button>
          </div>
        </div>
      )}

    </AppShell>
  );
}

const RESPONSE_LABEL: Record<string, string> = {
  confirmed: 'You confirmed this reflects your business.',
  partly: 'You said some of this is right.',
  corrected: 'You corrected this.',
  rejected: 'You said this doesn’t reflect your business.',
};
const field: React.CSSProperties = { width: '100%', minHeight: 56, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-1)', padding: '10px 12px', boxSizing: 'border-box' };

function ConclusionCard({ c, index, onRespond }: { c: UnderstandingConclusion; index: number; onRespond: (c: UnderstandingConclusion, r: 'confirmed' | 'partly' | 'corrected' | 'rejected', fields?: { acceptedText?: string; qualificationText?: string; correctionText?: string }) => void }) {
  const [mode, setMode] = useState<null | 'partly' | 'corrected'>(null);
  const [accepted, setAccepted] = useState('');
  const [qualification, setQualification] = useState('');
  const [correction, setCorrection] = useState('');
  const [evidence, setEvidence] = useState<string | null>(null);
  const band = BAND[c.epistemicStatus];
  const r = c.response;

  const openEvidence = async () => {
    if (evidence !== null || c.evidenceRefs.length === 0) return;
    try { const e = await getUnderstandingEvidence(c.evidenceRefs[0]!); setEvidence(e.text); } catch { setEvidence(''); }
  };
  const reset = () => { setMode(null); setAccepted(''); setQualification(''); setCorrection(''); };

  return (
    <RevealBlock index={index}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', boxShadow: 'var(--elev-1)' }}>
        <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', letterSpacing: '0.06em', textTransform: 'uppercase', color: band.color }}>{band.label}</span>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-3)', color: 'var(--ink)', lineHeight: 'var(--lh-snug)', margin: '6px 0 var(--sp-4)' }}>{c.statement}</p>

        {c.evidenceCount > 0 && (
          <details onToggle={() => void openEvidence()} style={{ marginBottom: 'var(--sp-4)' }}>
            <summary style={{ cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>What this rests on</summary>
            <blockquote style={{ margin: 'var(--sp-3) 0 0', paddingLeft: 'var(--sp-4)', borderLeft: '2px solid var(--line-2)', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>{evidence ?? '…'}</blockquote>
          </details>
        )}

        {r ? (
          <div style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>
            <span>{RESPONSE_LABEL[r.type]}{r.revisedEarlier ? ' (revised)' : ''}</span>
            {(r.correctionText || r.qualificationText || r.acceptedText) && (
              <p style={{ margin: '6px 0 0', color: 'var(--ink-2)', fontFamily: 'var(--serif)' }}>
                {r.acceptedText && <>Kept: “{r.acceptedText}”. </>}{(r.qualificationText || r.correctionText) && <>In your words: “{r.qualificationText || r.correctionText}”.</>}
              </p>
            )}
            <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
              <button type="button" onClick={() => onRespond(c, 'confirmed')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textDecoration: 'underline' }}>confirm instead</button>
              <button type="button" onClick={() => setMode('corrected')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textDecoration: 'underline' }}>revise my response</button>
            </div>
          </div>
        ) : mode === 'partly' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>What’s right about this? <span style={{ color: 'var(--ink-3)' }}>(optional)</span>
              <textarea value={accepted} onChange={(e) => setAccepted(e.target.value)} style={{ ...field, marginTop: 4 }} /></label>
            <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>What would you change?
              <textarea autoFocus value={qualification} onChange={(e) => setQualification(e.target.value)} style={{ ...field, marginTop: 4 }} /></label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" onClick={() => { if (qualification.trim()) { onRespond(c, 'partly', { acceptedText: accepted.trim() || undefined, qualificationText: qualification.trim() }); reset(); } }}>Save</Button>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </div>
        ) : mode === 'corrected' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <label style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>What’s the correction?
              <textarea autoFocus value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="In your words…" style={{ ...field, marginTop: 4 }} /></label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" disabled={!correction.trim()} onClick={() => { if (correction.trim()) { onRespond(c, 'corrected', { correctionText: correction.trim() }); reset(); } }}>Save correction</Button>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => onRespond(c, 'confirmed')}>Yes, this is right</Button>
            <Button variant="ghost" onClick={() => setMode('partly')}>Partly</Button>
            <Button variant="ghost" onClick={() => setMode('corrected')}>Correct it</Button>
            <Button variant="ghost" onClick={() => onRespond(c, 'rejected')}>Not my business</Button>
          </div>
        )}
      </div>
    </RevealBlock>
  );
}
