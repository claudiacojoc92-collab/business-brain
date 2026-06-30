import type { KyselyDB } from '../client';
import type { IInternalBriefRepository } from '@bb/domain';
import { InternalBrief } from '@bb/domain';

/**
 * PostgreSQL read-back implementation of IInternalBriefRepository.
 *
 * Reads the committed brief from cycle.internal_briefs (written by
 * PgInternalBriefProjection). NUMERIC confidence columns come back from pg as
 * strings, so they are Number()-converted before constructing the domain entity.
 * JSONB columns (voice_parameters, *_blocks/boundaries/constraints, audience_language,
 * piece_objectives) are returned pre-parsed by pg and are used as-is.
 * Source: Implementation Spec V1 Section 08, Database Design V1 Section 05.
 */
export class PgInternalBriefRepository implements IInternalBriefRepository {
  constructor(private readonly db: KyselyDB) {}

  async findByCycleId(cycleId: string, tx?: unknown): Promise<InternalBrief | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    const row = await db
      .selectFrom('cycle.internal_briefs')
      .selectAll()
      .where('cycle_id', '=', cycleId)
      .executeTakeFirst();
    return row ? this.toDomain(row) : null;
  }

  async findByBriefId(briefId: string, tx?: unknown): Promise<InternalBrief | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    const row = await db
      .selectFrom('cycle.internal_briefs')
      .selectAll()
      .where('id', '=', briefId)
      .executeTakeFirst();
    return row ? this.toDomain(row) : null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toDomain(row: any): InternalBrief {
    return new InternalBrief({
      id:                    row.id,
      cycleId:               row.cycle_id,
      founderId:             row.founder_id,
      mode:                  row.mode,
      modeConfidence:        Number(row.mode_confidence),
      modeReason:            row.mode_reason,
      beliefTargetPrimary:   row.belief_target_primary,
      beliefTargetSecondary: row.belief_target_secondary ?? null,
      beliefGapAddressed:    row.belief_gap_addressed,
      audienceSegment:       row.audience_segment,
      audienceTemperature:   row.audience_temperature,
      relationshipMoveType:  row.relationship_move_type,
      relationshipMoveDesc:  row.relationship_move_desc,
      voiceParameters:       row.voice_parameters ?? {},
      hardBlocks:            row.hard_blocks ?? [],
      voiceBoundaries:       row.voice_boundaries ?? [],
      offerConstraints:      row.offer_constraints ?? [],
      convictionAngle:       row.conviction_angle,
      audienceLanguage:      row.audience_language ?? {},
      strategicPurpose:      row.strategic_purpose,
      founderFocus:          row.founder_focus ?? null,
      campaignId:            row.campaign_id ?? null,
      pieceObjectives:       row.piece_objectives ?? [],
      briefConfidence:       Number(row.brief_confidence),
      uniquenessScore:       Number(row.uniqueness_score),
      validationResult:      row.validation_result,
      reviewFlag:            row.review_flag,
      memoryConfidence:      Number(row.memory_confidence),
      recalibrationNeeded:   row.recalibration_needed,
      isFallback:            row.is_fallback,
      committedAt:           new Date(row.committed_at),
    });
  }
}
