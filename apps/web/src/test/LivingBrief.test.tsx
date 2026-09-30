import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { LivingBrief } from '../businessbrain/brief/LivingBrief';
import { resolveProvenance, classifyBriefState } from '../businessbrain/brief/traceability';
import {
  fullVersion, versionNoTraceability, versionBrokenTraceability, insufficientVersion, noCurrent,
} from '../businessbrain/brief/fixtures';

afterEach(cleanup);

const SECTION_ORDER = [
  'brief-current-reality', 'brief-why-matters', 'brief-evidence', 'brief-cannot-know',
  'brief-root-causes', 'brief-recommendations', 'brief-execution-plan',
];
const occurrences = (s: string, sub: string) => s.split(sub).length - 1;

describe('resolveProvenance (client-side, fail-closed)', () => {
  it('resolves a complete graph — every edge maps to real statements/measures', () => {
    const p = resolveProvenance(fullVersion)!;
    expect(p.ok).toBe(true);
    expect(p.rootCauseEvidence['rc1'].map((e) => e.ref)).toEqual(['e1.1', 'e1.2']);
    expect(p.recRootCauses['rec2'].map((r) => r.ref)).toEqual(['rc2', 'rc1']); // multi-edge, order preserved
    expect(p.actionRecs['a2.1'].map((r) => r.ref)).toEqual(['rec3', 'rec1']); // multi-edge
    // every resolved statement is a real Version statement (no invented text)
    p.recRootCauses['rec2'].forEach((r) => expect(fullVersion.rootCauses).toContain(r.statement));
  });

  it('returns null when the traceability field is absent', () => {
    expect(resolveProvenance(versionNoTraceability)).toBeNull();
  });

  it('fails closed (ok:false, no partial graph) when a ref does not resolve', () => {
    const p = resolveProvenance(versionBrokenTraceability)!;
    expect(p.ok).toBe(false);
    expect(p.rootCauseEvidence).toEqual({});
  });
});

describe('classifyBriefState — the six states from GET /current alone', () => {
  it('loading / no-current / insufficient / version / no-traceability / unavailable', () => {
    expect(classifyBriefState(null).state).toBe('loading');
    expect(classifyBriefState(noCurrent).state).toBe('no-current');
    expect(classifyBriefState(insufficientVersion).state).toBe('insufficient');
    expect(classifyBriefState(fullVersion).state).toBe('version');
    expect(classifyBriefState(versionNoTraceability).state).toBe('version-no-traceability');
    expect(classifyBriefState(versionBrokenTraceability).state).toBe('traceability-unavailable');
  });
});

describe('LivingBrief — rendering', () => {
  it('renders all seven sections in the frozen order', () => {
    const { container } = render(<LivingBrief version={fullVersion} provenance={resolveProvenance(fullVersion)!} />);
    const ids = [...container.querySelectorAll('[data-testid^="brief-"]')].map((e) => e.getAttribute('data-testid'));
    expect(ids).toEqual(SECTION_ORDER);
  });

  it('renders the existing Version data correctly across the four zones', () => {
    render(<LivingBrief version={fullVersion} provenance={resolveProvenance(fullVersion)!} />);
    // Zone 1 record + Zone 2 lede
    expect(screen.getByTestId('zone-record')).toBeInTheDocument();
    expect(screen.getAllByText(fullVersion.businessReality).length).toBeGreaterThan(0); // lede + section
    // Zone 3 decision preview — labelled + non-interactive (no buttons)
    const decision = screen.getByTestId('zone-decision');
    expect(within(decision).getByText(/Decision recording comes in a later phase/i)).toBeInTheDocument();
    expect(decision.querySelectorAll('button')).toHaveLength(0);
    // Zone 4 content
    fullVersion.businessConsequences.forEach((c) => expect(screen.getByText(c)).toBeInTheDocument());
    expect(screen.getByText(fullVersion.cannotYetKnow)).toBeInTheDocument();
    // Root cause / recommendation statements appear in their section AND (correctly) inside the
    // downstream provenance disclosures that resolve to them — so assert at least one occurrence.
    fullVersion.rootCauses.forEach((rc) => expect(screen.getAllByText(rc).length).toBeGreaterThan(0));
    fullVersion.recommendations.forEach((r) => expect(screen.getAllByText(r).length).toBeGreaterThan(0));
    expect(screen.getByText(fullVersion.executionPlan[0].actions[0].statement)).toBeInTheDocument();
    expect(screen.getByText(`Version ${fullVersion.versionId}`)).toBeInTheDocument();
  });

  it('renders public traceability references and their anchors resolve within the page', () => {
    const { container } = render(<LivingBrief version={fullVersion} provenance={resolveProvenance(fullVersion)!} />);
    // provenance summaries present
    expect(screen.getByText(/Grounded in evidence \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Addresses root cause \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/Advances recommendation \(2\)/)).toBeInTheDocument();
    // every provenance link target exists in the document (no dangling anchors, no DB ids)
    const hrefs = [...container.querySelectorAll('a[href^="#bp-"]')].map((a) => a.getAttribute('href')!.slice(1));
    expect(hrefs.length).toBeGreaterThan(0);
    hrefs.forEach((id) => expect(container.querySelector(`#${id}`)).not.toBeNull());
    // no internal-looking ids leaked (only public refs like rc1/e1.1/rec1/a1.1)
    expect(container.innerHTML).not.toMatch(/itv-preview-001-rc/); // no server node ids
  });

  it('never renders diagnostic numbers outside the Evidence section', () => {
    render(<LivingBrief version={fullVersion} provenance={resolveProvenance(fullVersion)!} />);
    const evidence = screen.getByTestId('brief-evidence').textContent!;
    const whole = document.body.textContent!;
    for (const value of ['74%', '38%']) {
      expect(evidence).toContain(value);
      expect(occurrences(whole, value)).toBe(occurrences(evidence, value)); // confined to Evidence
    }
  });

  it('missing traceability does not break the Brief (all sections render, provenance omitted)', () => {
    const { container } = render(<LivingBrief version={versionNoTraceability} provenanceNote="Provenance links are not available for this version." />);
    const ids = [...container.querySelectorAll('[data-testid^="brief-"]')].map((e) => e.getAttribute('data-testid'));
    expect(ids).toEqual(SECTION_ORDER);
    expect(screen.getByTestId('provenance-note')).toBeInTheDocument();
    expect(screen.queryByText(/Grounded in evidence/)).toBeNull(); // no provenance disclosures
  });

  it('mobile width: renders the full single-column Brief without error', () => {
    (window as unknown as { innerWidth: number }).innerWidth = 375;
    const { container } = render(<LivingBrief version={fullVersion} provenance={resolveProvenance(fullVersion)!} />);
    expect(screen.getByTestId('living-brief')).toBeInTheDocument();
    expect([...container.querySelectorAll('[data-testid^="brief-"]')]).toHaveLength(SECTION_ORDER.length);
    // provenance disclosures are native <details> (usable on mobile, no modal)
    expect(container.querySelectorAll('details').length).toBeGreaterThan(0);
  });
});
