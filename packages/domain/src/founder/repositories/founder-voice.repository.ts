import type {
  SentenceRhythm,
  ConvictionPosture,
  VulnerabilityLevel,
  SpecificityLevel,
  CtaStyle,
  VoiceDerivedFrom,
} from '../value-objects/founder-voice.vo';

/**
 * Input for seeding the founder's first voice version from completed intake.
 * Only opening_pattern (Q7) and cta_style (Q10) carry real intake signal; the
 * remaining NOT NULL columns are set to each enum's neutral member by the caller
 * (IntakeMemoryMapper) because the interview does not capture them. Behavioural
 * learning overwrites them later.
 */
export interface UpsertVoiceFromIntakeInput {
  founderId: string;
  versionNumber: number;
  derivedFrom: VoiceDerivedFrom;
  sentenceRhythm: SentenceRhythm;
  openingPattern: string;
  closingPattern: string;
  convictionPosture: ConvictionPosture;
  vulnerabilityLevel: VulnerabilityLevel;
  specificityLevel: SpecificityLevel;
  ctaStyle: CtaStyle;
}

/** Minimal projection of the current voice version (read side). */
export interface FounderVoiceRecord {
  founderId: string;
  versionNumber: number;
  openingPattern: string;
  ctaStyle: CtaStyle;
}

/**
 * Repository for founder.voice_versions writes/reads outside the FounderProfile
 * aggregate hydration path. Implementation lives in packages/infrastructure/.
 *
 * The founder aggregate hydration reads voice; this port exists so intake
 * seeding can create the initial voice_versions row without rebuilding the
 * aggregate. Source: Database Design V1 Section 04 (founder.voice_versions).
 */
export interface IFounderVoiceRepository {
  /**
   * Insert the intake-seeded current voice version.
   * Idempotent: a no-op if a current voice already exists (CompleteIntake replay).
   * @param tx - Active database transaction (runs inside CompleteIntake's tx)
   */
  upsertFromIntake(input: UpsertVoiceFromIntakeInput, tx: unknown): Promise<void>;

  /** Return the current (is_current = true) voice version, or null. */
  findActive(founderId: string): Promise<FounderVoiceRecord | null>;
}
