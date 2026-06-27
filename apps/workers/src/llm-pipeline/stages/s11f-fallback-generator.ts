import type { PipelineContext } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import type { Pseudonymiser } from '../context-builder/pseudonymiser';
import { validateLLMOutput } from '../validation/universal-validators';
import { depseudonymise } from '../context-builder/depseudonymiser';
import { z } from 'zod';

const FallbackSchema = z.object({
  mode:              z.string(),
  belief_target:     z.string(),
  strategic_purpose: z.string(),
  piece_objectives:  z.array(z.record(z.unknown())),
  fallback_reason:   z.string(),
});

/**
 * S11F — Fallback Generator (PR-011)
 * LLM: MEDIUM tier.
 * Generates a safe generic brief when the main pipeline fails.
 * Source: Prompt Registry V1 PR-011.
 */
export async function runS11FallbackGenerator(
  context:       PipelineContext,
  llmRouter:     LLMRouter,
  pseudonymiser: Pseudonymiser,
): Promise<PipelineContext> {
  const response = await llmRouter.call({
    promptId:  'PR-011',
    variables: {
      FOUNDER_SNAPSHOT: JSON.stringify(context.founderSnapshot),
      ERRORS:           JSON.stringify(context.errors),
      CYCLE_NUMBER:     String(context.cycleNumber),
    },
  });

  const result = await validateLLMOutput(response.content, FallbackSchema);

  if (result.isErr) {
    // Fallback also failed — return context with error noted
    return {
      ...context,
      isFallback:    true,
      fallbackReason:'FALLBACK_GENERATOR_FAILED',
      errors:        [...context.errors, `S11F: ${result.error.message}`],
    };
  }

  const rawBrief = result.value as unknown as Record<string, unknown>;
  const restoredBrief = depseudonymise(rawBrief, pseudonymiser);

  return {
    ...context,
    committedBrief: restoredBrief,
    isFallback:     true,
    fallbackReason: result.value.fallback_reason,
  };
}
