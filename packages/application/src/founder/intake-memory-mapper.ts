// packages/application/src/founder/intake-memory-mapper.ts
//
// IntakeMemoryMapper
// ------------------
// Seeds Business Memory from the completed intake.
// Invoked by CompleteIntakeHandler INSIDE the existing transaction (never opens its own).
//
// RESOLVED against the real codebase (B1/A2):
//  R1  imports below — MemoryLayer + IClock from @bb/shared; IBusinessMemoryRepository,
//      MemoryLayerVO, IntelligenceEvent, IFounderVoiceRepository from @bb/domain. tx is `unknown`
//      (the repo ports take `unknown`, not a kysely Transaction). No @bb/shared logger exists, so a
//      minimal IIntakeMapperLogger is declared locally (the pino Logger satisfies it).
//  R2  IBusinessMemoryRepository already exposes findLayer / saveLayer / appendIntelligenceEvents.
//      saveLayer takes a MemoryLayerVO, so seedLayer constructs one.
//  R3  IFounderVoiceRepository.upsertFromIntake — added as a port (no prior writer existed).
//  R4  No DECLARATIVE/STATED IntelligenceEventType exists (OBSERVATIONAL/INFERENTIAL/CONFIDENCE/
//      BEHAVIOURAL/OUTCOME). Production wiring passes intakeEventType = undefined → layer payloads
//      still seed, the intelligence-event trail is SKIPPED and the gap is logged.
//  R5  FOUNDATION* = MemoryLayer.BUSINESS_EVOLUTION (no FOUNDATION layer exists; the 9-layer enum
//      has BUSINESS_EVOLUTION, which the context-builder reads conviction/belief context from).

import { MemoryLayer, type IClock } from '@bb/shared';
import {
  MemoryLayerVO,
  type IBusinessMemoryRepository,
  type IntelligenceEvent,
  type IFounderVoiceRepository,
} from '@bb/domain';

/** Minimal logger surface used here. The infrastructure pino Logger satisfies it. */
export interface IIntakeMapperLogger {
  warn(obj: unknown, msg: string): void;
}

/** Raw intake signals as stored in founder.intake_sessions.signals (JSONB). */
export type RawSignal = { signal_type: string; value: string };
/** Normalised map: signal_type -> latest value. */
export type SignalMap = Record<string, string | undefined>;

export interface IntakeMemoryMapperConfig {
  /** The enum value the live pipeline reads conviction/belief context from. REQUIRED. */
  foundationLayer: MemoryLayer;
  /** Founder-stated intelligence-event type, if one exists. Omit to skip intelligence events. */
  intakeEventType?: string;
  /** Minimum trimmed length for an answer to count as "strong". Default 15. */
  minStrongLen?: number;
}

/** Approved seed ceilings (Phase 9B Scenario-A). Applied only when all contributing answers are strong. */
const SEED_CEILING = {
  FOUNDATION: 0.62,
  OFFER: 0.68,
  APPROVAL: 0.45,
  AUDIENCE: 0.4,
  REJECTION: 0.35,
  // EDIT_PATTERN stated fields seed, but pattern_confidence stays 0 (behavioural).
  EDIT_PATTERN: 0.0,
} as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export class IntakeMemoryMapper {
  private readonly minStrongLen: number;

  constructor(
    private readonly memoryRepo: IBusinessMemoryRepository,
    private readonly voiceRepo: IFounderVoiceRepository,
    private readonly clock: IClock,
    private readonly logger: IIntakeMapperLogger,
    private readonly config: IntakeMemoryMapperConfig,
  ) {
    if (!config?.foundationLayer) {
      // Fail loud: never silently write to the wrong layer.
      throw new Error(
        'IntakeMemoryMapper: config.foundationLayer is required (resolve FOUNDATION* from the pipeline-reader grep).',
      );
    }
    this.minStrongLen = config.minStrongLen ?? 15;
  }

  /**
   * Seed Business Memory from a completed intake. Idempotent. Runs inside the caller's tx.
   * @returns summary of what was seeded (for logging/tests).
   */
  async seedFromIntake(
    founderId: string,
    rawSignals: RawSignal[] | SignalMap,
    tx: unknown,
  ): Promise<IntakeSeedResult> {
    const s = Array.isArray(rawSignals) ? toSignalMap(rawSignals) : rawSignals;
    const events: IntelligenceEvent[] = [];
    const seeded: Record<string, number> = {};

    // FOUNDATION* — conviction / belief / education / contrarian / intended movement
    const foundationInputs = [
      s.CONVICTION_MECHANISM, s.FOUNDING_STORY, s.BELIEF_TARGET, s.CONVICTION_FALSIFICATION,
      s.EDUCATION_INSIGHT, s.CONTRARIAN_POSITION, s.BELIEF_CHAIN_STRUCTURE, s.INTENDED_AUDIENCE_MOVEMENT,
    ];
    const foundationConf = this.seedConfidence(SEED_CEILING.FOUNDATION, foundationInputs);
    if (foundationConf > 0) {
      await this.seedLayer(founderId, this.config.foundationLayer, foundationConf, {
        conviction_angle: {
          statement: this.pick(s.CONVICTION_MECHANISM),
          evidence: this.pick(s.FOUNDING_STORY),
          confidence: this.pick(s.CONVICTION_FALSIFICATION),
          contrarian: this.pick(s.CONTRARIAN_POSITION),
        },
        belief_chain: { beliefs: compactArr([s.BELIEF_TARGET, s.BELIEF_CHAIN_STRUCTURE]) },
        education_topics: compactArr([s.EDUCATION_INSIGHT]),
        intended_effect: this.pick(s.INTENDED_AUDIENCE_MOVEMENT),
      }, tx);
      seeded[String(this.config.foundationLayer)] = foundationConf;
      this.collectEvents(events, founderId, this.config.foundationLayer, [
        'CONVICTION_MECHANISM', 'FOUNDING_STORY', 'BELIEF_TARGET', 'CONVICTION_FALSIFICATION',
        'EDUCATION_INSIGHT', 'CONTRARIAN_POSITION', 'BELIEF_CHAIN_STRUCTURE', 'INTENDED_AUDIENCE_MOVEMENT',
      ], s);
    }

    // OFFER_INTELLIGENCE (L7) — offer language + price philosophy
    const offerInputs = [s.OFFER_NATURAL_LANGUAGE, s.OFFER_PRICE_PHILOSOPHY];
    const offerConf = this.seedConfidence(SEED_CEILING.OFFER, offerInputs);
    if (offerConf > 0) {
      await this.seedLayer(founderId, MemoryLayer.OFFER_INTELLIGENCE, offerConf, {
        offer_natural_language: this.pick(s.OFFER_NATURAL_LANGUAGE),
        price_philosophy: this.pick(s.OFFER_PRICE_PHILOSOPHY),
      }, tx);
      seeded.OFFER_INTELLIGENCE = offerConf;
      this.collectEvents(events, founderId, MemoryLayer.OFFER_INTELLIGENCE,
        ['OFFER_NATURAL_LANGUAGE', 'OFFER_PRICE_PHILOSOPHY'], s);
    }

    // APPROVAL_INTELLIGENCE (L1) — positive standard, zero-edit criteria, trust criteria
    const approvalInputs = [s.APPROVAL_STANDARD_POSITIVE, s.ZERO_EDIT_CRITERIA, s.TRUST_CRITERIA];
    const approvalConf = this.seedConfidence(SEED_CEILING.APPROVAL, approvalInputs);
    if (approvalConf > 0) {
      await this.seedLayer(founderId, MemoryLayer.APPROVAL_INTELLIGENCE, approvalConf, {
        positive_standard_piece: this.pick(s.APPROVAL_STANDARD_POSITIVE),
        zero_edit_criteria: this.pick(s.ZERO_EDIT_CRITERIA),
        system_trust_criteria: this.pick(s.TRUST_CRITERIA),
      }, tx);
      seeded.APPROVAL_INTELLIGENCE = approvalConf;
      this.collectEvents(events, founderId, MemoryLayer.APPROVAL_INTELLIGENCE,
        ['APPROVAL_STANDARD_POSITIVE', 'ZERO_EDIT_CRITERIA', 'TRUST_CRITERIA'], s);
    }

    // AUDIENCE_TEMPERATURE (L9) — vocabulary only; current_temperature stays UNKNOWN
    const audienceInputs = [
      s.AUDIENCE_INTERNAL_MONOLOGUE, s.AUDIENCE_SOCIAL_FRAMING, s.AUDIENCE_SELF_PROTECTION,
      s.WARM_SIGNAL_VOCABULARY, s.COLD_SIGNAL_VOCABULARY, s.AUDIENCE_FALSE_ASSUMPTION,
    ];
    const audienceConf = this.seedConfidence(SEED_CEILING.AUDIENCE, audienceInputs);
    if (audienceConf > 0) {
      await this.seedLayer(founderId, MemoryLayer.AUDIENCE_TEMPERATURE, audienceConf, {
        audience_internal_monologue: this.pick(s.AUDIENCE_INTERNAL_MONOLOGUE),
        audience_social_framing: this.pick(s.AUDIENCE_SOCIAL_FRAMING),
        self_protective_narrative: this.pick(s.AUDIENCE_SELF_PROTECTION),
        warm_signal_phrases: compactArr([s.WARM_SIGNAL_VOCABULARY]),
        cold_signal_phrases: compactArr([s.COLD_SIGNAL_VOCABULARY]),
        false_assumption_hierarchy: compactArr([s.AUDIENCE_FALSE_ASSUMPTION]),
        current_temperature: 'UNKNOWN', // behavioural; never seeded from interview
      }, tx);
      seeded.AUDIENCE_TEMPERATURE = audienceConf;
      this.collectEvents(events, founderId, MemoryLayer.AUDIENCE_TEMPERATURE, [
        'AUDIENCE_INTERNAL_MONOLOGUE', 'AUDIENCE_SOCIAL_FRAMING', 'AUDIENCE_SELF_PROTECTION',
        'WARM_SIGNAL_VOCABULARY', 'COLD_SIGNAL_VOCABULARY', 'AUDIENCE_FALSE_ASSUMPTION',
      ], s);
    }

    // REJECTION_INTELLIGENCE (L3) — objection, phrase-level hard blocks, negative standard
    const rejectionInputs = [s.PRIMARY_OBJECTION, s.CONTENT_HARD_BLOCK, s.APPROVAL_STANDARD_NEGATIVE];
    const rejectionConf = this.seedConfidence(SEED_CEILING.REJECTION, rejectionInputs);
    if (rejectionConf > 0) {
      await this.seedLayer(founderId, MemoryLayer.REJECTION_INTELLIGENCE, rejectionConf, {
        primary_objection: this.pick(s.PRIMARY_OBJECTION),
        content_hard_blocks: compactArr([s.CONTENT_HARD_BLOCK]),
        approval_standard_negative: this.pick(s.APPROVAL_STANDARD_NEGATIVE),
      }, tx);
      seeded.REJECTION_INTELLIGENCE = rejectionConf;
      this.collectEvents(events, founderId, MemoryLayer.REJECTION_INTELLIGENCE,
        ['PRIMARY_OBJECTION', 'CONTENT_HARD_BLOCK', 'APPROVAL_STANDARD_NEGATIVE'], s);
    }

    // EDIT_PATTERN_INTELLIGENCE (L2) — stated voice vocab; pattern_confidence stays 0 (behavioural)
    if (isStrong(s.VOICE_SYNONYM, this.minStrongLen) || isStrong(s.VOICE_REJECTION_EXAMPLE, this.minStrongLen)) {
      await this.seedLayer(founderId, MemoryLayer.EDIT_PATTERN_INTELLIGENCE, SEED_CEILING.EDIT_PATTERN, {
        forbidden_words: compactArr([s.VOICE_REJECTION_EXAMPLE, s.VOICE_SYNONYM]),
        synonym_map: {}, // parsed from Q9 free text downstream; left empty here to avoid guessing structure
        pattern_confidence: 0.0,
      }, tx);
      seeded.EDIT_PATTERN_INTELLIGENCE = 0.0;
      this.collectEvents(events, founderId, MemoryLayer.EDIT_PATTERN_INTELLIGENCE,
        ['VOICE_SYNONYM', 'VOICE_REJECTION_EXAMPLE'], s);
    }

    // founder.voice_versions row — opening pattern (Q7) + CTA style (Q10) only.
    await this.seedVoiceVersion(founderId, s, tx);

    // Q27 — UNSOLICITED_HIGH_VALUE: quarantined, never auto-mapped, never counted in confidence.
    if (isStrong(s.UNSOLICITED_HIGH_VALUE, this.minStrongLen) && this.config.intakeEventType) {
      events.push(this.buildEvent(founderId, this.config.foundationLayer, 'UNSOLICITED_HIGH_VALUE',
        s.UNSOLICITED_HIGH_VALUE!, /* quarantined */ true));
    }

    // Append intelligence events only if a real founder-stated event type exists; otherwise log the gap.
    if (this.config.intakeEventType) {
      if (events.length > 0) await this.memoryRepo.appendIntelligenceEvents(events, tx);
    } else {
      this.logger.warn(
        { founderId, layers: Object.keys(seeded) },
        'IntakeMemoryMapper: no intakeEventType configured — layer payloads seeded, intelligence-event trail SKIPPED (event-type gap, documented).',
      );
    }

    return { founderId, seededLayers: seeded, intelligenceEvents: this.config.intakeEventType ? events.length : 0 };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** Upsert a layer's seed payload idempotently. No-op if already seeded from intake. */
  private async seedLayer(
    founderId: string,
    layer: MemoryLayer,
    confidence: number,
    payload: Record<string, unknown>,
    tx: unknown,
  ): Promise<void> {
    const existing = await this.memoryRepo.findLayer(founderId, layer);
    if (existing && (existing.payload as { intake_seeded?: boolean })?.intake_seeded === true) {
      return; // idempotent guard — already seeded from intake
    }
    const now = this.clock.now();
    const merged = {
      ...(existing?.payload ?? {}),
      ...payload,
      intake_seeded: true,
      intake_seeded_at: now.toISOString(),
    };
    await this.memoryRepo.saveLayer(
      new MemoryLayerVO({
        founderId,
        layer,
        payload: merged,
        confidence,
        dataPoints: 1,
        lastUpdatedAt: now,
        lastCycleId: null,
      }),
      tx,
    );
  }

  /**
   * Create the founder.voice_versions row from voice answers, only if the opening exists.
   * Only opening_pattern (Q7) and cta_style (Q10) carry intake signal; every other NOT NULL
   * column is set to its enum's neutral member (not a per-founder assumption — PRD RISK 1).
   * specificity_level has no UNKNOWN/UNSET member, so the non-committal midpoint SOMETIMES is
   * used; it (and closing_pattern) are not read by the context-builder.
   */
  private async seedVoiceVersion(founderId: string, s: SignalMap, tx: unknown): Promise<void> {
    if (!isStrong(s.VOICE_OPENING_EXAMPLE, this.minStrongLen)) return; // nothing reliable to seed
    await this.voiceRepo.upsertFromIntake(
      {
        founderId,
        versionNumber: 1,
        derivedFrom: 'INTAKE',
        openingPattern: this.pick(s.VOICE_OPENING_EXAMPLE) ?? '',
        ctaStyle: inferCtaStyle(s.VOICE_CTA_EXAMPLE),
        // neutral members — no intake source:
        sentenceRhythm: 'UNKNOWN',
        closingPattern: '',
        convictionPosture: 'UNKNOWN',
        vulnerabilityLevel: 'NONE',
        specificityLevel: 'SOMETIMES',
      },
      tx,
    );
  }

  /** target * (strong answers / contributing answers); 0 ⇒ do not seed. Never exceeds target. */
  private seedConfidence(target: number, contributing: Array<string | undefined>): number {
    const total = contributing.length;
    if (total === 0) return 0;
    const strong = contributing.filter((v) => isStrong(v, this.minStrongLen)).length;
    if (strong === 0) return 0;
    return round2(target * (strong / total));
  }

  private collectEvents(
    acc: IntelligenceEvent[],
    founderId: string,
    layer: MemoryLayer,
    signalTypes: string[],
    s: SignalMap,
  ): void {
    if (!this.config.intakeEventType) return; // gap documented elsewhere
    for (const st of signalTypes) {
      const v = s[st];
      if (isStrong(v, this.minStrongLen)) acc.push(this.buildEvent(founderId, layer, st, v!, false));
    }
  }

  private buildEvent(
    founderId: string,
    layer: MemoryLayer,
    signalType: string,
    value: string,
    quarantined: boolean,
  ): IntelligenceEvent {
    return {
      // Deterministic id ⇒ append is idempotent on CompleteIntake replay (table is append-only).
      id: `intake:${founderId}:${signalType}`,
      founderId,
      layer,
      eventType: this.config.intakeEventType!, // founder-stated
      content: { signal_type: signalType, value },
      confidence: quarantined ? 0 : undefined,
      quarantineStatus: quarantined ? 'QUARANTINED' : 'ACTIVE',
      emittedAt: this.clock.now(),
      // Remaining IntelligenceEvent fields are populated by the real entity when an
      // intakeEventType exists; production wiring passes undefined so this path is inert.
    } as unknown as IntelligenceEvent;
  }

  private pick(v: string | undefined): string | undefined {
    return isStrong(v, this.minStrongLen) ? v!.trim() : undefined;
  }
}

export interface IntakeSeedResult {
  founderId: string;
  seededLayers: Record<string, number>;
  intelligenceEvents: number;
}

// ── pure helpers (exported for unit tests) ─────────────────────────────────────

export function toSignalMap(raw: RawSignal[]): SignalMap {
  const m: SignalMap = {};
  for (const { signal_type, value } of raw) m[signal_type] = value; // last write wins
  return m;
}

export function isStrong(v: string | undefined, minLen = 15): boolean {
  return typeof v === 'string' && v.trim().length >= minLen;
}

function compactArr(vals: Array<string | undefined>): string[] {
  return vals.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
}

/** Lightweight CTA-style inference from the Q10 example. Conservative defaults to INVITATION. */
export function inferCtaStyle(example: string | undefined): 'INVITATION' | 'DIRECT' | 'SOFT' | 'NONE' {
  if (!example || !example.trim()) return 'NONE';
  const t = example.toLowerCase();
  if (/\b(buy|book|sign up|apply|join now|get started|purchase|enrol)\b/.test(t)) return 'DIRECT';
  if (/\?\s*$/.test(example.trim()) || /\b(if you|when you|maybe|might|curious)\b/.test(t)) return 'SOFT';
  return 'INVITATION';
}
