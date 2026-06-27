import type { PipelineContext, Hypothesis } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import { validateLLMOutput } from '../validation/universal-validators';
import { generateId } from '@bb/shared';
import { HYPOTHESIS_MIN_COUNT, HYPOTHESIS_MAX_COUNT } from '@bb/shared';
import { z } from 'zod';

const HypothesisSchema = z.object({
  hypotheses: z.array(z.object({
    mode:                   z.enum(['AUTHORITY', 'TRUST', 'EDUCATION', 'CONVERSION']),
    belief_target:          z.string(),
    rationale:              z.string(),
    confidence_contribution:z.number().min(0).max(1),
  })).min(HYPOTHESIS_MIN_COUNT).max(HYPOTHESIS_MAX_COUNT),
});

/**
 * S05 — Hypothesis Generator (PR-004)
 * LLM: MEDIUM tier.
 * Generates 3-5 marketing hypotheses ranked by potential.
 * Source: Prompt Registry V1 PR-004.
 */
export async function runS05HypothesisGenerator(
  context:   PipelineContext,
  llmRouter: LLMRouter,
): Promise<PipelineContext> {
  const response = await llmRouter.call({
    promptId:  'PR-004',
    variables: {
      SITUATION_MODEL:     JSON.stringify(context.situationModel),
      MEMORY_INTERROGATION:JSON.stringify(context.memoryInterrogation),
      FOUNDER_SNAPSHOT:    JSON.stringify(context.founderSnapshot),
      MEMORY_PACKAGE:      JSON.stringify(context.memoryPackage),
    },
  });

  const result = await validateLLMOutput(response.content, HypothesisSchema);

  if (result.isErr) {
    return {
      ...context,
      errors: [...context.errors, `S05: ${result.error.message}`],
    };
  }

  const hypotheses: Hypothesis[] = result.value.hypotheses.map((h) => ({
    hypothesisId:           generateId(),
    mode:                   h.mode,
    beliefTarget:           h.belief_target,
    rationale:              h.rationale,
    confidenceContribution: h.confidence_contribution,
  }));

  return { ...context, hypotheses };
}
