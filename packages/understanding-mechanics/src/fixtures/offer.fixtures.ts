/**
 * R1 fixtures — exactly six active scenarios (F0–F5), plus typed builders for the
 * unit/invariant cases. Deliberately synthetic (NOT founder content, NOT the
 * untracked Living Brief fixtures). All references are built through the smart
 * constructors so identity validation is exercised end-to-end.
 *
 * Determinism: every timestamp and sequence number is a literal here — the kernel
 * never reads a clock.
 */
import {
  CandidateSignal,
  CurrentHeldStance,
  FounderConstraints,
  OfferEvaluationInput,
  OfferExistence,
  makeCausalOriginRef,
  makeSourceEvidenceRef,
} from '../model';

const T_STANCE = '2026-08-01T00:00:00.000Z';
const T_SIGNAL = '2026-08-02T09:00:00.000Z';
const T_EVAL = '2026-08-03T12:00:00.000Z';

export function heldStance(): CurrentHeldStance {
  return {
    stanceId: 'stance-offer-1',
    statement: 'The business earns genuine attention but has no route that converts it into a paid offer.',
    heldSince: T_STANCE,
    basis: [makeSourceEvidenceRef('businessbrain', 'diagnosis_version', 'v-diag-1')],
  };
}

export function attentionSignal(): CandidateSignal {
  return {
    ref: makeSourceEvidenceRef('businessbrain', 'evidence_fragment', 'ev-attention-1'),
    proximity: 'attention',
    causalOrigin: makeCausalOriginRef('channel_format', 'process-reels'),
    valid: true,
    noticeEligible: true,
    observedAt: T_SIGNAL,
  };
}

export function interestSignal(): CandidateSignal {
  return {
    ref: makeSourceEvidenceRef('businessbrain', 'evidence_fragment', 'ev-interest-1'),
    proximity: 'interest',
    causalOrigin: makeCausalOriginRef('event', 'saves-spike'),
    valid: true,
    noticeEligible: true,
    observedAt: T_SIGNAL,
  };
}

/** Same causal origin as {@link attentionSignal} but a distinct provenance ref (F2). */
export function duplicateAttentionSignal(): CandidateSignal {
  return {
    ref: makeSourceEvidenceRef('businessbrain', 'evidence_fragment', 'ev-attention-2'),
    proximity: 'attention',
    causalOrigin: makeCausalOriginRef('channel_format', 'process-reels'),
    valid: true,
    noticeEligible: true,
    observedAt: T_SIGNAL,
  };
}

const UNKNOWN_CONSTRAINTS: FounderConstraints = { known: false };
const OFFER_ABSENT: OfferExistence = { known: true, value: false };
const OFFER_UNKNOWN: OfferExistence = { known: false };

/** R1-F0 — Current Offer golden: two distinct valid streams, offer known-absent, constraints unknown. */
export function fixtureF0(): OfferEvaluationInput {
  return {
    currentHeldStance: heldStance(),
    signals: [attentionSignal(), interestSignal()],
    offerExists: OFFER_ABSENT,
    founderConstraints: UNKNOWN_CONSTRAINTS,
    priorHistory: [],
    occurredAt: T_EVAL,
    nextSeq: 1,
  };
}

/** R1-F1 — Unknown offer existence → information_insufficient; valid signals still allow Notice pass. */
export function fixtureF1(): OfferEvaluationInput {
  return { ...fixtureF0(), offerExists: OFFER_UNKNOWN };
}

/** R1-F2 — Same-origin dedup: a duplicate attention signal with the identical CausalOriginRef. */
export function fixtureF2(): OfferEvaluationInput {
  return {
    ...fixtureF0(),
    signals: [attentionSignal(), interestSignal(), duplicateAttentionSignal()],
  };
}

/**
 * Unit case (NOT an active fixture): proposition_absent but no valid+eligible signal.
 * Signals are valid (so grouping/streams exist) but NOT noticeEligible.
 */
export function noticeNegativeSignals(): CandidateSignal[] {
  return [
    { ...attentionSignal(), noticeEligible: false },
    { ...interestSignal(), noticeEligible: false },
  ];
}

/** Unit case (NOT an active fixture): zero valid signals → evaluate must reject. */
export function zeroValidSignalInput(): OfferEvaluationInput {
  return {
    ...fixtureF0(),
    signals: [
      { ...attentionSignal(), valid: false },
      { ...interestSignal(), valid: false },
    ],
  };
}
