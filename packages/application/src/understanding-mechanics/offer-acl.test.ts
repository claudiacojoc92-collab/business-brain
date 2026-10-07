import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  evaluateOfferMechanics,
  makeCausalOriginRef,
  makeSourceEvidenceRef,
  MechanicsInvariantViolation,
} from '@bb/understanding-mechanics';
import type { PublicCurrentVersion } from '../businessbrain/domain/model';
import { buildOfferEvaluationInput, resolveOfferSignalEvidence } from './offer-acl';
import type { BuildOfferEvaluationInputParams, OfferSignalInput } from './offer-context';

// ---- synthetic fixtures (NOT founder content) ----
function version(over: Partial<PublicCurrentVersion> = {}): PublicCurrentVersion {
  return {
    versionId: 'v-1',
    producedAt: '2026-08-03T00:00:00.000Z',
    importWindow: { from: '2026-07-01', to: '2026-07-31', postCount: 40 },
    businessReality: 'Prose A.',
    businessConsequences: ['Consequence A.'],
    evidence: {
      claims: [
        {
          claimStatement: 'Claim A',
          measures: [
            { descriptor: 'saves', kind: 'presence', value: 401 },
            { descriptor: 'reach', kind: 'count', value: 1000 },
          ],
        },
      ],
    },
    cannotYetKnow: 'Unknown A.',
    rootCauses: ['Root cause A.'],
    recommendations: ['Recommendation A.'],
    executionPlan: [{ label: 'Explore', actions: [{ statement: 'Do A', sequence: 1 }] }],
    traceability: {
      evidence: [
        { ref: 'e1.1', claimIndex: 0, measureIndex: 0 },
        { ref: 'e1.2', claimIndex: 0, measureIndex: 1 },
      ],
      rootCauses: [{ ref: 'rc1', evidenceRefs: ['e1.1'] }],
      recommendations: [{ ref: 'rec1', rootCauseRefs: ['rc1'] }],
      actions: [{ ref: 'a1.1', phaseIndex: 0, actionIndex: 0, recommendationRefs: ['rec1'] }],
    },
    ...over,
  };
}

function attention(ref = 'e1.1'): OfferSignalInput {
  return {
    evidencePublicRef: ref,
    proximity: 'attention',
    valid: true,
    noticeEligible: true,
    causalOrigin: makeCausalOriginRef('channel_format', 'process-reels'),
    observedAt: '2026-08-02T00:00:00.000Z',
  };
}
function interest(ref = 'e1.2'): OfferSignalInput {
  return {
    evidencePublicRef: ref,
    proximity: 'interest',
    valid: true,
    noticeEligible: true,
    causalOrigin: makeCausalOriginRef('event', 'saves-spike'),
    observedAt: '2026-08-02T00:00:00.000Z',
  };
}

function params(over: Partial<BuildOfferEvaluationInputParams> = {}): BuildOfferEvaluationInputParams {
  return {
    currentVersion: version(),
    offerContext: { signals: [attention(), interest()], offerExistence: { known: true, value: false } },
    founderConstraints: { known: false },
    currentHeldStance: {
      stanceId: 'stance-1',
      statement: 'The business earns attention but has no offer route.',
      heldSince: '2026-08-01T00:00:00.000Z',
      basis: [makeSourceEvidenceRef('businessbrain', 'diagnosis_version', 'v-1')],
    },
    priorHistory: [],
    occurredAt: '2026-08-03T12:00:00.000Z',
    nextSeq: 1,
    ...over,
  };
}

describe('R2-A — Version→Offer mechanics adapter', () => {
  it('1. valid traceability refs produce ready', () => {
    const r = buildOfferEvaluationInput(params());
    expect(r.status).toBe('ready');
  });

  it('2. CandidateSignal.ref is exactly the minted diagnosis_evidence_measure ref', () => {
    const r = buildOfferEvaluationInput(params());
    if (r.status !== 'ready') throw new Error('unreachable');
    expect(r.input.signals[0]!.ref).toEqual({
      sourceContext: 'businessbrain',
      sourceType: 'diagnosis_evidence_measure',
      sourceId: 'v-1::e1.1',
    });
    expect(r.input.signals[1]!.ref.sourceId).toBe('v-1::e1.2');
  });

  it('3. omitted traceability → provenance_unavailable_due_to_integrity', () => {
    const r = buildOfferEvaluationInput(params({ currentVersion: version({ traceability: undefined }) }));
    expect(r.status).toBe('provenance_unavailable_due_to_integrity');
  });

  it('4. unknown public ref → invalid_evidence_reference', () => {
    const r = buildOfferEvaluationInput(params({ offerContext: { signals: [attention('e9.9')], offerExistence: { known: false } } }));
    expect(r).toEqual({ status: 'invalid_evidence_reference', refs: ['e9.9'] });
  });

  it('5. dangling claimIndex → invalid_evidence_reference', () => {
    const v = version({
      traceability: {
        evidence: [{ ref: 'e5.1', claimIndex: 5, measureIndex: 0 }],
        rootCauses: [{ ref: 'rc1', evidenceRefs: [] }],
        recommendations: [{ ref: 'rec1', rootCauseRefs: [] }],
        actions: [{ ref: 'a1.1', phaseIndex: 0, actionIndex: 0, recommendationRefs: [] }],
      },
    });
    const r = buildOfferEvaluationInput(params({ currentVersion: v, offerContext: { signals: [attention('e5.1')], offerExistence: { known: false } } }));
    expect(r).toEqual({ status: 'invalid_evidence_reference', refs: ['e5.1'] });
  });

  it('6. dangling measureIndex → invalid_evidence_reference', () => {
    const v = version({
      traceability: {
        evidence: [{ ref: 'e1.9', claimIndex: 0, measureIndex: 9 }],
        rootCauses: [{ ref: 'rc1', evidenceRefs: [] }],
        recommendations: [{ ref: 'rec1', rootCauseRefs: [] }],
        actions: [{ ref: 'a1.1', phaseIndex: 0, actionIndex: 0, recommendationRefs: [] }],
      },
    });
    const r = buildOfferEvaluationInput(params({ currentVersion: v, offerContext: { signals: [attention('e1.9')], offerExistence: { known: false } } }));
    expect(r).toEqual({ status: 'invalid_evidence_reference', refs: ['e1.9'] });
  });

  it('7. duplicate invalid refs are reported once, in first-appearance order', () => {
    const r = resolveOfferSignalEvidence(version(), ['e9.9', 'e8.8', 'e9.9', 'e8.8']);
    expect(r).toEqual({ status: 'invalid_evidence_reference', refs: ['e9.9', 'e8.8'] });
  });

  it('8. empty signals → incomplete_context ["signals"]', () => {
    const r = buildOfferEvaluationInput(params({ offerContext: { signals: [], offerExistence: { known: false } } }));
    expect(r).toEqual({ status: 'incomplete_context', missing: ['signals'] });
  });

  it('9. non-empty all-invalid signals → incomplete_context ["valid_signals"]', () => {
    const r = buildOfferEvaluationInput(
      params({ offerContext: { signals: [{ ...attention(), valid: false }], offerExistence: { known: false } } }),
    );
    expect(r).toEqual({ status: 'incomplete_context', missing: ['valid_signals'] });
  });

  it('10. explicit present offer → unsupported_mechanics_input', () => {
    const r = buildOfferEvaluationInput(params({ offerContext: { signals: [attention()], offerExistence: { known: true, value: true } } }));
    expect(r).toEqual({ status: 'unsupported_mechanics_input', feature: 'offer_present' });
  });

  it('11. founderConstraints {known:false} remains a ready input', () => {
    const r = buildOfferEvaluationInput(params({ founderConstraints: { known: false } }));
    if (r.status !== 'ready') throw new Error('unreachable');
    expect(r.input.founderConstraints).toEqual({ known: false });
  });

  it('12. offerExistence {known:false} remains a ready input (unknown preserved)', () => {
    const r = buildOfferEvaluationInput(params({ offerContext: { signals: [attention()], offerExistence: { known: false } } }));
    if (r.status !== 'ready') throw new Error('unreachable');
    expect(r.input.offerExists).toEqual({ known: false });
  });

  it('13. changing diagnosis prose leaves adapter output byte-identical', () => {
    const base = JSON.stringify(buildOfferEvaluationInput(params()));
    const mutated = JSON.stringify(
      buildOfferEvaluationInput(
        params({
          currentVersion: version({
            businessReality: 'COMPLETELY DIFFERENT PROSE.',
            rootCauses: ['Different root cause.'],
            recommendations: ['Different recommendation.'],
            executionPlan: [{ label: 'Different', actions: [{ statement: 'Different action', sequence: 1 }] }],
          }),
        }),
      ),
    );
    expect(mutated).toBe(base);
  });

  it('14. changing cannotYetKnow leaves output byte-identical', () => {
    const base = JSON.stringify(buildOfferEvaluationInput(params()));
    const mutated = JSON.stringify(buildOfferEvaluationInput(params({ currentVersion: version({ cannotYetKnow: 'Entirely different unknown.' }) })));
    expect(mutated).toBe(base);
  });

  it('15. changing producedAt leaves output byte-identical (promotion time is not occurredAt)', () => {
    const base = JSON.stringify(buildOfferEvaluationInput(params()));
    const mutated = JSON.stringify(buildOfferEvaluationInput(params({ currentVersion: version({ producedAt: '2099-01-01T00:00:00.000Z' }) })));
    expect(mutated).toBe(base);
  });

  it('16. a caller cannot inject a SourceEvidenceRef through OfferSignalInput (ref is always minted)', () => {
    // OfferSignalInput has no `ref` field (compile-time); at runtime the ref is derived from versionId::token.
    const r = buildOfferEvaluationInput(params());
    if (r.status !== 'ready') throw new Error('unreachable');
    for (const s of r.input.signals) {
      expect(s.ref.sourceContext).toBe('businessbrain');
      expect(s.ref.sourceType).toBe('diagnosis_evidence_measure');
      expect(s.ref.sourceId.startsWith('v-1::')).toBe(true);
    }
  });

  it('17. identical params produce byte-identical results', () => {
    expect(JSON.stringify(buildOfferEvaluationInput(params()))).toBe(JSON.stringify(buildOfferEvaluationInput(params())));
  });

  it('18. a ready input round-trips through the real R1 kernel (no_move, held unchanged, context_required)', () => {
    const r = buildOfferEvaluationInput(params());
    if (r.status !== 'ready') throw new Error('unreachable');
    const result = evaluateOfferMechanics(r.input);
    expect(result.move.outcome).toBe('no_move');
    expect(JSON.stringify(result.currentHeldStance)).toBe(JSON.stringify(r.input.currentHeldStance));
    expect(result.entitlement.state).toBe('context_required');
  });

  it('19. a non-ready result carries no OfferEvaluationInput to evaluate', () => {
    const r = buildOfferEvaluationInput(params({ offerContext: { signals: [], offerExistence: { known: false } } }));
    expect('input' in r).toBe(false);
  });

  it('malformed impossible input throws a boundary error', () => {
    expect(() => buildOfferEvaluationInput(null as unknown as BuildOfferEvaluationInputParams)).toThrow(
      MechanicsInvariantViolation,
    );
  });

  it('20. the mechanics package imports nothing from @bb/application', () => {
    let dir = process.cwd();
    let mechSrc = '';
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'packages/understanding-mechanics/src');
      if (existsSync(candidate)) {
        mechSrc = candidate;
        break;
      }
      dir = dirname(dir);
    }
    expect(mechSrc).not.toBe('');
    const scan = (d: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) out.push(...scan(full));
        else if (entry.name.endsWith('.ts')) out.push(full);
      }
      return out;
    };
    const offenders = scan(mechSrc)
      .filter((f) => !f.endsWith('.test.ts')) // test files legitimately enumerate the banned token
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return src.includes("'@bb/application'") || src.includes('"@bb/application"');
      });
    expect(offenders).toEqual([]);
  });
});
