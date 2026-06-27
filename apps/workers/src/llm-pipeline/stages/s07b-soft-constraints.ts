import type { PipelineContext } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import { validateLLMOutput } from '../validation/universal-validators';
import { z } from 'zod';

const SoftConstraintsSchema = z.object({
  voice_boundaries:  z.array(z.string()),
  offer_constraints: z.array(z.string()),
  timing_constraints:z.array(z.string()),
});

/**
 * S07b — Soft Constraints (PR-006)
 * LLM: MEDIUM tier.
 * Derives voice boundaries and offer constraints from memory.
 * Source: Prompt Registry V1 PR-006.
 */
export async function runS07bSoftConstraints(
  context:   PipelineContext,
  llmRouter: LLMRouter,
): Promise<PipelineContext> {
  const response = await llmRouter.call({
    promptId:  'PR-006',
    variables: {
      FOUNDER_SNAPSHOT: JSON.stringify(context.founderSnapshot),
      MEMORY_PACKAGE:   JSON.stringify(context.memoryPackage),
      HARD_CONSTRAINTS: JSON.stringify(context.hardConstraints),
    },
  });

  const result = await validateLLMOutput(response.content, SoftConstraintsSchema);

  if (result.isErr) {
    return {
      ...context,
      errors: [...context.errors, `S07b: ${result.error.message}`],
    };
  }

  const softConstraints = [
    ...result.value.voice_boundaries,
    ...result.value.offer_constraints,
    ...result.value.timing_constraints,
  ];

  return { ...context, softConstraints };
}
