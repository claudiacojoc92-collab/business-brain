import type { KyselyDB } from '../client';
import { generateId } from '@bb/shared';
import type {
  IFounderVoiceRepository,
  UpsertVoiceFromIntakeInput,
  FounderVoiceRecord,
} from '@bb/domain';

/**
 * PostgreSQL implementation of IFounderVoiceRepository.
 *
 * Writes the founder.voice_versions row seeded from completed intake.
 * Respects the partial unique index voice_versions_founder_current_unique
 * (one is_current row per founder) by skipping when a current voice exists,
 * which also makes CompleteIntake replay a no-op.
 * Source: Database Design V1 Section 04 (founder.voice_versions).
 */
export class PgFounderVoiceRepository implements IFounderVoiceRepository {
  constructor(private readonly db: KyselyDB) {}

  async upsertFromIntake(input: UpsertVoiceFromIntakeInput, tx: unknown): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;

    const existing = await db
      .selectFrom('founder.voice_versions')
      .select('id')
      .where('founder_id', '=', input.founderId)
      .where('is_current', '=', true)
      .executeTakeFirst();
    if (existing) return; // idempotent: a current voice already exists

    await db
      .insertInto('founder.voice_versions')
      .values({
        id:                  generateId(),
        founder_id:          input.founderId,
        version_number:      input.versionNumber,
        derived_from:        input.derivedFrom,
        sentence_rhythm:     input.sentenceRhythm,
        opening_pattern:     input.openingPattern,
        closing_pattern:     input.closingPattern,
        conviction_posture:  input.convictionPosture,
        vulnerability_level: input.vulnerabilityLevel,
        specificity_level:   input.specificityLevel,
        cta_style:           input.ctaStyle,
        is_current:          true,
      })
      .execute();
  }

  async findActive(founderId: string): Promise<FounderVoiceRecord | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('founder.voice_versions')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('is_current', '=', true)
      .executeTakeFirst();
    if (!row) return null;
    return {
      founderId:      row.founder_id,
      versionNumber:  row.version_number,
      openingPattern: row.opening_pattern,
      ctaStyle:       row.cta_style,
    };
  }
}
