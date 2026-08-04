/**
 * R1 Offer mechanics — the pure, deterministic assessment functions and the
 * single public entry point `evaluateOfferMechanics`.
 *
 * No clock, no randomness, no global state, no I/O. Timestamps and sequence
 * numbers arrive on the input. A promoted diagnosis Version is NEVER consumed
 * here — signals arrive as opaque candidate records, and the only R1 outcome is
 * `no_move`. Move is an assessment, not a command: it is total and never throws.
 */
import {
  CandidateSignal,
  CausalOriginRef,
  ClaimProximity,
  CurrentHeldStance,
  EntitlementAssessment,
  FounderConstraints,
  MechanicsHistoryEvent,
  MechanicsInvariantViolation,
  MoveAssessment,
  NoticeAssessment,
  ObservabilityAssessment,
  OfferAssessmentTrace,
  OfferEvaluationInput,
  OfferEvaluationResult,
  ObservabilityCategory,
  OfferExistence,
  SourceEvidenceRef,
  WatchedHypothesis,
  deepFreeze,
} from './model';
import { appendMechanicsHistory } from './history';
import { verifyR1Invariants } from './invariants';

function originKey(o: CausalOriginRef): string {
  return o.context + ' ' + o.key;
}
function refKey(r: SourceEvidenceRef): string {
  return r.sourceContext + ' ' + r.sourceType + ' ' + r.sourceId;
}

/** Distinct causal origins among VALID signals, first-appearance order (private grouping). */
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

/**
 * Observability: category derives ONLY from offer existence; causal streams are
 * distinct origins among VALID signals (noticeEligible never affects grouping —
 * observability is orthogonal to Notice).
 */
export function classifyOfferObservability(
  signals: readonly CandidateSignal[],
  offerExists: OfferExistence,
): ObservabilityAssessment {
  const causalStreams = distinctValidOrigins(signals);
  const category: ObservabilityCategory = offerExists.known ? 'proposition_absent' : 'information_insufficient';
  const basis = signals.filter((s) => s.valid).map((s) => s.ref);
  return { category, streamCount: causalStreams.length, causalStreams, offerExists, basis };
}

/**
 * Notice — R1-MINIMUM RULE ONLY: pass iff at least one signal is `valid && noticeEligible`.
 * This is NOT the future universal Notice threshold; there is no quality/confidence scoring,
 * and observability category is deliberately not read here.
 */
export function assessOfferNotice(signals: readonly CandidateSignal[]): NoticeAssessment {
  const qualifying = signals.filter((s) => s.valid && s.noticeEligible);
  if (qualifying.length > 0) {
    return {
      outcome: 'pass',
      reason: 'at least one valid, notice-eligible signal (R1-minimum rule; not the universal threshold)',
      basis: qualifying.map((s) => s.ref),
    };
  }
  return { outcome: 'no_valid_signal', reason: 'no valid, notice-eligible signal present', basis: [] };
}

/**
 * Entitlement — decided ONLY from founder constraints (not observability, not the held stance).
 * Unknown constraints → context_required; audience testing is never permitted in R1.
 */
export function assessOfferEntitlement(founderConstraints: FounderConstraints): EntitlementAssessment {
  const reason = founderConstraints.known
    ? 'founder constraints known; audience-test entitlement resolution is not modeled in R1 (conservative context_required)'
    : 'founder constraints unknown — test context must be gathered before any audience test';
  return { state: 'context_required', audienceTestPermitted: false, reason };
}

/**
 * Move — total and NON-THROWING. R1 can only produce `no_move`; gates record the
 * actual Notice / Entitlement outcomes. attention/interest proximity alone can
 * never authorise a Move, and `moved` is unrepresentable in the public union.
 */
export function assessOfferMove(
  observability: ObservabilityAssessment,
  notice: NoticeAssessment,
  entitlement: EntitlementAssessment,
): MoveAssessment {
  const reasons: readonly string[] = [
    `observability=${observability.category}`,
    `notice=${notice.outcome}`,
    `entitlement=${entitlement.state}`,
    'attention/interest proximity alone can never authorise a Move',
  ];
  return {
    outcome: 'no_move',
    proposedStatement: null,
    gates: { notice: notice.outcome, entitlement: entitlement.state },
    reasons,
  };
}

/**
 * Watched Hypothesis — derived from VALID signals only, kept separate from the
 * held stance (never copies its statement). Rejects a zero-valid-signal call.
 */
export function buildWatchedHypothesis(
  signals: readonly CandidateSignal[],
  currentHeldStance: CurrentHeldStance,
): WatchedHypothesis {
  const valid = signals.filter((s) => s.valid);
  if (valid.length === 0) {
    throw new MechanicsInvariantViolation('cannot build a WatchedHypothesis without at least one valid signal');
  }
  const proximityCeiling: ClaimProximity = valid.some((s) => s.proximity === 'interest') ? 'interest' : 'attention';
  return {
    statement:
      `Watching whether observed ${proximityCeiling} converts into a held offer proposition — ` +
      `distinct from, and not yet, the current held stance (${currentHeldStance.stanceId}).`,
    raisedFrom: valid.map((s) => s.ref),
    proximityCeiling,
    state: 'watching',
  };
}

function dedupeRefs(refs: readonly SourceEvidenceRef[]): SourceEvidenceRef[] {
  const seen = new Set<string>();
  const out: SourceEvidenceRef[] = [];
  for (const r of refs) {
    const k = refKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * Public R1 boundary. Requires at least one VALID signal, else rejects with
 * MechanicsInvariantViolation BEFORE producing any result or hypothesis.
 * Runs the invariant validator defensively over (input, result) and throws if
 * its own output violates an invariant. Returns a deeply-frozen result.
 */
export function evaluateOfferMechanics(input: OfferEvaluationInput): OfferEvaluationResult {
  const validCount = input.signals.filter((s) => s.valid).length;
  if (validCount === 0) {
    throw new MechanicsInvariantViolation('evaluateOfferMechanics requires at least one valid CandidateSignal');
  }

  const observability = classifyOfferObservability(input.signals, input.offerExists);
  const notice = assessOfferNotice(input.signals);
  const entitlement = assessOfferEntitlement(input.founderConstraints);
  const move = assessOfferMove(observability, notice, entitlement);
  const activeHypothesis = buildWatchedHypothesis(input.signals, input.currentHeldStance);

  const trace: OfferAssessmentTrace = { observability, notice, entitlement, move };
  const sourceRefs = dedupeRefs([
    ...input.currentHeldStance.basis,
    ...input.signals.filter((s) => s.valid).map((s) => s.ref),
  ]);
  const event: MechanicsHistoryEvent = {
    seq: input.nextSeq,
    type: 'offer_evaluated',
    occurredAt: input.occurredAt,
    sourceRefs,
    causalStreams: observability.causalStreams,
    ruleApplied: 'offer.r1.v1',
    output: trace,
  };
  const history = appendMechanicsHistory(input.priorHistory, event);

  const result: OfferEvaluationResult = {
    currentHeldStance: input.currentHeldStance, // unchanged
    activeHypothesis,
    observability,
    notice,
    entitlement,
    move,
    history,
  };

  const selfCheck = verifyR1Invariants(input, result);
  if (selfCheck.violations.length > 0) {
    throw new MechanicsInvariantViolation('self-check failed: ' + selfCheck.violations.join('; '));
  }

  return deepFreeze(result);
}
