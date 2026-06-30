import type { KyselyDB } from '../client';
import { generateId } from '@bb/shared';

/**
 * Writes the committed InternalBrief into the cycle.internal_briefs read model.
 * Called synchronously by CommitBriefHandler within the commit transaction.
 *
 * The brief argument is the raw committed-brief object produced by the LLM
 * pipeline (S11 main path or S11F fallback), so field names are read
 * defensively. Columns not produced by the pipeline default safely.
 * Source: Repository Structure V1 Section 02, Database Design V1 Section 05.
 */
export class PgInternalBriefProjection {
  constructor(private readonly db: KyselyDB) {}

  async upsert(
    brief:          Record<string, unknown>,
    cycleId:        string,
    founderId:      string,
    isFallback:     boolean,
    fallbackReason: string | null,
    tx?:            unknown,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;

    const str = (key: string): string =>
      typeof brief[key] === 'string' ? (brief[key] as string) : '';

    // S11 uses belief_target_primary; S11F fallback uses belief_target
    const beliefPrimary = str('belief_target_primary') || str('belief_target');
    const pieceObjectives = Array.isArray(brief['piece_objectives'])
      ? (brief['piece_objectives'] as unknown[])
      : [];
    // Founder-facing leverage sentence (S11/PR-009 only). NULL unless a non-empty
    // string was produced — so fallback briefs (S11F) and absent values stay silent.
    const ff = brief['founder_focus'];
    const founderFocus = typeof ff === 'string' && ff.trim().length > 0 ? ff : null;

    const row = {
      id:                      generateId(),
      cycle_id:                cycleId,
      founder_id:              founderId,
      mode:                    str('mode') || 'AUTHORITY',
      mode_confidence:         0,
      mode_reason:             str('mode_reason') || (fallbackReason ?? ''),
      belief_target_primary:   beliefPrimary,
      belief_target_secondary: null,
      belief_gap_addressed:    str('belief_gap_addressed'),
      audience_segment:        str('audience_segment'),
      audience_temperature:    'UNKNOWN',
      relationship_move_type:  str('relationship_move_type'),
      relationship_move_desc:  str('relationship_move_desc'),
      voice_parameters:        '{}',
      hard_blocks:             '[]',
      voice_boundaries:        '[]',
      offer_constraints:       '[]',
      conviction_angle:        str('conviction_angle'),
      audience_language:       '{}',
      strategic_purpose:       str('strategic_purpose'),
      founder_focus:           founderFocus,
      campaign_id:             null,
      piece_objectives:        JSON.stringify(pieceObjectives),
      brief_confidence:        0,
      uniqueness_score:        50,
      validation_result:       'COMMITTED',
      review_flag:             false,
      memory_confidence:       0,
      recalibration_needed:    false,
      is_fallback:             isFallback,
      committed_at:            new Date().toISOString(),
    };

    // On re-commit, update everything except the primary key and conflict key.
    const updateSet: Record<string, unknown> = { ...row };
    delete updateSet.id;
    delete updateSet.cycle_id;

    await db
      .insertInto('cycle.internal_briefs')
      .values(row)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .onConflict((oc: any) => oc.column('cycle_id').doUpdateSet(updateSet))
      .execute();
  }
}
