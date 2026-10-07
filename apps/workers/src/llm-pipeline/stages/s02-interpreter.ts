import type { PipelineContext } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import { validateLLMOutput } from '../validation/universal-validators';
import { z } from 'zod';

const InterpreterOutputSchema = z.object({
  interpreted_signals: z.array(z.object({
    signal_id:        z.string(),
    signal_type:      z.string(),
    typed_concept:    z.string().nullable(),
    direction:        z.string().nullable(),
    significance_score:z.number(),
    interpretation:   z.string(),
  })),
  audience_temperature: z.enum(['COLD', 'WARM', 'HOT']),
  situation_summary:    z.string(),
});

/**
 * S02 — Interpreter (PR-001)
 * LLM: MEDIUM tier.
 * Interprets raw signals and classifies audience temperature.
 * Source: Prompt Registry V1 PR-001.
 */
export async function runS02Interpreter(
  context:   PipelineContext,
  llmRouter: LLMRouter,
): Promise<PipelineContext> {
  const response = await llmRouter.call({
    promptId:  'PR-001',
    variables: {
      SIGNALS:          JSON.stringify(context.typedSignals),
      FOUNDER_SNAPSHOT: JSON.stringify(context.founderSnapshot),
      MEMORY_PACKAGE:   JSON.stringify(context.memoryPackage),
    },
  });

  const result = await validateLLMOutput(response.content, InterpreterOutputSchema);

  if (result.isErr) {
    return {
      ...context,
      errors: [...context.errors, `S02: ${result.error.message}`],
    };
  }

  // Update typed signals with interpreter enrichment
  const updatedTyped = context.typedSignals.map((signal) => {
    const interpreted = result.value.interpreted_signals.find(
      (s) => s.signal_id === signal.signalId,
    );
    return interpreted
      ? {
          ...signal,
          typedConcept:      interpreted.typed_concept,
          direction:         interpreted.direction,
          significanceScore: interpreted.significance_score,
        }
      : signal;
  });

  return {
    ...context,
    typedSignals:   updatedTyped,
    situationModel: {
      audienceTemperature: result.value.audience_temperature,
      situationSummary:    result.value.situation_summary,
    },
  };
}
