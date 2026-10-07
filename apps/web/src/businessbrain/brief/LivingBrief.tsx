/**
 * The Living Brief — read-only editorial rendering of ONE immutable Current Version.
 *
 * Four zones: (1) State of the record, (2) Most important current read (lede + provenance),
 * (3) Founder decision preview (visual-only, non-interactive placeholder), (4) the complete
 * reasoned Brief in the frozen seven-section order, with inline provenance disclosures.
 *
 * Paper-and-ink system (tokens.css): serif heads/lede, sans body, restrained gold, amber set-aside
 * for "What we cannot yet know", hairline rules, generous whitespace — NO cards, NO metric tiles.
 * Diagnostic numbers appear ONLY inside Evidence; every other zone stays qualitative. Provenance is
 * expressed with PUBLIC refs (rc1, e1.2, rec1, a1.1) and anchors — never internal ids.
 */
import type { BBCurrentVersion, BBEvidenceMeasure } from '../../api/client';
import type { ResolvedProvenance } from './traceability';

// ── tokens → local style constants ────────────────────────────────────────────
const page: React.CSSProperties = {
  maxWidth: 'var(--reading, 680px)', margin: '0 auto', padding: '40px 22px 96px',
  background: 'var(--paper, #f7f4ee)', color: 'var(--ink, #26221c)',
  font: '400 16px/1.65 var(--sans, Inter, system-ui)',
};
const kicker: React.CSSProperties = {
  font: '600 11px/1.4 var(--sans, Inter)', letterSpacing: '0.12em', textTransform: 'uppercase',
  color: 'var(--ink-3, #8a8275)', margin: '0 0 14px',
};
const sectionHead: React.CSSProperties = {
  font: '500 24px/1.25 var(--serif, Newsreader, Georgia)', color: 'var(--ink, #26221c)', margin: '0 0 12px',
};
const bodyText: React.CSSProperties = { color: 'var(--ink-2, #4a443b)', font: '400 16px/1.7 var(--sans, Inter)' };
const hairline: React.CSSProperties = { border: 0, borderTop: '1px solid var(--line, #e2dccf)', margin: '48px 0' };
const pill: React.CSSProperties = {
  display: 'inline-block', font: '500 11px/1 var(--sans, Inter)', letterSpacing: '0.02em',
  color: 'var(--ink-3, #8a8275)', background: 'var(--paper-2, #f1ece3)',
  border: '1px solid var(--line, #e2dccf)', borderRadius: 4, padding: '3px 6px',
};

function anchorId(ref: string): string { return `bp-${ref.replace('.', '-')}`; }

/** Evidence measure value — the ONLY place diagnostic numbers are rendered. */
function MeasureValue({ m }: { m: BBEvidenceMeasure }) {
  if (m.value !== undefined) {
    const rendered = m.kind === 'proportion' ? `${m.value}%` : String(m.value);
    return <strong style={{ color: 'var(--ink, #26221c)', fontWeight: 600 }}>{` — ${rendered}`}</strong>;
  }
  if (m.kind === 'absence') return <span style={{ color: 'var(--ink-3, #8a8275)' }}>{' — none found'}</span>;
  return <span style={{ color: 'var(--ink-3, #8a8275)' }}>{' — present'}</span>;
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
function windowRange(w?: BBCurrentVersion['importWindow']): string {
  const a = fmtDate(w?.from), b = fmtDate(w?.to);
  if (a && b) return a === b ? a : `${a} – ${b}`;
  return '';
}

/** A small, inline, accessible provenance disclosure (native <details> — no modal, mobile-friendly). */
function Provenance({ label, refs }: { label: string; refs: { ref: string; statement: string }[] }) {
  if (refs.length === 0) return null;
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{
        cursor: 'pointer', listStyle: 'none', display: 'inline-flex', alignItems: 'center', gap: 8,
        font: '500 13px/1.4 var(--sans, Inter)', color: 'var(--gold, #b07d33)',
      }}>
        <span aria-hidden>↳</span>{label}
      </summary>
      <ul style={{ margin: '10px 0 4px', paddingLeft: 0, listStyle: 'none' }}>
        {refs.map((r) => (
          <li key={r.ref} style={{ display: 'flex', gap: 10, alignItems: 'baseline', margin: '0 0 8px' }}>
            <a href={`#${anchorId(r.ref)}`} style={{ ...pill, textDecoration: 'none' }}>{r.ref}</a>
            <span style={{ ...bodyText, font: '400 14px/1.55 var(--sans, Inter)', color: 'var(--ink-2, #4a443b)' }}>{r.statement}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── Zone 1 — State of the record ───────────────────────────────────────────────
// Dates, post count and produced date are QUIET record provenance — not KPIs, no metric-card
// treatment, no emphasised figures. Diagnostic quantities live only in Evidence.
function RecordStrip({ v }: { v: BBCurrentVersion }) {
  const produced = fmtDate(v.producedAt);
  const range = windowRange(v.importWindow);
  const posts = v.importWindow?.postCount;
  const scope: string[] = [];
  if (posts !== undefined) scope.push(`Instagram · ${posts} recent posts`);
  if (range) scope.push(range);
  return (
    <header data-testid="zone-record" style={{ marginBottom: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{
          font: '600 10px/1 var(--sans, Inter)', letterSpacing: '0.11em', textTransform: 'uppercase',
          color: 'var(--gold, #b07d33)', border: '1px solid var(--gold-soft, #c79a55)',
          borderRadius: 999, padding: '4px 9px',
        }}>Current version</span>
      </div>
      <p style={{ font: '400 13px/1.55 var(--sans, Inter)', color: 'var(--ink-3, #8a8275)', margin: 0, letterSpacing: '0.005em' }}>
        {scope.join('  ·  ')}
      </p>
      {produced ? (
        <p style={{ font: '400 12px/1.5 var(--sans, Inter)', color: 'var(--faint, #b8b0a1)', margin: '3px 0 0' }}>
          Read {produced}
        </p>
      ) : null}
    </header>
  );
}

// ── Zone 2 — Most important current read (lede) ────────────────────────────────
function Lede({ v }: { v: BBCurrentVersion }) {
  const range = windowRange(v.importWindow);
  return (
    <section data-testid="zone-lede" aria-label="Most important current read">
      <p style={{ ...kicker, color: 'var(--gold, #b07d33)' }}>The most important thing right now</p>
      <p style={{ font: '400 27px/1.4 var(--serif, Newsreader, Georgia)', color: 'var(--ink, #26221c)', margin: '0 0 16px', letterSpacing: '0.005em' }}>
        {v.businessReality}
      </p>
      <p style={{ font: '400 13px/1.55 var(--sans, Inter)', color: 'var(--ink-3, #8a8275)', margin: 0 }}>
        Read from what your recent posts actually show{range ? ` · ${range}` : ''}.
      </p>
    </section>
  );
}

// ── Zone 3 — Founder decision preview (visual-only, non-interactive) ───────────
function DecisionPreview() {
  const ghost: React.CSSProperties = {
    font: '500 14px/1 var(--sans, Inter)', color: 'var(--ink-3, #8a8275)',
    background: 'transparent', border: '1px solid var(--line-2, #d8d0c0)', borderRadius: 8,
    padding: '11px 18px', opacity: 0.7, cursor: 'default',
  };
  return (
    <section data-testid="zone-decision" aria-label="Founder decision (preview)"
      style={{ marginTop: 40, padding: '22px 0 4px', borderTop: '1px solid var(--line, #e2dccf)' }}>
      <p style={kicker}>Your decision</p>
      <div aria-hidden style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ ...ghost, borderColor: 'var(--gold-soft, #c79a55)', color: 'var(--gold, #b07d33)' }}>Commit</span>
        <span style={ghost}>Not yet</span>
        <span style={ghost}>Disagree</span>
      </div>
      <p style={{ font: '400 13px/1.55 var(--sans, Inter)', color: 'var(--faint, #b8b0a1)', margin: 0, fontStyle: 'italic' }}>
        Decision recording comes in a later phase.
      </p>
    </section>
  );
}

// ── Zone 4 — the complete reasoned Brief ───────────────────────────────────────
const srOnly: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

function Block({ title, testid, note, children }: { title: string; testid: string; note?: string; children: React.ReactNode }) {
  return (
    <section data-testid={testid} aria-labelledby={`${testid}-h`} style={{ marginBottom: 4 }}>
      <h2 id={`${testid}-h`} style={sectionHead}>{title}</h2>
      {note ? <p style={{ ...kicker, textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', color: 'var(--faint, #b8b0a1)', margin: '-6px 0 14px' }}>{note}</p> : null}
      {children}
    </section>
  );
}

function ReasonedBrief({ v, provenance }: { v: BBCurrentVersion; provenance?: ResolvedProvenance }) {
  const P = provenance?.ok ? provenance : undefined;
  return (
    <div data-testid="zone-brief">
      <p style={{ ...kicker, marginBottom: 28 }}>The full reasoning</p>

      {/* 1 — Current Reality */}
      <Block title="Current reality" testid="brief-current-reality">
        <p style={{ font: '400 19px/1.6 var(--serif, Newsreader, Georgia)', color: 'var(--ink, #26221c)', margin: 0 }}>{v.businessReality}</p>
      </Block>
      <hr style={hairline} />

      {/* 2 — Why This Matters */}
      <Block title="Why this matters" testid="brief-why-matters">
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
          {v.businessConsequences.map((c, i) => (
            <li key={i} style={{ ...bodyText, margin: '0 0 12px', paddingLeft: 18, position: 'relative' }}>
              <span aria-hidden style={{ position: 'absolute', left: 0, color: 'var(--gold-soft, #c79a55)' }}>—</span>{c}
            </li>
          ))}
        </ul>
      </Block>
      <hr style={hairline} />

      {/* 3 — Evidence (the only section with numbers) — observed from one source, with its window */}
      <Block title="Evidence" testid="brief-evidence"
        note={v.importWindow ? `Observed from Instagram · your ${v.importWindow.postCount} most recent posts${windowRange(v.importWindow) ? ` · ${windowRange(v.importWindow)}` : ''}` : 'Observed from what your content shows'}>
        {v.evidence.claims.map((claim, ci) => (
          <div key={ci} style={{ marginBottom: 18 }}>
            <p style={{ font: '500 16px/1.55 var(--sans, Inter)', color: 'var(--ink, #26221c)', margin: '0 0 8px' }}>{claim.claimStatement}</p>
            <ul data-testid="evidence-measures" style={{ margin: 0, paddingLeft: 18, ...bodyText, font: '400 15px/1.7 var(--sans, Inter)' }}>
              {claim.measures.map((m, mi) => (
                <li key={mi} id={anchorId(`e${ci + 1}.${mi + 1}`)} style={{ scrollMarginTop: 16 }}>
                  <span style={pill}>{`e${ci + 1}.${mi + 1}`}</span>{'  '}{m.descriptor}<MeasureValue m={m} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Block>
      <hr style={hairline} />

      {/* 4 — What We Cannot Yet Know (amber set-aside) */}
      <Block title="What we cannot yet know" testid="brief-cannot-know">
        <p style={{
          margin: 0, font: '400 16px/1.65 var(--sans, Inter)', color: '#7a5c1a',
          background: 'rgba(176,125,51,.06)', borderLeft: '2px solid #c1953f', borderRadius: '0 6px 6px 0',
          padding: '14px 18px',
        }}>{v.cannotYetKnow}</p>
      </Block>
      <hr style={hairline} />

      {/* 5 — Root Causes (→ Evidence) */}
      <Block title="Root causes" testid="brief-root-causes" note="Our interpretation — likely reasons, not certainties">
        <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', counterReset: 'rc' }}>
          {v.rootCauses.map((rc, i) => {
            const ref = `rc${i + 1}`;
            const ev = P?.rootCauseEvidence[ref] ?? [];
            return (
              <li key={i} id={anchorId(ref)} style={{ margin: '0 0 20px', scrollMarginTop: 16 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span style={pill}>{ref}</span>
                  <p style={{ ...bodyText, margin: 0 }}>{rc}</p>
                </div>
                {P ? <div style={{ paddingLeft: 44 }}>
                  <Provenance label={`Grounded in evidence (${ev.length})`}
                    refs={ev.map((e) => ({ ref: e.ref, statement: e.claimStatement }))} />
                </div> : null}
              </li>
            );
          })}
        </ol>
      </Block>
      <hr style={hairline} />

      {/* 6 — Recommendations (→ Root Cause) */}
      <Block title="Recommendations" testid="brief-recommendations">
        <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
          {v.recommendations.map((r, i) => {
            const ref = `rec${i + 1}`;
            const rcs = P?.recRootCauses[ref] ?? [];
            return (
              <li key={i} id={anchorId(ref)} style={{ margin: '0 0 20px', scrollMarginTop: 16 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                  <span style={pill}>{ref}</span>
                  <p style={{ ...bodyText, margin: 0 }}>{r}</p>
                </div>
                {P ? <div style={{ paddingLeft: 44 }}>
                  <Provenance label={`Addresses root cause (${rcs.length})`} refs={rcs} />
                </div> : null}
              </li>
            );
          })}
        </ol>
      </Block>
      <hr style={hairline} />

      {/* 7 — Execution Plan (→ Recommendation) */}
      <Block title="Execution plan" testid="brief-execution-plan" note="Where to start — you can act on this without another refresh">
        {v.executionPlan.map((phase, pi) => (
          <div key={pi} style={{ marginBottom: 22 }}>
            <p style={{ font: '600 12px/1.4 var(--sans, Inter)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3, #8a8275)', margin: '0 0 10px' }}>{phase.label}</p>
            <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
              {[...phase.actions].sort((a, b) => a.sequence - b.sequence).map((a, ai) => {
                const ref = `a${pi + 1}.${ai + 1}`;
                const recs = P?.actionRecs[ref] ?? [];
                return (
                  <li key={ai} id={anchorId(ref)} style={{ margin: '0 0 16px', scrollMarginTop: 16 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                      <span style={pill}>{ref}</span>
                      <p style={{ ...bodyText, margin: 0 }}>{a.statement}</p>
                    </div>
                    {P ? <div style={{ paddingLeft: 44 }}>
                      <Provenance label={`Advances recommendation (${recs.length})`} refs={recs} />
                    </div> : null}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </Block>

      <p style={{ font: '400 11px/1.4 var(--sans, Inter)', color: 'var(--faint, #b8b0a1)', margin: '40px 0 0' }}>
        Version {v.versionId}
      </p>
    </div>
  );
}

export function LivingBrief({ version, provenance, provenanceNote }: {
  version: BBCurrentVersion;
  provenance?: ResolvedProvenance;
  provenanceNote?: string;
}) {
  return (
    <main style={page} data-testid="living-brief" data-version-id={version.versionId} aria-label="Your Business Brief">
      <h1 style={srOnly}>Your Business Brief — current version</h1>
      <RecordStrip v={version} />
      <Lede v={version} />
      <DecisionPreview />
      <hr style={{ ...hairline, margin: '48px 0 44px' }} />
      {provenanceNote ? (
        <p data-testid="provenance-note" style={{
          font: '400 13px/1.55 var(--sans, Inter)', color: 'var(--ink-3, #8a8275)',
          background: 'var(--paper-2, #f1ece3)', border: '1px solid var(--line, #e2dccf)',
          borderRadius: 6, padding: '10px 14px', margin: '0 0 28px',
        }}>{provenanceNote}</p>
      ) : null}
      <ReasonedBrief v={version} provenance={provenance} />
    </main>
  );
}
