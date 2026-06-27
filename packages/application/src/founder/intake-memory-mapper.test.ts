// packages/application/src/founder/intake-memory-mapper.test.ts
//
// Unit tests (Vitest) for IntakeMemoryMapper. Repositories are mocked.
// RESOLVED: MemoryLayer from @bb/shared; FOUNDATION_LAYER = MemoryLayer.BUSINESS_EVOLUTION (grep).

import { describe, it, expect, vi } from 'vitest';
import {
  IntakeMemoryMapper,
  isStrong,
  toSignalMap,
  inferCtaStyle,
  type SignalMap,
} from './intake-memory-mapper';
import { MemoryLayer } from '@bb/shared';

// ── Resolve from grep ──
const FOUNDATION_LAYER = MemoryLayer.BUSINESS_EVOLUTION;

const STRONG = 'x'.repeat(40);

function fullSignals(): SignalMap {
  // All 29 present and strong (Q18b included). Q27 present too.
  const types = [
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
  return Object.fromEntries(types.map((t) => [t, STRONG]));
}

function makeMapper(opts: { intakeEventType?: string } = {}) {
  const layers = new Map<string, { payload?: Record<string, unknown> }>();
  const memoryRepo = {
    findLayer: vi.fn(async (_f: string, layer: MemoryLayer) => layers.get(String(layer)) ?? null),
    saveLayer: vi.fn(async (l: { layer: MemoryLayer; payload: Record<string, unknown> }) => {
      layers.set(String(l.layer), { payload: l.payload });
    }),
    appendIntelligenceEvents: vi.fn(async (_events: Array<Record<string, unknown>>, _tx: unknown) => undefined),
  };
  const voiceRepo = { upsertFromIntake: vi.fn(async () => undefined) };
  const clock = { now: () => new Date('2026-06-27T10:00:00.000Z') };
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const mapper = new IntakeMemoryMapper(
    memoryRepo as never, voiceRepo as never, clock as never, logger as never,
    { foundationLayer: FOUNDATION_LAYER, intakeEventType: opts.intakeEventType, minStrongLen: 15 },
  );
  return { mapper, memoryRepo, voiceRepo, logger, layers };
}

const TX = {} as never;
const FID = 'founder_test_1';

describe('IntakeMemoryMapper — config guard', () => {
  it('refuses to construct without a foundation layer (FOUNDATION* must be resolved)', () => {
    expect(() => new IntakeMemoryMapper(
      {} as never, {} as never, { now: () => new Date() } as never, { warn: vi.fn() } as never,
      { foundationLayer: undefined as never },
    )).toThrow(/foundationLayer is required/);
  });
});

describe('IntakeMemoryMapper — full intake', () => {
  it('seeds all target layers at approved ceilings when every answer is strong', async () => {
    const { mapper, layers } = makeMapper({ intakeEventType: 'DECLARATIVE' });
    const res = await mapper.seedFromIntake(FID, fullSignals(), TX);

    expect(res.seededLayers[String(FOUNDATION_LAYER)]).toBe(0.62);
    expect(res.seededLayers.OFFER_INTELLIGENCE).toBe(0.68);
    expect(res.seededLayers.APPROVAL_INTELLIGENCE).toBe(0.45);
    expect(res.seededLayers.AUDIENCE_TEMPERATURE).toBe(0.4);
    expect(res.seededLayers.REJECTION_INTELLIGENCE).toBe(0.35);
    expect(res.seededLayers.EDIT_PATTERN_INTELLIGENCE).toBe(0.0);

    // current_temperature must stay UNKNOWN — never seeded from interview.
    const aud = layers.get(String(MemoryLayer.AUDIENCE_TEMPERATURE))!.payload!;
    expect(aud.current_temperature).toBe('UNKNOWN');
  });

  it('creates the founder_voice_versions row from Q7/Q10', async () => {
    const { mapper, voiceRepo } = makeMapper({ intakeEventType: 'DECLARATIVE' });
    await mapper.seedFromIntake(FID, fullSignals(), TX);
    expect(voiceRepo.upsertFromIntake).toHaveBeenCalledOnce();
  });
});

describe('IntakeMemoryMapper — change #4: conditional seeding', () => {
  it('lowers a layer confidence proportionally when some answers are missing/weak', async () => {
    const s = fullSignals();
    // OFFER has 2 contributing answers; drop one → 0.68 * 1/2 = 0.34
    s.OFFER_PRICE_PHILOSOPHY = '';
    const { mapper } = makeMapper();
    const res = await mapper.seedFromIntake(FID, s, TX);
    expect(res.seededLayers.OFFER_INTELLIGENCE).toBe(0.34);
  });

  it('does not seed a layer when all its answers are absent', async () => {
    const s = fullSignals();
    s.OFFER_NATURAL_LANGUAGE = '';
    s.OFFER_PRICE_PHILOSOPHY = undefined;
    const { mapper } = makeMapper();
    const res = await mapper.seedFromIntake(FID, s, TX);
    expect(res.seededLayers.OFFER_INTELLIGENCE).toBeUndefined();
  });

  it('treats a too-short answer as weak (below minStrongLen)', () => {
    expect(isStrong('too short', 15)).toBe(false);
    expect(isStrong('x'.repeat(20), 15)).toBe(true);
  });
});

describe('IntakeMemoryMapper — change #3: Q27 quarantine', () => {
  it('never maps UNSOLICITED_HIGH_VALUE into a layer payload', async () => {
    const { mapper, layers } = makeMapper({ intakeEventType: 'DECLARATIVE' });
    await mapper.seedFromIntake(FID, fullSignals(), TX);
    for (const [, l] of layers) {
      expect(JSON.stringify(l.payload)).not.toContain('UNSOLICITED_HIGH_VALUE');
    }
  });

  it('writes Q27 only as a QUARANTINED intelligence event', async () => {
    const { mapper, memoryRepo } = makeMapper({ intakeEventType: 'DECLARATIVE' });
    await mapper.seedFromIntake(FID, fullSignals(), TX);
    const appended = memoryRepo.appendIntelligenceEvents.mock.calls[0]![0] as Array<Record<string, unknown>>;
    const q27 = appended.find((e) => (e.content as { signal_type: string }).signal_type === 'UNSOLICITED_HIGH_VALUE');
    expect(q27?.quarantineStatus).toBe('QUARANTINED');
  });
});

describe('IntakeMemoryMapper — change #2: event-type gap', () => {
  it('seeds layers but skips intelligence events when no intakeEventType is configured', async () => {
    const { mapper, memoryRepo, logger } = makeMapper({ intakeEventType: undefined });
    const res = await mapper.seedFromIntake(FID, fullSignals(), TX);
    expect(memoryRepo.appendIntelligenceEvents).not.toHaveBeenCalled();
    expect(res.intelligenceEvents).toBe(0);
    expect(res.seededLayers[String(FOUNDATION_LAYER)]).toBe(0.62); // layer payload still seeded
    expect(logger.warn).toHaveBeenCalled(); // gap is logged, not invented around
  });
});

describe('IntakeMemoryMapper — idempotency', () => {
  it('is a no-op on re-run (already intake_seeded)', async () => {
    const { mapper, memoryRepo } = makeMapper({ intakeEventType: 'DECLARATIVE' });
    await mapper.seedFromIntake(FID, fullSignals(), TX);
    const savesAfterFirst = memoryRepo.saveLayer.mock.calls.length;
    await mapper.seedFromIntake(FID, fullSignals(), TX);
    // Second run finds intake_seeded=true and saves nothing further.
    expect(memoryRepo.saveLayer.mock.calls.length).toBe(savesAfterFirst);
  });
});

describe('pure helpers', () => {
  it('toSignalMap keeps last value per type', () => {
    const m = toSignalMap([{ signal_type: 'A', value: '1' }, { signal_type: 'A', value: '2' }]);
    expect(m.A).toBe('2');
  });
  it('inferCtaStyle classifies examples', () => {
    expect(inferCtaStyle('Book a call today')).toBe('DIRECT');
    expect(inferCtaStyle('What would change if you tried this?')).toBe('SOFT');
    expect(inferCtaStyle('Here is how I think about it.')).toBe('INVITATION');
    expect(inferCtaStyle('')).toBe('NONE');
  });
});
