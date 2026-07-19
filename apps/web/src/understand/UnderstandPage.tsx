import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  generateUnderstanding, getUnderstanding, respondToConclusion, getUnderstandingEvidence, ApiError,
  type UnderstandingView, type UnderstandingConclusion, type EpistemicStatus,
} from '../api/client';
import { AppShell, Button, Field, Thinking, RevealBlock } from '../system/ui';

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
  const [phase, setPhase] = useState<'loading' | 'intro' | 'processing' | 'reveal' | 'error'>('loading');
  const [url, setUrl] = useState('');
  const [view, setView] = useState<UnderstandingView | null>(null);
  const [notice, setNotice] = useState('');

  const on401 = useCallback((e: unknown): boolean => { if (e instanceof ApiError && e.status === 401) { navigate('/signin', { replace: true }); return true; } return false; }, [navigate]);

  useEffect(() => {
    if (!founderId) return;
    getUnderstanding().then((u) => { if (u) { setView(u); setPhase('reveal'); } else setPhase('intro'); }).catch((e) => { if (!on401(e)) setPhase('intro'); });
  }, [founderId, on401]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/signin" replace />;

  const run = async () => {
    setNotice(''); setPhase('processing');
    try {
      const r = await generateUnderstanding(url.trim() || undefined);
      if (r.status === 'ok') { setView(r.understanding); setPhase('reveal'); }
      else { setNotice(r.message); setPhase('intro'); }
    } catch (e) { if (on401(e)) return; setNotice('Something went wrong on my side. Nothing was lost — try again.'); setPhase('intro'); }
  };

  const respond = async (c: UnderstandingConclusion, response: 'confirmed' | 'partly' | 'corrected' | 'rejected', text?: string) => {
    try { setView(await respondToConclusion(c.id, response, text)); } catch (e) { if (!on401(e)) setNotice('Could not save that just now.'); }
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
          <Thinking message="Reading your business — this takes a minute. I’m taking it in, not lagging." />
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

      {phase === 'error' && <p style={{ fontFamily: 'var(--serif)', color: 'var(--ink-3)' }}>Something went wrong. Try again.</p>}
    </AppShell>
  );
}

function ConclusionCard({ c, index, onRespond }: { c: UnderstandingConclusion; index: number; onRespond: (c: UnderstandingConclusion, r: 'confirmed' | 'partly' | 'corrected' | 'rejected', t?: string) => void }) {
  const [mode, setMode] = useState<null | 'partly' | 'corrected' | 'rejected'>(null);
  const [text, setText] = useState('');
  const [evidence, setEvidence] = useState<string | null>(null);
  const band = BAND[c.epistemicStatus];
  const done = c.confirmationState !== 'pending';

  const openEvidence = async () => {
    if (evidence !== null || c.evidenceRefs.length === 0) return;
    try { const e = await getUnderstandingEvidence(c.evidenceRefs[0]!); setEvidence(e.text); } catch { setEvidence(''); }
  };

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

        {done ? (
          <p style={{ margin: 0, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>
            {c.confirmationState === 'confirmed' ? 'Confirmed ✓' : `You said: ${c.confirmationState}${c.founderCorrection ? ` — "${c.founderCorrection}"` : ''}`}
          </p>
        ) : mode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
            <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="In your words…" style={{ width: '100%', minHeight: 64, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-1)', padding: '10px 12px', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="primary" onClick={() => { if (text.trim()) onRespond(c, mode, text.trim()); }}>Save</Button>
              <Button variant="ghost" onClick={() => { setMode(null); setText(''); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => onRespond(c, 'confirmed')}>Confirm</Button>
            <Button variant="ghost" onClick={() => setMode('partly')}>Partly</Button>
            <Button variant="ghost" onClick={() => setMode('corrected')}>Correct</Button>
            <Button variant="ghost" onClick={() => setMode('rejected')}>Reject</Button>
          </div>
        )}
      </div>
    </RevealBlock>
  );
}
