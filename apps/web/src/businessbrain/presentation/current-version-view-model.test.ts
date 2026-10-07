import { describe, it, expect } from 'vitest';
import type { BBCurrent, BBCurrentVersion, BBTraceability } from '../../api/client';
import {
  projectCurrentVersionReturn,
  projectCurrentVersionDeep,
  PresentationProjectionError,
} from './current-version-view-model';

// Inline, typed fixtures (NOT the untracked Living Brief fixtures). Deliberately synthetic.
function alignedTraceability(): BBTraceability {
  return {
    evidence: [{ ref: 'e1.1', claimIndex: 0, measureIndex: 0 }],
    rootCauses: [{ ref: 'rc1', evidenceRefs: ['e1.1'] }],
    recommendations: [{ ref: 'rec1', rootCauseRefs: ['rc1'] }],
    actions: [{ ref: 'a1.1', phaseIndex: 0, actionIndex: 0, recommendationRefs: ['rec1'] }],
  };
}
function mkVersion(over: Partial<BBCurrentVersion> = {}): BBCurrentVersion {
  return {
    versionId: 'v-123',
    producedAt: '2026-08-07T10:00:00Z',
    importWindow: { from: '2026-07-01', to: '2026-07-31', postCount: 40 },
    businessReality: 'Your process content draws unusual attention.',
    businessConsequences: ['Attention is not yet converting.'],
    evidence: { claims: [{ claimStatement: 'Process posts outperform the work.', measures: [{ descriptor: 'saves', kind: 'presence', value: 401 }] }] },
    cannotYetKnow: 'Whether a smaller offer would sell — it has never been offered.',
    rootCauses: ['No smaller route exists to convert warm attention.'],
    recommendations: ['Consider a small, reversible way to test intent.'],
    executionPlan: [{ label: 'Explore', actions: [{ statement: 'Ask the warm audience a bounded question.', sequence: 1 }] }],
    traceability: alignedTraceability(),
    ...over,
  };
}
const noCurrent: BBCurrent = { state: 'no_current_version' };

describe('R0 current-version presentation adapter', () => {
  it('1. a complete version produces ONE deterministic present projection', () => {
    const r = projectCurrentVersionReturn(mkVersion());
    expect(r.kind).toBe('current_version_return');
    expect(r.status).toBe('present');
    if (r.status !== 'present') throw new Error('unreachable');
    expect(r.versionId).toBe('v-123');
    expect(r.readiness).toBe('current_version_present');
    const d = projectCurrentVersionDeep(mkVersion());
    expect(d.status).toBe('present');
    if (d.status !== 'present') throw new Error('unreachable');
    expect(d.sections.map((s) => s.id)).toEqual([
      'business_reality', 'business_consequences', 'evidence', 'cannot_yet_know', 'root_causes', 'recommendations', 'execution_plan',
    ]);
    expect(d.sections.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('2. missing traceability is EXPLICITLY unavailable, not silently omitted', () => {
    const r = projectCurrentVersionReturn(mkVersion({ traceability: undefined }));
    if (r.status !== 'present') throw new Error('unreachable');
    expect(r.provenance.availability).toBe('unavailable_due_to_integrity');
    expect('value' in r.provenance).toBe(false); // no null, no fake empty object
    expect(r.allowedReadOnlyInteractions).not.toContain('inspect_provenance');
  });

  it('2b. a missing OPTIONAL importWindow is not_provided (absence), never an integrity failure', () => {
    const present = projectCurrentVersionReturn(mkVersion());
    if (present.status !== 'present') throw new Error('unreachable');
    expect(present.evidenceWindow.availability).toBe('available');
    const absent = projectCurrentVersionReturn(mkVersion({ importWindow: undefined }));
    if (absent.status !== 'present') throw new Error('unreachable');
    expect(absent.evidenceWindow.availability).toBe('not_provided');
    expect(absent.evidenceWindow.availability).not.toBe('unavailable_due_to_integrity');
    expect('value' in absent.evidenceWindow).toBe(false); // no null, no fake empty value
  });

  it('2c. absence, unsupported capability, and integrity failure are THREE distinct states (no null)', () => {
    const v = mkVersion({ importWindow: undefined, traceability: undefined });
    const r = projectCurrentVersionReturn(v);
    const d = projectCurrentVersionDeep(v);
    if (r.status !== 'present' || d.status !== 'present') throw new Error('unreachable');
    const states = [
      r.evidenceWindow.availability, // absent optional          → not_provided
      r.provenance.availability, // server fail-closed omission   → unavailable_due_to_integrity
      d.transformationTrace.availability, // mechanics concept    → unsupported_by_current_model
    ];
    expect(states).toEqual(['not_provided', 'unavailable_due_to_integrity', 'unsupported_by_current_model']);
    expect(new Set(states).size).toBe(3); // structurally distinct, not conflated
    // none of the four unavailable payloads collapses to null
    expect(JSON.stringify({ r, d })).not.toContain('null');
  });

  it('3. unknown / missing information does not become a negative fact', () => {
    const v = mkVersion({ cannotYetKnow: 'Whether it would pay is unknown.' });
    const r = projectCurrentVersionReturn(v);
    if (r.status !== 'present') throw new Error('unreachable');
    expect(r.knownMissingInformation).toBe('Whether it would pay is unknown.'); // verbatim, not "no demand"
    expect(r.knownMissingInformation.toLowerCase()).not.toContain('no demand');
  });

  it('4. an auto-promoted current Version does NOT render as moved', () => {
    const r = projectCurrentVersionReturn(mkVersion());
    const d = projectCurrentVersionDeep(mkVersion());
    expect(r.movementEmphasisAllowed).toBe(false);
    expect(r.movementSemanticsAvailable).toBe(false);
    expect(r.mechanicsCapability.moveAssessment).toBe(false);
    if (d.status !== 'present') throw new Error('unreachable');
    expect(d.transformationTrace.availability).toBe('unsupported_by_current_model');
    expect(JSON.stringify({ r, d })).not.toContain('moved'); // no "moved"/"moved_before_now" anywhere
  });

  it('5. movementEmphasisAllowed is ALWAYS false in R0 (present + no-current)', () => {
    for (const c of [mkVersion(), noCurrent]) {
      expect(projectCurrentVersionReturn(c).movementEmphasisAllowed).toBe(false);
      expect(projectCurrentVersionDeep(c).movementEmphasisAllowed).toBe(false);
    }
  });

  it('6. no before→now trace is produced', () => {
    const d = projectCurrentVersionDeep(mkVersion());
    if (d.status !== 'present') throw new Error('unreachable');
    expect(d.transformationTrace).toEqual({ availability: 'unsupported_by_current_model' });
    expect(d.unsupportedChapters.some((c) => c.id === 'transformation_trace')).toBe(true);
  });

  it('7. no watched hypothesis is fabricated from tentative narrative wording', () => {
    const tentative = mkVersion({ businessReality: 'There may appear to be tentative emerging demand, perhaps.' });
    const d = projectCurrentVersionDeep(tentative);
    if (d.status !== 'present') throw new Error('unreachable');
    expect(d.watchedHypothesis.availability).toBe('unsupported_by_current_model');
    expect(d.mechanicsCapability.separateHypothesis).toBe(false);
  });

  it('8. raw narrative changes do NOT change structured capability/status fields', () => {
    const a = projectCurrentVersionDeep(mkVersion({ businessReality: 'Prose A.' }));
    const b = projectCurrentVersionDeep(mkVersion({ businessReality: 'COMPLETELY DIFFERENT PROSE B, longer.' }));
    if (a.status !== 'present' || b.status !== 'present') throw new Error('unreachable');
    expect(a.mechanicsCapability).toEqual(b.mechanicsCapability);
    expect(a.status).toBe(b.status);
    expect(a.movementEmphasisAllowed).toBe(b.movementEmphasisAllowed);
    expect(a.sections.map((s) => `${s.id}:${s.order}:${s.present}`)).toEqual(b.sections.map((s) => `${s.id}:${s.order}:${s.present}`));
    expect(a.transformationTrace).toEqual(b.transformationTrace);
  });

  it('9. numeric measure/confidence values are not consumed into status/capability', () => {
    const withBigNumber = mkVersion({ evidence: { claims: [{ claimStatement: 'x', measures: [{ descriptor: 'saves', kind: 'presence', value: 999999 }] }] } });
    const d = projectCurrentVersionDeep(withBigNumber);
    const blob = JSON.stringify(d);
    expect(blob).not.toContain('confidence');
    expect(blob).not.toContain('999999'); // the numeric measure never reaches the projection
  });

  it('10. projection output is byte-identical on repeated evaluation', () => {
    expect(JSON.stringify(projectCurrentVersionReturn(mkVersion()))).toBe(JSON.stringify(projectCurrentVersionReturn(mkVersion())));
    expect(JSON.stringify(projectCurrentVersionDeep(mkVersion()))).toBe(JSON.stringify(projectCurrentVersionDeep(mkVersion())));
    expect(JSON.stringify(projectCurrentVersionReturn(noCurrent))).toBe(JSON.stringify(projectCurrentVersionReturn(noCurrent)));
  });

  it('11. unsupported mechanics are represented explicitly (machine-readable)', () => {
    const d = projectCurrentVersionDeep(mkVersion());
    expect(d.unsupportedChapters.map((c) => c.id).sort()).toEqual(['founder_response_decisions', 'review', 'transformation_trace', 'watched_hypothesis']);
    expect(d.mechanicsCapability).toEqual({
      currentVersionProjection: true, heldUnderstanding: false, separateHypothesis: false,
      moveAssessment: false, founderOverlay: false, conflictLifecycle: false, acceptedInferenceLineage: false,
    });
  });

  it('12. structurally impossible input fails EXPLICITLY (never silently renders)', () => {
    // traceability node-array misaligned with the version arrays
    const misaligned = mkVersion({ rootCauses: ['a', 'b'] }); // 2 root causes, traceability has 1
    expect(() => projectCurrentVersionReturn(misaligned)).toThrow(PresentationProjectionError);
    expect(() => projectCurrentVersionDeep(misaligned)).toThrow(PresentationProjectionError);
    // missing versionId
    const noId = mkVersion({ versionId: '' });
    expect(() => projectCurrentVersionReturn(noId)).toThrow(PresentationProjectionError);
  });

  it('no_current_version projects an explicit, mechanics-absent state', () => {
    const r = projectCurrentVersionReturn(noCurrent);
    expect(r.status).toBe('no_current_version');
    expect(r.readiness).toBe('no_current_version');
    expect(r.allowedReadOnlyInteractions).toEqual([]);
    const d = projectCurrentVersionDeep(noCurrent);
    expect(d.status).toBe('no_current_version');
    expect(d.unsupportedChapters.length).toBe(4);
  });
});
