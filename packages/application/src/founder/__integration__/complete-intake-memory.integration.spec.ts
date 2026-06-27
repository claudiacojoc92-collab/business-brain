// packages/application/src/founder/__integration__/complete-intake-memory.integration.spec.ts
//
// Integration test (Vitest) against a live test database.
// Proves the end-to-end claim from Phase 9A.5 Week-1 Task #3:
//   "complete intake → memory layers populated".
//
// HARNESS-PENDING: setup() is a deliberate stub. This file is named *.integration.spec.ts
// and is NOT matched by the root vitest include glob (packages/*/src/**/*.test.ts), so it is
// excluded from the default suite. The ASSERTIONS are the contract; wire setup() to a real
// Postgres test harness (container/DB bootstrap + the production composition root) to run it.
// FOUNDATION_LAYER resolved to MemoryLayer.BUSINESS_EVOLUTION.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MemoryLayer } from '@bb/shared';
import type {
  IBusinessMemoryRepository,
  IFounderProfileRepository,
  IFounderVoiceRepository,
} from '@bb/domain';
// import { buildTestContainer, truncateAll, seedFounderInIntakePending } from '@bb/test/helpers';

/** Shape the wired harness must return. The assertions below are the real contract. */
interface IntegrationCtx {
  memoryRepo: IBusinessMemoryRepository;
  voiceRepo: IFounderVoiceRepository;
  founderRepo: IFounderProfileRepository;
  seedFounderInIntakePending(): Promise<string>;
  submitIntakeSignal(founderId: string, signalType: string, value: string): Promise<void>;
  completeIntake(founderId: string): Promise<void>;
  truncate(): Promise<void>;
  teardown(): Promise<void>;
}

const FOUNDATION_LAYER = MemoryLayer.BUSINESS_EVOLUTION;

// The 29 intake answers, all strong, for a synthetic founder.
const STRONG = (label: string) => `${label}: ${'detail '.repeat(6)}`.trim();
const SIGNAL_TYPES = [
  'CONVICTION_MECHANISM', 'FOUNDING_STORY', 'BELIEF_TARGET', 'CONVICTION_FALSIFICATION',
  'EDUCATION_INSIGHT', 'CONTRARIAN_POSITION', 'BELIEF_CHAIN_STRUCTURE', 'INTENDED_AUDIENCE_MOVEMENT',
  'VOICE_OPENING_EXAMPLE', 'VOICE_CTA_EXAMPLE', 'VOICE_ANALOGY', 'OBJECTION_RESPONSE',
  'VOICE_SYNONYM', 'VOICE_REJECTION_EXAMPLE',
  'AUDIENCE_INTERNAL_MONOLOGUE', 'AUDIENCE_SOCIAL_FRAMING', 'AUDIENCE_SELF_PROTECTION',
  'WARM_SIGNAL_VOCABULARY', 'COLD_SIGNAL_VOCABULARY', 'AUDIENCE_FALSE_ASSUMPTION',
  'OFFER_NATURAL_LANGUAGE', 'OFFER_PRICE_PHILOSOPHY',
  'PRIMARY_OBJECTION', 'CONTENT_HARD_BLOCK', 'APPROVAL_STANDARD_NEGATIVE',
  'APPROVAL_STANDARD_POSITIVE', 'ZERO_EDIT_CRITERIA', 'TRUST_CRITERIA',
  'UNSOLICITED_HIGH_VALUE',
];

describe('CompleteIntake → Business Memory (integration)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => { ctx = await setup(); });
  afterAll(async () => { await ctx.teardown(); });
  beforeEach(async () => { await ctx.truncate(); });

  it('populates the seeded layers, voice version, and flips status to ACTIVE', async () => {
    const founderId = await ctx.seedFounderInIntakePending();
    for (const t of SIGNAL_TYPES) {
      await ctx.submitIntakeSignal(founderId, t, STRONG(t));
    }

    await ctx.completeIntake(founderId); // CompleteIntakeHandler → IntakeMemoryMapper

    // (a) target layers exist at the seeded confidences with data_points = 1
    const foundation = await ctx.memoryRepo.findLayer(founderId, FOUNDATION_LAYER);
    expect(foundation?.confidence).toBeCloseTo(0.62, 2);
    expect(foundation?.dataPoints).toBe(1);
    expect((foundation?.payload as { intake_seeded?: boolean })?.intake_seeded).toBe(true);

    const offer = await ctx.memoryRepo.findLayer(founderId, MemoryLayer.OFFER_INTELLIGENCE);
    expect(offer?.confidence).toBeCloseTo(0.68, 2);

    const approval = await ctx.memoryRepo.findLayer(founderId, MemoryLayer.APPROVAL_INTELLIGENCE);
    expect(approval?.confidence).toBeCloseTo(0.45, 2);

    const audience = await ctx.memoryRepo.findLayer(founderId, MemoryLayer.AUDIENCE_TEMPERATURE);
    expect(audience?.confidence).toBeCloseTo(0.4, 2);
    expect((audience?.payload as { current_temperature?: string })?.current_temperature).toBe('UNKNOWN');

    const rejection = await ctx.memoryRepo.findLayer(founderId, MemoryLayer.REJECTION_INTELLIGENCE);
    expect(rejection?.confidence).toBeCloseTo(0.35, 2);

    // behavioural layers stay at baseline 0
    const perf = await ctx.memoryRepo.findLayer(founderId, MemoryLayer.PERFORMANCE_INTELLIGENCE);
    expect(perf?.confidence ?? 0).toBe(0);

    // (b) founder_voice_versions row exists with opening_pattern + cta_style
    const voice = await ctx.voiceRepo.findActive(founderId);
    expect(voice?.openingPattern).toBeTruthy();
    expect(voice?.ctaStyle).toBeTruthy();

    // (c) Q27 quarantined, not in any layer payload
    const quarantined = await ctx.memoryRepo.findQuarantinedEvents(founderId);
    expect(quarantined.some((e) => JSON.stringify(e).includes('UNSOLICITED_HIGH_VALUE'))).toBe(true);

    // (d) status ACTIVE
    const founder = await ctx.founderRepo.findById(founderId);
    expect(founder?.status).toBe('ACTIVE');
  });

  it('is idempotent: re-completing does not duplicate or change seeded memory', async () => {
    const founderId = await ctx.seedFounderInIntakePending();
    for (const t of SIGNAL_TYPES) await ctx.submitIntakeSignal(founderId, t, STRONG(t));

    await ctx.completeIntake(founderId);
    const before = await ctx.memoryRepo.findLayer(founderId, FOUNDATION_LAYER);

    await ctx.completeIntake(founderId); // replay (idempotency-key path)
    const after = await ctx.memoryRepo.findLayer(founderId, FOUNDATION_LAYER);

    expect(after?.confidence).toBe(before?.confidence);
    expect(after?.dataPoints).toBe(before?.dataPoints); // not double-incremented
  });
});

// ── environment-specific harness — wire to your existing test infra ──
async function setup(): Promise<IntegrationCtx> {
  // const container = await buildTestContainer();
  // return { memoryRepo, voiceRepo, founderRepo, submitIntakeSignal, completeIntake,
  //          seedFounderInIntakePending, truncate, teardown };
  await Promise.resolve();
  throw new Error('Wire setup() to the real test container before running this integration spec.');
}
