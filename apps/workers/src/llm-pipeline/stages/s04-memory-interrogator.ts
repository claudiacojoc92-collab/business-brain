import type { PipelineContext } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import { validateLLMOutput } from '../validation/universal-validators';
import { z } from 'zod';

const MemoryInterrogationSchema = z.object({
  relevant_patterns:  z.array(z.string()),
  memory_gaps:        z.array(z.string()),
  forward_question_addressed: z.boolean(),
  interrogation_summary:      z.string(),
});

/**
 * S04 — Memory Interrogator (PR-003)
 * LLM: MEDIUM tier.
 * F011: ForwardQuestion is fetched and included as priority interrogation target.
 * Marked consumed only on cycle COMMIT — not on read.
 * Source: Prompt Registry V1 PR-003, Corrections Addendum V1 F011.
 */
export async function runS04MemoryInterrogator(
  context:   PipelineContext,
  llmRouter: LLMRouter,
): Promise<PipelineContext> {
  const response = await llmRouter.call({
    promptId:  'PR-003',
    variables: {
      MEMORY_PACKAGE:    JSON.stringify(context.memoryPackage),
      SITUATION_MODEL:   JSON.stringify(context.situationModel),
      FOUNDER_SNAPSHOT:  JSON.stringify(context.founderSnapshot),
      // F011: include forward question as priority target
      FORWARD_QUESTION:  context.forwardQuestion
        ? JSON.stringify({
            question:    context.forwardQuestion.question,
            targetLayer: context.forwardQuestion.targetLayer,
            priority:    context.forwardQuestion.priority,
          })
        : 'null',
    },
  });

  const result = await validateLLMOutput(response.content, MemoryInterrogationSchema);

  if (result.isErr) {
    return {
      ...context,
      errors: [...context.errors, `S04: ${result.error.message}`],
    };
  }

  return {
    ...context,
    memoryInterrogation: {
      relevantPatterns:          result.value.relevant_patterns,
      memoryGaps:                result.value.memory_gaps,
      forwardQuestionAddressed:  result.value.forward_question_addressed,
      interrogationSummary:      result.value.interrogation_summary,
    },
  };
}
