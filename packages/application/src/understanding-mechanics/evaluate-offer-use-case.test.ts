import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Partial module mocks that CALL THROUGH to the real committed implementations by
// default (preserving real behaviour for round-trip/trace/determinism tests) while
// wrapping the two functions in spies so call counts/ordering are assertable and a
// single test can override the kernel. The production function's signature is never
// changed — there is no deps parameter.
vi.mock('./offer-acl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./offer-acl')>();
  return { ...actual, buildOfferEvaluationInput: vi.fn(actual.buildOfferEvaluationInput) };
});
vi.mock('@bb/understanding-mechanics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bb/understanding-mechanics')>();
  return { ...actual, evaluateOfferMechanics: vi.fn(actual.evaluateOfferMechanics) };
});

import {
  evaluateOfferMechanics,
  makeCausalOriginRef,
  makeSourceEvidenceRef,
  MechanicsInvariantViolation,
} from '@bb/understanding-mechanics';
import { buildOfferEvaluationInput } from './offer-acl';
import { evaluateOfferFromCurrentVersion } from './evaluate-offer-use-case';
import type { PublicCurrentVersion } from '../businessbrain/domain/model';
import type { BuildOfferEvaluationInputParams, OfferSignalInput } from './offer-context';

const buildSpy = vi.mocked(buildOfferEvaluationInput);
const evalSpy = vi.mocked(evaluateOfferMechanics);

beforeEach(() => {
  buildSpy.mockClear();
  evalSpy.mockClear();
});

// ---- synthetic fixtures ----
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
function readyParams(over: Partial<BuildOfferEvaluationInputParams> = {}): BuildOfferEvaluationInputParams {
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

describe('R3 — evaluateOfferFromCurrentVersion (orchestration)', () => {
  it('1. READY: builder + kernel each called once; exact ready input & result by identity', () => {
    const outcome = evaluateOfferFromCurrentVersion(readyParams());
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(evalSpy).toHaveBeenCalledTimes(1);
    const built = buildSpy.mock.results[0]!.value as { status: 'ready'; input: unknown };
    expect(evalSpy.mock.calls[0]![0]).toBe(built.input); // kernel received the EXACT input object
    if (outcome.status !== 'evaluated') throw new Error('unreachable');
    expect(outcome.input).toBe(built.input); // returned by identity
    expect(outcome.result).toBe(evalSpy.mock.results[0]!.value); // kernel result by identity
  });

  it.each([
    ['incomplete_context', () => readyParams({ offerContext: { signals: [], offerExistence: { known: false } } })],
    ['provenance_unavailable_due_to_integrity', () => readyParams({ currentVersion: version({ traceability: undefined }) })],
    ['invalid_evidence_reference', () => readyParams({ offerContext: { signals: [attention('e9.9')], offerExistence: { known: false } } })],
    ['unsupported_mechanics_input', () => readyParams({ offerContext: { signals: [attention()], offerExistence: { known: true, value: true } } })],
  ])('2. NON-READY (%s): builder once, kernel zero, adapterResult by identity', (_label, make) => {
    const outcome = evaluateOfferFromCurrentVersion(make());
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(evalSpy).toHaveBeenCalledTimes(0);
    const built = buildSpy.mock.results[0]!.value;
    if (outcome.status !== 'not_ready') throw new Error('unreachable');
    expect(outcome.adapterResult).toBe(built); // exact original object, no reinterpretation
  });

  it('3. REAL ROUND-TRIP: evaluated, no_move, held unchanged, context_required', () => {
    const params = readyParams();
    const outcome = evaluateOfferFromCurrentVersion(params);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');
    expect(outcome.result.move.outcome).toBe('no_move');
    expect(JSON.stringify(outcome.result.currentHeldStance)).toBe(JSON.stringify(params.currentHeldStance));
    expect(outcome.result.entitlement.state).toBe('context_required');
  });

  it('4. AUTHORITY TRACE: R2-minted ref flows into R1 history sourceRefs + causalStreams', () => {
    const outcome = evaluateOfferFromCurrentVersion(readyParams());
    if (outcome.status !== 'evaluated') throw new Error('unreachable');
    const signalRef = outcome.input.signals[0]!.ref;
    expect(signalRef).toEqual({ sourceContext: 'businessbrain', sourceType: 'diagnosis_evidence_measure', sourceId: 'v-1::e1.1' });
    const histRefIds = outcome.result.history[0]!.sourceRefs.map((r) => r.sourceId);
    expect(histRefIds).toContain('v-1::e1.1');
    const streamKeys = outcome.result.history[0]!.causalStreams.map((c) => `${c.context}:${c.key}`);
    expect(streamKeys).toContain('channel_format:process-reels');
  });

  it('5. PROSE/PROMOTION IRRELEVANCE: changing Version prose/producedAt is byte-identical', () => {
    const base = JSON.stringify(evaluateOfferFromCurrentVersion(readyParams()));
    const mutated = JSON.stringify(
      evaluateOfferFromCurrentVersion(
        readyParams({
          currentVersion: version({
            businessReality: 'DIFFERENT.',
            rootCauses: ['Different RC.'],
            recommendations: ['Different rec.'],
            executionPlan: [{ label: 'Diff', actions: [{ statement: 'Different action', sequence: 1 }] }],
            cannotYetKnow: 'Different unknown.',
            producedAt: '2099-01-01T00:00:00.000Z',
          }),
        }),
      ),
    );
    expect(mutated).toBe(base);
  });

  it('6. EXPLICIT TIME/SEQUENCE: history occurredAt/seq come from params, not producedAt', () => {
    const params = readyParams({ occurredAt: '2026-08-05T08:00:00.000Z', nextSeq: 7 });
    const outcome = evaluateOfferFromCurrentVersion(params);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');
    const event = outcome.result.history[0]!;
    expect(event.occurredAt).toBe('2026-08-05T08:00:00.000Z');
    expect(event.occurredAt).not.toBe(params.currentVersion.producedAt);
    expect(event.seq).toBe(7);
  });

  it('7. DETERMINISM: identical command twice → byte-identical outcome', () => {
    expect(JSON.stringify(evaluateOfferFromCurrentVersion(readyParams()))).toBe(
      JSON.stringify(evaluateOfferFromCurrentVersion(readyParams())),
    );
  });

  it('8. NON-MUTATION: params serialize identically before and after; references preserved', () => {
    const params = readyParams();
    const before = JSON.stringify(params);
    const stanceRef = params.currentHeldStance;
    const signalsRef = params.offerContext.signals;
    const outcome = evaluateOfferFromCurrentVersion(params);
    expect(JSON.stringify(params)).toBe(before);
    expect(params.currentHeldStance).toBe(stanceRef); // not replaced
    expect(params.offerContext.signals).toBe(signalsRef);
    if (outcome.status !== 'evaluated') throw new Error('unreachable');
  });

  it('9. MALFORMED COMMAND: propagates the boundary error unchanged', () => {
    expect(() => evaluateOfferFromCurrentVersion(null as unknown as BuildOfferEvaluationInputParams)).toThrow(
      MechanicsInvariantViolation,
    );
  });

  it('10. MECHANICS FAILURE: the exact invariant error propagates; not converted to not_ready', () => {
    const boom = new MechanicsInvariantViolation('kernel self-check failed');
    evalSpy.mockImplementationOnce(() => {
      throw boom;
    });
    let caught: unknown;
    try {
      evaluateOfferFromCurrentVersion(readyParams());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom); // same instance, not swallowed
    expect(buildSpy).toHaveBeenCalledTimes(1); // builder ran (ready) first
    expect(evalSpy).toHaveBeenCalledTimes(1); // kernel was invoked once
  });

  it('11. STRUCTURAL ISOLATION: the use-case source imports no infra/API/UI/DB/LLM module', () => {
    let dir = process.cwd();
    let file = '';
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'packages/application/src/understanding-mechanics/evaluate-offer-use-case.ts');
      if (existsSync(candidate)) {
        file = candidate;
        break;
      }
      dir = dirname(dir);
    }
    expect(file).not.toBe('');
    void readdirSync; // (kept for parity with sibling structural scans)
    const src = readFileSync(file, 'utf8');
    const banned = [
      '@bb/infrastructure',
      '@bb/api',
      'apps/',
      'fastify',
      'kysely',
      'pg',
      'react',
      'ioredis',
      'bullmq',
      '@anthropic-ai/sdk',
      'anthropic',
      'openai',
    ];
    const offenders = banned.filter((b) => src.includes(`'${b}`) || src.includes(`"${b}`));
    expect(offenders).toEqual([]);
  });
});
