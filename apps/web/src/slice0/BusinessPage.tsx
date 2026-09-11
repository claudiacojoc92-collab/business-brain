import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from './AppShell';
import { BusinessStartPage } from './BusinessStartPage';
import { LoadError } from './errors';
import { useSession } from './session';
import { useLocale } from '../i18n/LocaleContext';
import {
  getUnderstanding, getCorrections, submitCorrection,
  type UnderstandingView, type BusinessCorrection,
} from '../api/client';

/**
 * Business — "what BB understands about this business." A STANDING surface (not one-shot onboarding):
 * grounded claims, why BB believes each, what it can't establish, what doesn't line up — and the founder
 * can correct a claim. A correction is held as founder-owned truth (real founder_state path) and is
 * consumed downstream by Talk to BB. When BB has no understanding yet, this delegates to the learn flow.
 */

type Subject = 'offer' | 'positioning' | 'audience';

interface Claim { subject: Subject; label: string; statement: string; evidence: string[]; sources: string[]; }

const clean = (xs?: (string | null | undefined)[]): string[] =>
  (xs ?? []).map((x) => (x ?? '').trim()).filter(Boolean);
const first = (...xs: (string | undefined)[]): string => {
  for (const x of xs) if (x && x.trim()) return x.trim();
  return '';
};

function buildClaims(u: UnderstandingView): Claim[] {
  const un = u.understanding ?? {};
  const claims: Claim[] = [];
  const offer = first(un.offer?.summary);
  if (offer) claims.push({ subject: 'offer', label: 'Your offer', statement: offer, evidence: clean(un.offer?.explicit), sources: clean(un.offer?.sourceRefs) });
  const pos = first(un.positioning?.summary);
  if (pos) claims.push({ subject: 'positioning', label: 'Your positioning', statement: pos, evidence: clean(un.positioning?.evidenceBacked), sources: clean(un.positioning?.sourceRefs) });
  const aud = first(clean(un.audience?.appearsTargeted).join(' · '), clean(un.audience?.addressed).join(' · '));
  if (aud) claims.push({ subject: 'audience', label: 'Who you speak to', statement: aud, evidence: clean(un.audience?.addressed), sources: clean(un.audience?.sourceRefs) });
  return claims;
}

/** One claim: held-from-correction (founder truth) OR BB inference, always corrigible. Progressive disclosure. */
function ClaimBlock({
  claim, correction, onSubmit,
}: {
  claim: Claim;
  correction: BusinessCorrection | undefined;
  onSubmit: (subject: Subject, text: string) => Promise<void>;
}) {
  const [reveal, setReveal] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false); // B1 — a correction that failed to save must not fail silently
  const held = Boolean(correction);
  const current = held ? correction!.statement : claim.statement;

  async function save() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr(false);
    try { await onSubmit(claim.subject, t); setCorrecting(false); setText(''); setReveal(false); }
    catch { setErr(true); }
    finally { setBusy(false); }
  }

  return (
    <div className={held ? 's0-claim s0-claim-held' : 's0-claim'}>
      <div className="s0-claim-label">{claim.label}</div>
      <p className="s0-claim-stmt">{current}</p>
      {held ? <div className="s0-claim-held-tag">Held from your correction</div> : null}

      <div className="s0-claim-tools">
        {(held ? claim.statement : claim.evidence.length > 0 || claim.sources.length > 0) ? (
          <button type="button" className="s0-claim-toggle" onClick={() => setReveal((v) => !v)}>
            {held ? (reveal ? 'Hide what I first read' : 'What I first read ↓') : (reveal ? 'Hide why' : 'Why I think this ↓')}
          </button>
        ) : null}
        {!correcting ? (
          <button type="button" className="s0-claim-correct" onClick={() => { setCorrecting(true); setText(''); }}>
            Not quite right
          </button>
        ) : null}
      </div>

      {reveal ? (
        <div className="s0-claim-reveal">
          {held ? (
            <p className="s0-claim-first">BB first read: “{claim.statement}”</p>
          ) : (
            <>
              {claim.evidence.length > 0 ? (
                <ul className="s0-claim-ev">{claim.evidence.slice(0, 4).map((e, i) => <li key={i}>{e}</li>)}</ul>
              ) : null}
            </>
          )}
          {claim.sources.length > 0 ? (
            <div className="s0-claim-src">
              <span className="s0-claim-src-k">From</span>
              {claim.sources.slice(0, 6).map((s, i) => <span key={i} className="s0-src-chip">{s}</span>)}
            </div>
          ) : null}
        </div>
      ) : null}

      {correcting ? (
        <div className="s0-correct">
          <label className="s0-correct-q">What should I hold instead?</label>
          <textarea
            className="s0-correct-field"
            value={text}
            autoFocus
            rows={3}
            placeholder="Tell me the truth about your business in your own words…"
            onChange={(e) => setText(e.target.value)}
          />
          {err ? <div className="s0-error" role="alert">That didn’t save just now. Try again in a moment.</div> : null}
          <div className="s0-correct-actions">
            <button type="button" className="s0-btn" disabled={busy || !text.trim()} onClick={save}>
              {busy ? 'Saving…' : 'Save what’s true'}
            </button>
            <button type="button" className="s0-btn-ghost" onClick={() => setCorrecting(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Skeleton() {
  return <div className="s0-biz2"><div className="s0-biz2-eyebrow">Loading…</div></div>;
}

export function BusinessPage(): React.ReactElement {
  const { id } = useParams();
  const { businesses } = useSession();
  const { t } = useLocale();
  const business = businesses.find((b) => b.id === id);
  const base = `/b/${id}`;

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);   // B2 — a transient understanding-fetch failure, NEVER "no understanding yet"
  const [u, setU] = useState<UnderstandingView | null>(null);
  const [corrections, setCorrections] = useState<Record<string, BusinessCorrection>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoadErr(false);
    const [uv, cv] = await Promise.allSettled([getUnderstanding(id), getCorrections(id)]);
    // B2: only a FULFILLED read tells us the real state (present vs. genuinely none). A REJECTED read is a
    // transient failure — treating it as { state: 'none' } would show onboarding to an already-onboarded
    // founder and read as lost business understanding, so it becomes a distinct, retryable load error.
    if (uv.status === 'fulfilled') {
      setU(uv.value);
    } else {
      setLoadErr(true);
      setLoading(false);
      return;
    }
    if (cv.status === 'fulfilled') {
      const map: Record<string, BusinessCorrection> = {};
      for (const c of cv.value.corrections) if (c.subject) map[c.subject] = c;
      setCorrections(map);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  const onSubmit = useCallback(async (subject: Subject, textVal: string) => {
    if (!id) return;
    await submitCorrection(id, subject, textVal);
    const cv = await getCorrections(id);
    const map: Record<string, BusinessCorrection> = {};
    for (const c of cv.corrections) if (c.subject) map[c.subject] = c;
    setCorrections(map);
  }, [id]);

  if (loading) return <AppShell><Skeleton /></AppShell>;

  // B2: a transient fetch failure is NOT "no understanding" — offer a calm retry, never onboarding.
  if (loadErr) return <LoadError onRetry={() => { setLoading(true); void load(); }} />;

  // No understanding yet (a real, fulfilled "none") → the learn flow owns this surface (unchanged).
  if (!u || u.state !== 'present') return <BusinessStartPage />;

  const claims = buildClaims(u);
  const un = u.understanding ?? {};
  const unknowns = clean([...(un.unknowns ?? []), ...clean(un.audience?.unknown), ...clean(un.offer?.unclear)]);
  const contradictions = (un.contradictions ?? []).filter((c) => c && (c.tension || c.statementA));
  const name = business?.name ?? 'your business';

  return (
    <AppShell>
      <div className="s0-biz2">
        <div className="s0-biz2-eyebrow">{t('biz.eyebrow')}</div>
        <h1 className="s0-biz2-h1">Here’s what I understand about {name}.</h1>

        <div className="s0-claims">
          {claims.map((c) => (
            <ClaimBlock key={c.subject} claim={c} correction={corrections[c.subject]} onSubmit={onSubmit} />
          ))}
        </div>

        {unknowns.length > 0 ? (
          <section className="s0-biz2-sec">
            <div className="s0-biz2-sec-k">{t('biz.unknowns')}</div>
            <ul className="s0-unknowns">{unknowns.slice(0, 5).map((x, i) => <li key={i}>{x}</li>)}</ul>
            <Link className="s0-biz2-tell" to={`${base}/talk`}>{t('biz.tell')} →</Link>
          </section>
        ) : null}

        {contradictions.length > 0 ? (
          <section className="s0-biz2-sec">
            <div className="s0-biz2-sec-k">{t('biz.contradictions')}</div>
            {contradictions.slice(0, 3).map((c, i) => <ContradictionBlock key={i} c={c} />)}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function ContradictionBlock({ c }: { c: { statementA: string; statementB: string; tension: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="s0-contra">
      <button type="button" className="s0-contra-head" onClick={() => setOpen((v) => !v)}>
        {c.tension || 'Two things don’t fully line up.'} {open ? '↑' : '↓'}
      </button>
      {open ? (
        <div className="s0-contra-body">
          {c.statementA ? <p>· {c.statementA}</p> : null}
          {c.statementB ? <p>· {c.statementB}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
