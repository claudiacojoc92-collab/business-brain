import { useCallback, useEffect, useState } from 'react';

/**
 * Recommendation (DEV preview) — the first Product Primitive under ADR-010. Renders each recommendation
 * as a READ, never a fact: the founder-facing "what I'd do", with its full disclosure — what it rests
 * on, what it assumes, and its confidence. The badge shows both layers: it is a Product Primitive
 * (Layer 2) whose underlying truth status is `inferred` (Layer 1) — honesty inherited by construction.
 */
const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '48px 20px' };
const inner: React.CSSProperties = { maxWidth: '760px', margin: '0 auto' };
const serif: React.CSSProperties = { fontFamily: 'var(--serif)' };
const meta: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--faint)', letterSpacing: '0.02em' };
const kicker: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.68rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, margin: '18px 0 8px' };
const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--gold-soft)', borderRadius: 14, padding: '22px 24px', marginBottom: 18, boxShadow: 'var(--shadow-soft)' };
const pill = (bg: string, fg: string): React.CSSProperties => ({ fontFamily: 'var(--sans)', fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', borderRadius: 20, padding: '3px 10px', marginLeft: 8, background: bg, color: fg, border: '1px solid var(--line)' });
const quote: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--ink-2)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 11px', marginTop: 6 };

interface Basis { id: string; quote: string }
interface Rec { claimFragmentId: string; truthStatus: string; claimStatement: string; recommendation: string; evidenceBasis: Basis[]; assumptions: string[]; confidence: string }

export function RecommendationPreviewPage() {
  const [label, setLabel] = useState('My read — what I’d do (a recommendation, not a fact)');
  const [recs, setRecs] = useState<Rec[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await fetch('/dev/recommendation/state' + window.location.search); if (r.ok) { const j = await r.json(); setLabel(j.label ?? label); setRecs((j.recommendations ?? []) as Rec[]); } else setErr(`state ${r.status}`); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [label]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ ...meta, border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 22, color: 'var(--ink-3)' }}>
          DEV · Recommendation — the first <b>Product Primitive</b> (ADR-010). A recommendation is <b>inference</b> (Layer 1) under a <b>disclosure contract</b> (Layer 2): it tells you what it rests on, what it assumes, and its confidence — and it is labeled a <b>read</b>, never a fact.
        </div>
        <h1 style={{ ...serif, fontSize: '1.6rem', fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 6 }}>What I&apos;d do — and exactly why.</h1>
        <p style={{ ...meta, fontSize: '0.85rem', color: 'var(--ink-2)', marginBottom: 20 }}>Advice you can weigh, because it shows its work. Every recommendation stays inference underneath — never asserted as fact.</p>

        {err && <div style={{ ...meta, color: 'var(--gold)', marginBottom: 14 }}>error: {err}</div>}
        {recs.length === 0 && !err && <div style={{ ...serif, fontSize: '1.1rem', color: 'var(--ink-2)' }}>No recommendations yet.</div>}

        {recs.map((r) => (
          <div key={r.claimFragmentId} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--gold)', fontWeight: 600 }}>{label}</span>
              <span style={pill('var(--gold-bg)', 'var(--gold)')}>confidence · {r.confidence}</span>
              <span style={pill('var(--paper-2)', 'var(--ink-3)')} title="Layer-1 truth status is preserved">truth: {r.truthStatus}</span>
            </div>
            <div style={{ ...serif, fontSize: '1.3rem', lineHeight: 1.45, marginBottom: 4 }}>{r.recommendation}</div>

            <div style={kicker}>What this rests on</div>
            {r.evidenceBasis.map((b) => <div key={b.id} style={quote}>&ldquo;{b.quote}&rdquo;</div>)}

            <div style={kicker}>What I&apos;m assuming</div>
            {r.assumptions.map((a, i) => <div key={i} style={{ ...meta, fontSize: '0.85rem', color: 'var(--ink-2)', marginTop: 4 }}>· {a}</div>)}

            <div style={{ ...meta, marginTop: 14, color: 'var(--ink-3)', fontStyle: 'italic' }}>
              This is a recommendation (my inference), not an established fact — a Product Primitive over an <code>inferred</code> claim.
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
