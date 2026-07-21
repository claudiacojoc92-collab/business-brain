import { describe, it, expect } from 'vitest';
import { classifyStrategicJob } from '../../business-model/strategy-classifier';

/** Narrow to the in-scope subtype (fails loudly if the question was misclassified as out-of-scope). */
function sub(q: string): string { const c = classifyStrategicJob(q); if (c.job !== 'PRIORITY_DECISION') throw new Error(`expected in-scope, got OUT_OF_SCOPE for: ${q}`); return c.subtype; }

import {
  normalizeStrategicOutput, boundaryResponse, canTransition, assertTransition, isActiveSession, isTerminalSession,
  sessionRetryable, toSessionView, STRATEGIC_RESPONSE_TYPES, type StrategicSession, type StrategicRecommendation,
} from '../../business-model/strategy';
import { computeSessionContextConflicts } from '../../business-model/strategic-session.worker';
import type { StrategicContext } from '../../business-model/strategic-context.assembler';

/**
 * Wave 4 — PURE deterministic contract tests (no DB/network). Covers the parts of the Founder Conversation
 * Consumption Contract that live in code: bounded classification + scope boundary, the strict recommendation
 * schema + insufficient-evidence downgrade + parser failure, compositional confidence, epistemic-kind + unknown +
 * conflict preservation, the durable state machine + retry policy, and the founder-safe session view.
 */

// A well-formed raw model recommendation (as the model would emit it) for the normalizer tests.
function rawRecommendation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'STRATEGIC_RECOMMENDATION',
    recommendation: { title: 'Fix your positioning before spending on ads', action: 'Rewrite your homepage promise to name the specific buyer.', horizon: 'the next 30 days' },
    reasoning: {
      supportingEvidence: [{ kind: 'PUBLIC_POSITIONING_OBSERVATION', statement: 'Homepage headline is generic ("We help businesses grow").', refId: 'f-1', sourceUrl: 'https://example.com' }],
      founderDeclarations: [{ kind: 'FOUNDER_DECLARATION', statement: 'I sell to early-stage SaaS founders.', refId: 'c-2' }],
      assumptions: [{ assumption: 'Ad traffic would hit the same weak page.', basis: 'no landing page exists yet' }],
      unknowns: [{ unknown: 'Actual conversion rate today', whyItMatters: 'Sets the baseline the change is judged against.' }],
      counterEvidence: [{ kind: 'MARKET_INFERENCE', statement: 'Competitors run ads with similarly generic pages.', refId: null }],
      conflicts: [{ statement: 'You said the offer is clear', observation: 'Site frames three different offers', founderCorrection: 'The lead offer is the audit', refId: 'c-9' }],
    },
    confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'HIGH', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' },
    alternatives: [{ option: 'Run ads now and iterate', whyNotFirst: 'Pays to send traffic to a page that does not convert', whenItBecomesPreferable: 'Once the page names the buyer and one offer' }],
    nextStep: { action: 'Rewrite the homepage hero this week', successSignal: 'A visitor can say who it is for in one read', reviewAfter: '2 weeks' },
    whatWouldChangeThisRecommendation: ['If your current homepage already converts cold traffic well'],
    ...over,
  };
}

describe('strategy — bounded classification & scope', () => {
  it('recognises each priority family and assigns the subtype', () => {
    expect(classifyStrategicJob('Should I prioritise Instagram or LinkedIn next?')).toEqual({ job: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY' });
    expect(sub('Should I fix my positioning before running ads?')).toBe('POSITIONING_PRIORITY');
    expect(sub('Is it worth rebuilding my website first?')).toBe('WEBSITE_PRIORITY');
    expect(sub('Should we launch the new offer now or wait?')).toBe('LAUNCH_PRIORITY');
    expect(sub('Which offer should I focus my pricing on?')).toBe('OFFER_PRIORITY');
    expect(sub('Should I invest in paid ads or outreach for acquisition?')).toBe('ACQUISITION_PRIORITY');
    expect(sub('What should I prioritise in the next 30 days?')).toBe('GENERAL_30_DAY_PRIORITY');
  });

  it('returns OUT_OF_SCOPE for anything outside a business/marketing priority decision', () => {
    expect(classifyStrategicJob('I feel burned out and anxious, what should I do with my life?').job).toBe('OUT_OF_SCOPE');
    expect(classifyStrategicJob('Write me a poem about the ocean').job).toBe('OUT_OF_SCOPE');
    expect(classifyStrategicJob('What is the capital of France?').job).toBe('OUT_OF_SCOPE');
    expect(classifyStrategicJob('hi').job).toBe('OUT_OF_SCOPE'); // too short / no signal
    expect(classifyStrategicJob('Should I break up with my partner?').job).toBe('OUT_OF_SCOPE');
  });

  it('the boundary response names the one supported job and never pretends to answer', () => {
    const b = boundaryResponse();
    expect(b.kind).toBe('OUT_OF_SCOPE');
    expect(b.supported).toMatch(/priority/i);
    expect(b.message).toMatch(/one thing/i);
  });
});

describe('strategy — strict recommendation schema (normalizer)', () => {
  it('accepts a well-formed recommendation and preserves every reasoning dimension', () => {
    const out = normalizeStrategicOutput(rawRecommendation(), 'POSITIONING_PRIORITY');
    expect(out?.kind).toBe('STRATEGIC_RECOMMENDATION');
    const r = out as StrategicRecommendation;
    expect(r.subtype).toBe('POSITIONING_PRIORITY');
    expect(r.strategicJob).toBe('PRIORITY_DECISION');
    expect(r.recommendation.title).toMatch(/positioning/i);
    expect(r.nextStep.action).toMatch(/homepage/i);
    expect(r.reasoning.supportingEvidence).toHaveLength(1);
    expect(r.reasoning.founderDeclarations).toHaveLength(1);
    expect(r.reasoning.unknowns).toHaveLength(1);            // unknowns survive
    expect(r.reasoning.conflicts).toHaveLength(1);           // conflicts survive
    expect(r.reasoning.counterEvidence).toHaveLength(1);     // counter-evidence survives
    expect(r.alternatives).toHaveLength(1);
    expect(r.whatWouldChangeThisRecommendation).toHaveLength(1);
  });

  it('preserves the epistemic KIND of every reference and never flattens to a generic fact', () => {
    const out = normalizeStrategicOutput(rawRecommendation(), 'POSITIONING_PRIORITY') as StrategicRecommendation;
    expect(out.reasoning.supportingEvidence[0]!.kind).toBe('PUBLIC_POSITIONING_OBSERVATION');
    expect(out.reasoning.founderDeclarations[0]!.kind).toBe('FOUNDER_DECLARATION');
    expect(out.reasoning.counterEvidence[0]!.kind).toBe('MARKET_INFERENCE');
  });

  it('coerces an unknown epistemic kind to CONVERSATION_HYPOTHESIS (never invents an authoritative label)', () => {
    const raw = rawRecommendation();
    (raw['reasoning'] as Record<string, unknown>)['supportingEvidence'] = [{ kind: 'ABSOLUTE_TRUTH', statement: 'x' }];
    const out = normalizeStrategicOutput(raw, 'OFFER_PRIORITY') as StrategicRecommendation;
    expect(out.reasoning.supportingEvidence[0]!.kind).toBe('CONVERSATION_HYPOTHESIS');
  });

  it('compositional confidence — all five bands present; invalid band coerces to LOW (no fake certainty)', () => {
    const raw = rawRecommendation({ confidence: { evidenceStrength: 'WILD', founderConfirmation: 'HIGH' } });
    const out = normalizeStrategicOutput(raw, 'OFFER_PRIORITY') as StrategicRecommendation;
    expect(out.confidence.evidenceStrength).toBe('LOW');       // 'WILD' → LOW
    expect(out.confidence.founderConfirmation).toBe('HIGH');
    expect(out.confidence.marketContextQuality).toBe('LOW');   // missing → LOW
    expect(Object.keys(out.confidence)).toHaveLength(5);
  });

  it('rejects a recommendation missing a required core (title/action/nextStep/whatWouldChange) → null (MODEL_FAILED)', () => {
    expect(normalizeStrategicOutput(rawRecommendation({ recommendation: { action: 'x', horizon: 'y' } }), 'OFFER_PRIORITY')).toBeNull();      // no title
    const noNext = rawRecommendation(); (noNext['nextStep'] as Record<string, unknown>) = { successSignal: 'x' };
    expect(normalizeStrategicOutput(noNext, 'OFFER_PRIORITY')).toBeNull();                                                                     // no next action
    expect(normalizeStrategicOutput(rawRecommendation({ whatWouldChangeThisRecommendation: [] }), 'OFFER_PRIORITY')).toBeNull();               // no change-conditions
  });

  it('a recommendation with NO grounding is downgraded to explicit insufficient-evidence (never a baseless claim)', () => {
    const raw = rawRecommendation();
    (raw['reasoning'] as Record<string, unknown>)['supportingEvidence'] = [];
    (raw['reasoning'] as Record<string, unknown>)['founderDeclarations'] = [];
    const out = normalizeStrategicOutput(raw, 'OFFER_PRIORITY');
    expect(out?.kind).toBe('INSUFFICIENT_STRATEGIC_EVIDENCE');
  });

  it('passes through a well-formed insufficient-evidence result; empty insufficient → null', () => {
    const ok = normalizeStrategicOutput({ kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE', whatIsMissing: ['Your website'], smallestEvidenceAction: 'Add your site', whyItMatters: 'Grounding' }, 'WEBSITE_PRIORITY');
    expect(ok?.kind).toBe('INSUFFICIENT_STRATEGIC_EVIDENCE');
    expect(normalizeStrategicOutput({ kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE' }, 'WEBSITE_PRIORITY')).toBeNull();  // nothing usable
    expect(normalizeStrategicOutput(null, 'WEBSITE_PRIORITY')).toBeNull();
    expect(normalizeStrategicOutput('not json', 'WEBSITE_PRIORITY')).toBeNull();
  });

  it('schema-recommendation-3 compatibility: an optionAssessment (v3) parses; a payload without it (v1/v2) omits it', () => {
    const withOA = rawRecommendation({ optionAssessment: [{ label: 'LinkedIn', supportedByEvidence: true, excludedByContextRefId: 'sc-9' }, { label: 'Instagram', supportedByEvidence: false }] });
    const r3 = normalizeStrategicOutput(withOA, 'CHANNEL_PRIORITY') as StrategicRecommendation & { optionAssessment?: unknown[] };
    expect(r3.optionAssessment).toHaveLength(2);
    expect((r3.optionAssessment as Array<{ supportedByEvidence: boolean; excludedByContextRefId: string | null }>)[1]).toEqual({ label: 'Instagram', supportedByEvidence: false, excludedByContextRefId: null });
    const r2 = normalizeStrategicOutput(rawRecommendation(), 'CHANNEL_PRIORITY') as StrategicRecommendation & { optionAssessment?: unknown };
    expect(r2.optionAssessment).toBeUndefined(); // older payloads simply omit the new field
  });

  it('schema-recommendation-2 compatibility: a v1 payload (no context refs) and a v2 payload (with them) both normalize', () => {
    // v1 shape — evidence refs without any Founder Strategic Context fields (as persisted under strategy-recommendation-1).
    const v1 = normalizeStrategicOutput(rawRecommendation(), 'POSITIONING_PRIORITY') as StrategicRecommendation;
    expect(v1.reasoning.supportingEvidence[0]!.kind).toBe('PUBLIC_POSITIONING_OBSERVATION');
    expect(v1.reasoning.supportingEvidence[0]!.logicalItemId).toBeUndefined(); // v1 refs simply omit the new fields

    // v2 shape — a FOUNDER_STRATEGIC_CONTEXT ref carrying the new optional context fields.
    const raw = rawRecommendation();
    (raw['reasoning'] as Record<string, unknown>)['supportingEvidence'] = [
      { kind: 'FOUNDER_STRATEGIC_CONTEXT', statement: 'Budget is £150/mo (non-negotiable).', refId: 'item-9', logicalItemId: 'logi-9', version: 2, scope: 'ACQUISITION', source: 'FOUNDER_DECLARED', effectiveFrom: '2026-07-01T00:00:00.000Z' },
    ];
    const v2 = normalizeStrategicOutput(raw, 'ACQUISITION_PRIORITY') as StrategicRecommendation;
    const ref = v2.reasoning.supportingEvidence[0]!;
    expect(ref.kind).toBe('FOUNDER_STRATEGIC_CONTEXT');
    expect(ref.logicalItemId).toBe('logi-9'); expect(ref.version).toBe(2); expect(ref.scope).toBe('ACQUISITION'); expect(ref.source).toBe('FOUNDER_DECLARED');
    // shared fields parse identically across versions
    expect(ref.refId).toBe('item-9'); expect(ref.statement).toMatch(/Budget/);
  });

  it('caps unbounded arrays so a runaway model cannot flood the founder', () => {
    const many = Array.from({ length: 40 }, (_v, i) => ({ kind: 'FOUNDER_DECLARATION', statement: `d${i}` }));
    const raw = rawRecommendation();
    (raw['reasoning'] as Record<string, unknown>)['founderDeclarations'] = many;
    const out = normalizeStrategicOutput(raw, 'OFFER_PRIORITY') as StrategicRecommendation;
    expect(out.reasoning.founderDeclarations.length).toBeLessThanOrEqual(12);
  });
});

describe('strategy — durable state machine', () => {
  it('permits only the legal transitions', () => {
    expect(canTransition('QUEUED', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'READY')).toBe(true);
    expect(canTransition('PROCESSING', 'INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(canTransition('FAILED', 'QUEUED')).toBe(true);          // retry
    expect(canTransition('READY', 'QUEUED')).toBe(false);          // READY is terminal + immutable
    expect(canTransition('QUEUED', 'READY')).toBe(false);          // must go through PROCESSING
    expect(() => assertTransition('READY', 'PROCESSING')).toThrow(/illegal/);
  });
  it('classifies active vs terminal', () => {
    expect(isActiveSession('QUEUED')).toBe(true);
    expect(isActiveSession('PROCESSING')).toBe(true);
    expect(isTerminalSession('READY')).toBe(true);
    expect(isTerminalSession('INSUFFICIENT_EVIDENCE')).toBe(true);
    expect(isTerminalSession('FAILED')).toBe(true);
    expect(isTerminalSession('QUEUED')).toBe(false);
  });
});

describe('strategy — retry policy', () => {
  it('a transient FAILED under the attempt cap is retryable; insufficient/ready/exhausted are not', () => {
    expect(sessionRetryable('FAILED', 'MODEL_FAILED', 1, 3)).toBe(true);
    expect(sessionRetryable('FAILED', 'ASSEMBLY_FAILED', 2, 3)).toBe(true);
    expect(sessionRetryable('FAILED', 'MODEL_FAILED', 3, 3)).toBe(false);       // attempts exhausted
    expect(sessionRetryable('INSUFFICIENT_EVIDENCE', null, 1, 3)).toBe(false);  // add evidence, not blind retry
    expect(sessionRetryable('READY', null, 1, 3)).toBe(false);
    expect(sessionRetryable('FAILED', null, 1, 3)).toBe(false);                 // no category → not retryable
  });
});

describe('strategy — founder-safe session view', () => {
  const base: StrategicSession = {
    id: 's1', founderId: 'f1', status: 'FAILED', strategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY',
    questionText: 'Instagram or LinkedIn?', decisionHorizon: '30 days', understandingVersion: 2, contextHealth: { missingAreas: [] },
    recommendation: normalizeStrategicOutput(rawRecommendation(), 'CHANNEL_PRIORITY') as StrategicRecommendation,
    insufficientReason: null, contextConflicts: null, provenanceValidation: null, provenanceManifest: null, failureCategory: 'MODEL_FAILED', founderSafeError: 'Something went wrong. Try again.',
    contextSnapshotId: null, priorSuccessfulSessionId: null, modelId: 'claude-sonnet-5', promptVersion: 'strategy-1', schemaVersion: 'strategy-recommendation-1',
    attemptCount: 1, maxAttempts: 3, claimedAt: null, leaseExpiresAt: 'lease-secret', startedAt: null, finishedAt: null,
    createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
  };

  it('never leaks internal fields and gates the recommendation/insufficient/provenance on status', () => {
    const view = toSessionView(base) as Record<string, unknown>;
    expect(view['recommendation']).toBeNull();                 // not READY → no recommendation surfaced
    expect(view['failureCategory']).toBe('MODEL_FAILED');
    expect(view['retryable']).toBe(true);
    expect(view['provenance']).toBeNull();                     // provenance only on READY
    expect(JSON.stringify(view)).not.toContain('lease-secret'); // lease internals never exposed
    expect(view).not.toHaveProperty('leaseExpiresAt');
    expect(view).not.toHaveProperty('internalErrorDetail');
  });

  it('surfaces the recommendation + provenance only when READY', () => {
    const view = toSessionView({ ...base, status: 'READY', failureCategory: null }) as Record<string, unknown>;
    expect(view['recommendation']).not.toBeNull();
    expect(view['provenance']).toEqual({ modelId: 'claude-sonnet-5', promptVersion: 'strategy-1', schemaVersion: 'strategy-recommendation-1' });
    expect(view['retryable']).toBe(false);
  });

  it('response-type vocabulary is exactly the five founder semantics', () => {
    expect([...STRATEGIC_RESPONSE_TYPES].sort()).toEqual(['ACCEPT', 'NEEDS_MORE_EVIDENCE', 'NOT_RELEVANT_NOW', 'QUALIFY', 'REJECT']);
  });
});

describe('strategy — NON_NEGOTIABLE_OPTION (rule 3) wired through the worker over a bounded option set', () => {
  // A minimal StrategicContext whose founderContext carries one NON_NEGOTIABLE preference (item id "sc-nn").
  function ctxWithNonNegotiable(): StrategicContext {
    const nn = { id: 'sc-nn', logicalItemId: 'l-nn', version: 1, kind: 'STRATEGIC_PREFERENCE' as const, statement: 'No LinkedIn during this launch', category: 'ACQUISITION', scope: 'GLOBAL_STRATEGY' as const, source: 'FOUNDER_DECLARED', effectiveFrom: '2026-07-01T00:00:00.000Z', effectiveUntil: null, reviewAt: null, metadata: { kind: 'STRATEGIC_PREFERENCE' as const, category: 'ACQUISITION' as const, strength: 'NON_NEGOTIABLE' as const } };
    return {
      businessUnderstanding: { version: 1, conclusions: [], founderResponses: [], conflicts: [], unknowns: [] },
      publicPositioningContext: { entities: [], observations: [], inferences: [], provisional: { observations: 0, inferences: 0 }, provenance: [] },
      founderContext: { goals: [], constraints: [], resources: [], strategicPreferences: [nn], decisionHorizons: [], conflicts: [], staleItems: [], missingCriticalAreas: [] },
      question: { rawText: 'LinkedIn or Instagram?', normalizedStrategicJob: 'PRIORITY_DECISION', subtype: 'CHANNEL_PRIORITY', decisionHorizon: '30 days' },
      contextHealth: { missingAreas: [], staleAreas: [], contradictoryAreas: [], truncated: false },
    };
  }
  const insufficient = (oa: Array<{ label: string; supportedByEvidence: boolean; excludedByContextRefId: string | null }>) =>
    normalizeStrategicOutput({ kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE', whatIsMissing: ['x'], smallestEvidenceAction: 'gather', optionAssessment: oa }, 'CHANNEL_PRIORITY')!;

  it('fires when the only evidence-supported option is excluded by a non-negotiable (ref echoed by the model)', () => {
    const out = insufficient([{ label: 'LinkedIn', supportedByEvidence: true, excludedByContextRefId: 'sc-nn' }, { label: 'Instagram', supportedByEvidence: false, excludedByContextRefId: null }]);
    const conflicts = computeSessionContextConflicts(ctxWithNonNegotiable(), out);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.type).toBe('NON_NEGOTIABLE_OPTION_CONFLICT');
    expect(conflicts[0]!.itemIds).toContain('sc-nn'); // resolves to the stored non-negotiable item
  });

  it('also fires when the model omits the ref but the option text matches the non-negotiable (derived exclusion)', () => {
    const out = insufficient([{ label: 'Prioritise LinkedIn', supportedByEvidence: true, excludedByContextRefId: null }, { label: 'Instagram', supportedByEvidence: false, excludedByContextRefId: null }]);
    expect(computeSessionContextConflicts(ctxWithNonNegotiable(), out)[0]?.type).toBe('NON_NEGOTIABLE_OPTION_CONFLICT');
  });

  it('does NOT fire when a supported option remains, when nothing is supported, or when there is no option assessment', () => {
    expect(computeSessionContextConflicts(ctxWithNonNegotiable(), insufficient([{ label: 'LinkedIn', supportedByEvidence: true, excludedByContextRefId: 'sc-nn' }, { label: 'Newsletter', supportedByEvidence: true, excludedByContextRefId: null }]))).toHaveLength(0);
    expect(computeSessionContextConflicts(ctxWithNonNegotiable(), insufficient([{ label: 'LinkedIn', supportedByEvidence: false, excludedByContextRefId: 'sc-nn' }]))).toHaveLength(0);
    expect(computeSessionContextConflicts(ctxWithNonNegotiable(), normalizeStrategicOutput({ kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE', whatIsMissing: ['x'], smallestEvidenceAction: 'y' }, 'CHANNEL_PRIORITY')!)).toHaveLength(0);
  });

  it('ignores a model-echoed ref that does NOT resolve to a real non-negotiable (no manufactured provenance)', () => {
    const out = insufficient([{ label: 'Something', supportedByEvidence: true, excludedByContextRefId: 'not-a-real-id' }]);
    // no derivable exclusion by text either → no conflict (the fake ref is discarded)
    expect(computeSessionContextConflicts(ctxWithNonNegotiable(), out)).toHaveLength(0);
  });
});
