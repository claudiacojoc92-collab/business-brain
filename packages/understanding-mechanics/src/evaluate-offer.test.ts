import { describe, it, expect } from 'vitest';
import {
  assessOfferEntitlement,
  assessOfferMove,
  assessOfferNotice,
  buildWatchedHypothesis,
  classifyOfferObservability,
  evaluateOfferMechanics,
} from './evaluate-offer';
import { verifyR1Invariants } from './invariants';
import { MechanicsInvariantViolation } from './model';
import {
  fixtureF0,
  fixtureF1,
  fixtureF2,
  heldStance,
  noticeNegativeSignals,
  zeroValidSignalInput,
} from './fixtures/offer.fixtures';

describe('R1 Offer mechanics — evaluation', () => {
  it('R1-F0 golden: proposition_absent, 2 causal streams, Notice pass, context_required, no_move, held unchanged', () => {
    const input = fixtureF0();
    const r = evaluateOfferMechanics(input);

    // observability
    expect(r.observability.category).toBe('proposition_absent');
    expect(r.observability.streamCount).toBe(2);
    expect(r.observability.causalStreams.length).toBe(2);
    expect(r.observability.causalStreams.map((c) => `${c.context}:${c.key}`)).toEqual([
      'channel_format:process-reels',
      'event:saves-spike',
    ]);

    // notice passes BECAUSE of valid signals, not because of proposition_absent
    expect(r.notice.outcome).toBe('pass');
    expect(r.notice.basis.length).toBe(2);

    // entitlement grounded in unknown constraints; test never permitted
    expect(r.entitlement.state).toBe('context_required');
    expect(r.entitlement.audienceTestPermitted).toBe(false);

    // move: no_move with honest gates
    expect(r.move.outcome).toBe('no_move');
    expect(r.move.proposedStatement).toBeNull();
    expect(r.move.gates).toEqual({ notice: 'pass', entitlement: 'context_required' });

    // held stance unchanged (value-equal to input); separate watched hypothesis
    expect(JSON.stringify(r.currentHeldStance)).toBe(JSON.stringify(input.currentHeldStance));
    expect(r.activeHypothesis.state).toBe('watching');
    expect(r.activeHypothesis.raisedFrom.length).toBe(2);
    expect(r.activeHypothesis.proximityCeiling).toBe('interest');
    expect(r.activeHypothesis.statement).not.toBe(input.currentHeldStance.statement);

    // one ordered history event carrying both provenance and causal grouping
    expect(r.history.length).toBe(1);
    expect(r.history[0]!.seq).toBe(1);
    expect(r.history[0]!.type).toBe('offer_evaluated');
    expect(r.history[0]!.sourceRefs.length).toBe(3); // held basis (1) + 2 valid signals
    expect(r.history[0]!.causalStreams.length).toBe(2);

    expect(verifyR1Invariants(input, r).violations).toEqual([]);
  });

  it('R1-F1: unknown offer existence → information_insufficient; valid signals still pass Notice; no_move', () => {
    const input = fixtureF1();
    const r = evaluateOfferMechanics(input);
    expect(input.offerExists).toEqual({ known: false }); // unknown never became false
    expect(r.observability.category).toBe('information_insufficient');
    expect(r.observability.offerExists).toEqual({ known: false });
    expect(r.notice.outcome).toBe('pass');
    expect(r.move.outcome).toBe('no_move');
    expect(verifyR1Invariants(input, r).violations).toEqual([]);
  });

  it('R1-F2: a same-CausalOriginRef duplicate does not inflate streamCount', () => {
    const r0 = evaluateOfferMechanics(fixtureF0());
    const r2 = evaluateOfferMechanics(fixtureF2());
    expect(r2.observability.streamCount).toBe(r0.observability.streamCount); // still 2
    expect(r2.observability.causalStreams.length).toBe(2);
  });

  it('R1-F3-A: normal attention/interest assessment returns no_move and does NOT throw', () => {
    const input = fixtureF0();
    const obs = classifyOfferObservability(input.signals, input.offerExists);
    const notice = assessOfferNotice(input.signals);
    const ent = assessOfferEntitlement(input.founderConstraints);
    expect(() => assessOfferMove(obs, notice, ent)).not.toThrow();
    expect(assessOfferMove(obs, notice, ent).outcome).toBe('no_move');
  });

  it('R1-F5: identical input evaluated twice is byte-identical', () => {
    expect(JSON.stringify(evaluateOfferMechanics(fixtureF0()))).toBe(
      JSON.stringify(evaluateOfferMechanics(fixtureF0())),
    );
  });

  it('unit: proposition_absent + no valid/eligible signal → Notice no_valid_signal, Move no_move (honest gate)', () => {
    const signals = noticeNegativeSignals();
    const obs = classifyOfferObservability(signals, { known: true, value: false });
    const notice = assessOfferNotice(signals);
    const ent = assessOfferEntitlement({ known: false });
    const move = assessOfferMove(obs, notice, ent);
    expect(obs.category).toBe('proposition_absent');
    expect(notice.outcome).toBe('no_valid_signal');
    expect(move.outcome).toBe('no_move');
    expect(move.gates.notice).toBe('no_valid_signal');
  });

  it('unit: proposition_absent does not manufacture Notice pass without a valid+eligible signal', () => {
    // observability says proposition_absent, but Notice is orthogonal and must not pass
    const notice = assessOfferNotice(noticeNegativeSignals());
    expect(notice.outcome).not.toBe('pass');
  });

  it('unit: evaluateOfferMechanics with zero valid signals rejects; no fabricated hypothesis/result', () => {
    expect(() => evaluateOfferMechanics(zeroValidSignalInput())).toThrow(MechanicsInvariantViolation);
  });

  it('unit: buildWatchedHypothesis derives from valid signals only and rejects zero-valid input', () => {
    const valid = fixtureF0().signals;
    const h = buildWatchedHypothesis(valid, heldStance());
    expect(h.raisedFrom.length).toBe(2);
    expect(() => buildWatchedHypothesis([{ ...valid[0]!, valid: false }], heldStance())).toThrow(
      MechanicsInvariantViolation,
    );
  });
});
