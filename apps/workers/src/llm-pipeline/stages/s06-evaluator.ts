import type { PipelineContext } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import { validateLLMOutput } from '../validation/universal-validators';
import { validateCitationTags } from '../validation/citation-tag-validator';
import { z } from 'zod';

const EvaluatorOutputSchema = z.object({
  scored_hypotheses: z.array(z.object({
    hypothesis_id: z.string(),
    mode:          z.string(),
    score:         z.number().min(0).max(1),
    citation_tag:  z.string(),
    reasoning:     z.string(),
  })),
  recommended_hypothesis_id: z.string(),
});

/**
 * S06 — Evaluator (PR-005)
 * LLM: MEDIUM tier.
 * F015: validates citation tags on all scored hypotheses.
 * Source: Prompt Registry V1 PR-005, Corrections Addendum V1 F015.
 */
export async function runS06Evaluator(
  context:   PipelineContext,
  llmRouter: LLMRouter,
): Promise<PipelineContext> {
  const response = await llmRouter.call({
    promptId:  'PR-005',
    variables: {
      HYPOTHESES:      JSON.stringify(context.hypotheses),
      SITUATION_MODEL: JSON.stringify(context.situationModel),
      MEMORY_PACKAGE:  JSON.stringify(context.memoryPackage),
      FOUNDER_SNAPSHOT:JSON.stringify(context.founderSnapshot),
    },
  });

  const result = await validateLLMOutput(response.content, EvaluatorOutputSchema);

  if (result.isErr) {
    return {
      ...context,
      errors: [...context.errors, `S06: ${result.error.message}`],
    };
  }

  // F015: validate citation tags
  const citationCheck = validateCitationTags(result.value as Record<string, unknown>);
  if (!citationCheck.valid) {
    return {
      ...context,
      errors: [
        ...context.errors,
        `S06: Missing citation tags for hypotheses: ${citationCheck.missingCitations.join(', ')}`,
      ],
    };
  }

  return {
    ...context,
    evaluation: result.value as Record<string, unknown>,
  };
}
