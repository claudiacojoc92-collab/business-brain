import { describe, it, expect } from 'vitest';
import { evaluateOfferMechanics } from './evaluate-offer';
import { appendMechanicsHistory } from './history';
import { verifyR1Invariants } from './invariants';
import {
  MechanicsInvariantViolation,
  makeCausalOriginRef,
  makeSourceEvidenceRef,
  type MoveAssessment,
  type OfferEvaluationResult,
} from './model';
import { fixtureF0 } from './fixtures/offer.fixtures';

describe('R1 invariants — validator', () => {
  it('golden result passes every invariant', () => {
    const input = fixtureF0();
    const report = verifyR1Invariants(input, evaluateOfferMechanics(input));
    expect(report.violations).toEqual([]);
    expect(report.passed.length).toBeGreaterThanOrEqual(11);
  });

  it('R1-F3-B: an unsafe-cast malformed `moved` outcome is detected by the validator', () => {
    const input = fixtureF0();
    const good = evaluateOfferMechanics(input);
    const malformedMove = { ...good.move, outcome: 'moved' } as unknown as MoveAssessment;
    const tampered = { ...good, move: malformedMove } as OfferEvaluationResult;
    const report = verifyR1Invariants(input, tampered);
    expect(report.violations).toContain('no_moved_outcome');
  });

  it('grounding: Notice pass without valid+eligible signals is flagged', () => {
    const input = fixtureF0();
    const good = evaluateOfferMechanics(input);
    const tampered = {
      ...good,
      notice: { outcome: 'pass', reason: 'fabricated', basis: [] },
    } as OfferEvaluationResult;
    // strip the eligible signals from the input so 'pass' is unjustifiable
    const strippedInput = {
      ...input,
      signals: input.signals.map((s) => ({ ...s, noticeEligible: false })),
    };
    expect(verifyR1Invariants(strippedInput, tampered).violations).toContain(
      'notice_pass_grounded_in_valid_eligible_signal',
    );
  });
});

describe('R1 invariants — history immutability (F4)', () => {
  it('rewrite attempts on the array, event, refs, streams, and nested trace are all rejected; prior unchanged', () => {
    const r = evaluateOfferMechanics(fixtureF0());
    const before = JSON.stringify(r.history);

    // (i) array push / splice
    expect(() => (r.history as unknown as unknown[]).push({})).toThrow();
    expect(() => (r.history as unknown as unknown[]).splice(0, 1)).toThrow();
    // (ii) event field
    expect(() => {
      (r.history[0] as unknown as { seq: number }).seq = 99;
    }).toThrow();
    // (iii) SourceEvidenceRef
    expect(() => {
      (r.history[0]!.sourceRefs[0] as unknown as { sourceId: string }).sourceId = 'x';
    }).toThrow();
    // (iv) CausalOriginRef
    expect(() => {
      (r.history[0]!.causalStreams[0] as unknown as { key: string }).key = 'y';
    }).toThrow();
    // (v) nested trace object
    expect(() => {
      (r.history[0]!.output.observability as unknown as { streamCount: number }).streamCount = 5;
    }).toThrow();

    expect(JSON.stringify(r.history)).toBe(before); // byte-identical
  });

  it('appendMechanicsHistory enforces monotonic seq and never mutates the prior array', () => {
    const r = evaluateOfferMechanics(fixtureF0());
    const priorLen = r.history.length;
    const badEvent = { ...r.history[0]!, seq: 99 };
    expect(() => appendMechanicsHistory(r.history, badEvent)).toThrow(MechanicsInvariantViolation);
    expect(r.history.length).toBe(priorLen);
  });
});

describe('R1 invariants — opaque reference constructors', () => {
  it('rejects a whitespace-only SourceEvidenceRef.sourceId', () => {
    expect(() => makeSourceEvidenceRef('manual_fixture', 'observation', '   ')).toThrow(
      MechanicsInvariantViolation,
    );
  });

  it('rejects a whitespace-only CausalOriginRef.key', () => {
    expect(() => makeCausalOriginRef('manual_fixture', '  ')).toThrow(MechanicsInvariantViolation);
  });

  it('trims and freezes valid references', () => {
    const ref = makeSourceEvidenceRef('manual_fixture', 'claim', '  c-1  ');
    expect(ref.sourceId).toBe('c-1');
    expect(Object.isFrozen(ref)).toBe(true);
    const origin = makeCausalOriginRef('event', '  spike  ');
    expect(origin.key).toBe('spike');
    expect(Object.isFrozen(origin)).toBe(true);
  });
});
