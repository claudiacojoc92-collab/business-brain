/**
 * Renders one immutable Current Version in the frozen section order:
 * Reality → Consequences → Evidence → Cannot Yet Know → Root Causes →
 * Recommendations → Execution Plan. Version ID is subtle metadata only.
 * Metrics appear only inside Evidence; no internal/traceability IDs are rendered.
 */
import type { BBCurrentVersion } from '../api/client';

const card: React.CSSProperties = {
  background: 'var(--paper-2, #fff)',
  border: '1px solid var(--line, #e5e7eb)',
  borderRadius: 10,
  padding: '20px 22px',
  marginBottom: 16,
};
const kicker: React.CSSProperties = {
  font: '600 12px/1.4 var(--sans, system-ui)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #6b7280)',
  margin: '0 0 8px',
};

const caption: React.CSSProperties = {
  font: '400 12px/1.4 var(--sans, system-ui)',
  color: 'var(--faint, #9ca3af)',
  margin: '-4px 0 12px',
  fontStyle: 'italic',
};

function Section(props: { title: string; testid: string; caption?: string; children: React.ReactNode }) {
  return (
    <section style={card} data-testid={props.testid} aria-labelledby={`${props.testid}-h`}>
      <h3 id={`${props.testid}-h`} style={kicker}>{props.title}</h3>
      {props.caption ? <p style={caption}>{props.caption}</p> : null}
      {props.children}
    </section>
  );
}

/** Render an Evidence measure's value by kind — absence/presence must read as a state, not a bare label. */
function measureValue(m: { kind: string; value?: number }): React.ReactNode {
  if (m.value !== undefined) return <strong style={{ color: 'var(--ink, #111827)' }}>{` — ${m.value}%`}</strong>;
  if (m.kind === 'absence') return <span style={{ color: 'var(--ink-3, #6b7280)' }}>{' — none found'}</span>;
  return <span style={{ color: 'var(--ink-3, #6b7280)' }}>{' — present'}</span>;
}

/** Phase ②: the imported window, surfaced with the Evidence — "based on N posts from … to …". */
function windowCaption(w?: { from: string | null; to: string | null; postCount: number }): string {
  if (!w) return 'What your content actually shows';
  const fmt = (iso: string | null): string | null => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : null);
  const a = fmt(w.from);
  const b = fmt(w.to);
  const range = a && b ? (a === b ? a : `${a} – ${b}`) : '';
  return `Based on your ${w.postCount} most recent posts${range ? ` (${range})` : ''}`;
}

export function CurrentBusinessBrain({ version }: { version: BBCurrentVersion }) {
  return (
    <div data-testid="current-business-brain" data-version-id={version.versionId}>
      {/* 1. Business Reality */}
      <Section title="Current reality" testid="section-business-reality">
        <p style={{ font: '400 21px/1.5 var(--serif, Georgia)', color: 'var(--ink, #111827)', margin: 0 }}>
          {version.businessReality}
        </p>
      </Section>

      {/* 2. Business Consequences */}
      <Section title="Why this matters" testid="section-business-consequences">
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--ink-2, #374151)', font: '400 16px/1.6 var(--sans, system-ui)' }}>
          {version.businessConsequences.map((c, i) => (
            <li key={i} style={{ marginBottom: 6 }}>{c}</li>
          ))}
        </ul>
      </Section>

      {/* 3. Evidence — the only section with measures */}
      <Section title="Evidence" testid="section-evidence" caption={windowCaption(version.importWindow)}>
        {version.evidence.claims.map((claim, ci) => (
          <div key={ci} style={{ marginBottom: ci < version.evidence.claims.length - 1 ? 14 : 0 }}>
            <p style={{ font: '500 16px/1.5 var(--sans, system-ui)', color: 'var(--ink, #111827)', margin: '0 0 8px' }}>
              {claim.claimStatement}
            </p>
            <ul data-testid="evidence-measures" style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-2, #374151)', font: '400 15px/1.6 var(--sans, system-ui)' }}>
              {claim.measures.map((m, mi) => (
                <li key={mi}>
                  {m.descriptor}
                  {measureValue(m)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>

      {/* 4. Cannot Yet Know — visibly distinct from confirmed claims */}
      <Section title="What we cannot yet know" testid="section-cannot-yet-know">
        <p style={{
          margin: 0, font: '400 15px/1.6 var(--sans, system-ui)', color: 'var(--warn-ink, #92400e)',
          background: 'var(--warn-bg, #fffbeb)', border: '1px solid var(--warn-line, #fde68a)',
          borderRadius: 8, padding: '12px 14px',
        }}>
          {version.cannotYetKnow}
        </p>
      </Section>

      {/* 5. Root Causes */}
      <Section title="Root causes" testid="section-root-causes" caption="Our interpretation — likely reasons, not certainties">
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--ink-2, #374151)', font: '400 16px/1.6 var(--sans, system-ui)' }}>
          {version.rootCauses.map((rc, i) => <li key={i} style={{ marginBottom: 6 }}>{rc}</li>)}
        </ul>
      </Section>

      {/* 6. Recommendations */}
      <Section title="Recommendations" testid="section-recommendations">
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--ink-2, #374151)', font: '400 16px/1.6 var(--sans, system-ui)' }}>
          {version.recommendations.map((r, i) => <li key={i} style={{ marginBottom: 6 }}>{r}</li>)}
        </ul>
      </Section>

      {/* 7. Execution Plan — actions in public one-based order */}
      <Section title="Execution plan" testid="section-execution-plan" caption="Where to start — you can act on this without another refresh">
        {version.executionPlan.map((phase, pi) => (
          <div key={pi} style={{ marginBottom: 12 }}>
            <p style={{ font: '600 14px/1.4 var(--sans, system-ui)', color: 'var(--ink, #111827)', margin: '0 0 6px' }}>
              {phase.label}
            </p>
            <ol style={{ margin: 0, paddingLeft: 22, color: 'var(--ink-2, #374151)', font: '400 15px/1.6 var(--sans, system-ui)' }}>
              {[...phase.actions].sort((a, b) => a.sequence - b.sequence).map((a) => (
                <li key={a.sequence} value={a.sequence}>{a.statement}</li>
              ))}
            </ol>
          </div>
        ))}
      </Section>

      <p style={{ font: '400 11px/1.4 var(--sans, system-ui)', color: 'var(--faint, #9ca3af)', margin: '4px 2px 0' }}>
        Version {version.versionId}
      </p>
    </div>
  );
}
