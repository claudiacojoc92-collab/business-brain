import type { PipelineContext } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import type { Pseudonymiser } from '../context-builder/pseudonymiser';
import { validateLLMOutput } from '../validation/universal-validators';
import { depseudonymise } from '../context-builder/depseudonymiser';
import { hasPiiPlaceholders } from '../validation/pii-detector';
import { z } from 'zod';

const CommitOutputSchema = z.object({
  mode:                    z.string(),
  mode_reason:             z.string(),
  belief_target_primary:   z.string(),
  belief_gap_addressed:    z.string(),
  audience_segment:        z.string(),
  relationship_move_type:  z.string(),
  relationship_move_desc:  z.string(),
  conviction_angle:        z.string(),
  strategic_purpose:       z.string(),
  piece_objectives:        z.array(z.record(z.unknown())),
  forward_question:        z.object({
    question:     z.string(),
    target_layer: z.number(),
    priority:     z.string(),
  }).nullable(),
});

/**
 * S11 — Decision Commit (PR-009)
 * LLM: MEDIUM tier.
 * Calls depseudonymiser to restore PII before persisting the brief.
 * Source: Prompt Registry V1 PR-009, Corrections Addendum V1 F008.
 */
export async function runS11DecisionCommit(
  context:       PipelineContext,
  llmRouter:     LLMRouter,
  pseudonymiser: Pseudonymiser,
): Promise<PipelineContext> {
  const response = await llmRouter.call({
    promptId:  'PR-009',
    variables: {
      SELECTED_HYPOTHESIS:  JSON.stringify(context.selectedHypothesis),
      CONFIDENCE_ASSESSMENT:JSON.stringify(context.confidenceAssessment),
      CRITIQUE_OUTCOME:     context.critiqueOutcome ?? 'CONFIRMED',
      FOUNDER_SNAPSHOT:     JSON.stringify(context.founderSnapshot),
      HARD_CONSTRAINTS:     JSON.stringify(context.hardConstraints),
      SOFT_CONSTRAINTS:     JSON.stringify(context.softConstraints),
    },
  });

  const result = await validateLLMOutput(response.content, CommitOutputSchema);

  if (result.isErr) {
    return {
      ...context,
      errors: [...context.errors, `S11: ${result.error.message}`],
    };
  }

  // Depseudonymise before persisting (F008)
  const rawBrief = result.value as unknown as Record<string, unknown>;
  const restoredBrief = depseudonymise(rawBrief, pseudonymiser);

  // Final PII check — should find no placeholders after restore
  const briefJson = JSON.stringify(restoredBrief);
  if (hasPiiPlaceholders(briefJson)) {
    return {
      ...context,
      errors: [...context.errors, 'S11: PII placeholders detected in committed brief after restoration.'],
    };
  }

  return {
    ...context,
    committedBrief: restoredBrief,
  };
}
