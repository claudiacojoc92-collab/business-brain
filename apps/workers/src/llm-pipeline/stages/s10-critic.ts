import type { PipelineContext } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import { validateLLMOutput } from '../validation/universal-validators';
import { CRITIQUE_SECOND_ARG_MIN_WORDS } from '@bb/shared';
import { z } from 'zod';

const CritiqueSchema = z.object({
  outcome:         z.enum(['CONFIRMED', 'CONDITIONAL', 'MODIFIED', 'REJECTED', 'INCONCLUSIVE']),
  second_argument: z.string(),
  reasoning:       z.string(),
  modifications:   z.record(z.unknown()).optional(),
});

/**
 * S10 — Critic (PR-008)
 * LLM: STRONG tier ALWAYS. No fallback to MEDIUM permitted.
 * F005 CORRECTION: Runs AFTER S09 (Confidence Calculator).
 * Source: Prompt Registry V1 PR-008, Corrections Addendum V1 F005.
 */
export async function runS10Critic(
  context:   PipelineContext,
  llmRouter: LLMRouter,
): Promise<PipelineContext> {
  // The LLMRouter will use STRONG model because PR-008's modelTier = 'STRONG'
  // The router reads model tier from the prompt registry — no override needed here.
  const response = await llmRouter.call({
    promptId:  'PR-008',
    variables: {
      SELECTED_HYPOTHESIS:  JSON.stringify(context.selectedHypothesis),
      CONFIDENCE_ASSESSMENT:JSON.stringify(context.confidenceAssessment),
      FOUNDER_SNAPSHOT:     JSON.stringify(context.founderSnapshot),
      MEMORY_PACKAGE:       JSON.stringify(context.memoryPackage),
      HARD_CONSTRAINTS:     JSON.stringify(context.hardConstraints),
      SOFT_CONSTRAINTS:     JSON.stringify(context.softConstraints),
    },
  });

  const result = await validateLLMOutput(response.content, CritiqueSchema);

  if (result.isErr) {
    return {
      ...context,
      errors: [...context.errors, `S10: ${result.error.message}`],
    };
  }

  // Validate second_argument minimum word count
  const wordCount = result.value.second_argument.trim().split(/\s+/).length;
  if (wordCount < CRITIQUE_SECOND_ARG_MIN_WORDS) {
    return {
      ...context,
      errors: [
        ...context.errors,
        `S10: second_argument too short (${wordCount} words, minimum ${CRITIQUE_SECOND_ARG_MIN_WORDS}).`,
      ],
    };
  }

  return {
    ...context,
    critiqueOutcome:     result.value.outcome,
    critiqueReturnCount: context.critiqueReturnCount + 1,
  };
}
