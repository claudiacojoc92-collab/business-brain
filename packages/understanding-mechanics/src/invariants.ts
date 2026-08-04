/**
 * R1 invariant validator. Takes BOTH the original input and the produced result
 * so it can prove input-to-output relationships without any raw input being
 * copied into the result. Returns structured passed/violations lists; it never
 * throws (the caller decides whether a violation is fatal).
 */
import {
  CandidateSignal,
  CausalOriginRef,
  OfferEvaluationInput,
  OfferEvaluationResult,
  SourceEvidenceRef,
} from './model';

function refKey(r: SourceEvidenceRef): string {
  return JSON.stringify([r.sourceContext, r.sourceType, r.sourceId]);
}
function originKey(o: CausalOriginRef): string {
  return JSON.stringify([o.context, o.key]);
}

/** Distinct causal origins among VALID signals, in first-appearance order. */
function distinctValidOrigins(signals: readonly CandidateSignal[]): CausalOriginRef[] {
  const seen = new Set<string>();
  const out: CausalOriginRef[] = [];
  for (const s of signals) {
    if (!s.valid) continue;
    const k = originKey(s.causalOrigin);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s.causalOrigin);
  }
  return out;
}

export function verifyR1Invariants(
  input: OfferEvaluationInput,
  result: OfferEvaluationResult,
): { passed: readonly string[]; violations: readonly string[] } {
  const passed: string[] = [];
  const violations: string[] = [];
  const check = (name: string, ok: boolean): void => {
    (ok ? passed : violations).push(name);
  };

  const validSignals = input.signals.filter((s) => s.valid);
  const validRefKeys = new Set(validSignals.map((s) => refKey(s.ref)));
  input.currentHeldStance.basis.forEach((r) => validRefKeys.add(refKey(r)));
  const eligibleRefKeys = new Set(
    input.signals.filter((s) => s.valid && s.noticeEligible).map((s) => refKey(s.ref)),
  );
  const expectedStreams = distinctValidOrigins(input.signals);
  const expectedOriginKeys = new Set(expectedStreams.map(originKey));

  // 1. Notice pass must be grounded in ≥1 valid + noticeEligible input signal.
  check(
    'notice_pass_grounded_in_valid_eligible_signal',
    result.notice.outcome !== 'pass' || input.signals.some((s) => s.valid && s.noticeEligible),
  );

  // 2. Notice basis contains only valid + noticeEligible signal refs (invalid/non-eligible never ground it).
  check(
    'notice_basis_only_valid_eligible',
    result.notice.basis.every((r) => eligibleRefKeys.has(refKey(r))),
  );

  // 3. context_required is grounded in unknown founder constraints (golden case); test is never permitted.
  check(
    'context_required_grounded_in_unknown_constraints',
    result.entitlement.audienceTestPermitted === false &&
      (input.founderConstraints.known === true || result.entitlement.state === 'context_required'),
  );

  // 4. Output held stance equals input held stance (value equality; unchanged).
  check(
    'held_stance_unchanged',
    JSON.stringify(result.currentHeldStance) === JSON.stringify(input.currentHeldStance),
  );

  // 5. Watched Hypothesis is separate and derived only from valid signals.
  check(
    'hypothesis_separate_and_valid_only',
    result.activeHypothesis.raisedFrom.every((r) => validRefKeys.has(refKey(r))) &&
      result.activeHypothesis.statement !== input.currentHeldStance.statement &&
      result.activeHypothesis.raisedFrom.every((r) =>
        validSignals.some((s) => refKey(s.ref) === refKey(r)),
      ),
  );

  // 6. observability.causalStreams == distinct valid input origins, in order; streamCount matches.
  const gotStreams = result.observability.causalStreams;
  check(
    'causal_streams_equal_distinct_valid_origins_in_order',
    gotStreams.length === expectedStreams.length &&
      expectedStreams.every((e, i) => {
        const g = gotStreams[i];
        return !!g && g.context === e.context && g.key === e.key;
      }),
  );
  check('stream_count_equals_causal_streams_length', result.observability.streamCount === gotStreams.length);

  // 7. History sourceRefs and causalStreams correspond to the evaluated input.
  const last = result.history[result.history.length - 1];
  check(
    'history_source_refs_correspond_to_input',
    !!last && last.sourceRefs.every((r) => validRefKeys.has(refKey(r))),
  );
  check(
    'history_causal_streams_correspond_to_input',
    !!last && last.causalStreams.every((c) => expectedOriginKeys.has(originKey(c))),
  );

  // 8. Move gates preserve the ACTUAL Notice / Entitlement outcomes.
  check(
    'move_gates_preserve_actual_results',
    result.move.gates.notice === result.notice.outcome &&
      result.move.gates.entitlement === result.entitlement.state,
  );

  // 9. No `moved` (or any non-no_move) outcome — catches an unsafe-cast malformed result.
  check('no_moved_outcome', (result.move.outcome as string) === 'no_move');

  // 10. No diagnosis / current-truth placeholder leaked into the R1 output.
  const forbiddenKeys = ['latestDiagnosisVersionRef', 'currentDiagnosis', 'currentUnderstanding', 'currentTruth'];
  check(
    'no_diagnosis_or_current_truth_placeholder',
    forbiddenKeys.every((k) => !(k in (result as unknown as Record<string, unknown>))),
  );

  // 11. No numeric confidence anywhere in the structured result.
  check('no_numeric_confidence', !JSON.stringify(result).toLowerCase().includes('confidence'));

  return { passed: Object.freeze(passed), violations: Object.freeze(violations) };
}
