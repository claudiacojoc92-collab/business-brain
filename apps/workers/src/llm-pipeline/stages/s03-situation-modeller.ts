import type { PipelineContext } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import { validateLLMOutput } from '../validation/universal-validators';
import { z } from 'zod';

const SituationModelSchema = z.object({
  audience_temperature:     z.enum(['COLD', 'WARM', 'HOT']),
  situation_delta_magnitude:z.enum(['SIGNIFICANT', 'MODERATE', 'MINIMAL', 'STABLE']),
  completeness_score:       z.number().min(0).max(1),
  relationship_status:      z.string(),
  key_observations:         z.array(z.string()),
});

/**
 * S03 — Situation Modeller (PR-002)
 * LLM: MEDIUM tier.
 * Models the current founder-audience relationship state.
 * Source: Prompt Registry V1 PR-002.
 */
export async function runS03SituationModeller(
  context:   PipelineContext,
  llmRouter: LLMRouter,
): Promise<PipelineContext> {
  const response = await llmRouter.call({
    promptId:  'PR-002',
    variables: {
      TYPED_SIGNALS:    JSON.stringify(context.typedSignals),
      FOUNDER_SNAPSHOT: JSON.stringify(context.founderSnapshot),
      MEMORY_PACKAGE:   JSON.stringify(context.memoryPackage),
      SITUATION_SUMMARY:JSON.stringify(context.situationModel),
    },
  });

  const result = await validateLLMOutput(response.content, SituationModelSchema);

  if (result.isErr) {
    return {
      ...context,
      errors: [...context.errors, `S03: ${result.error.message}`],
    };
  }

  return {
    ...context,
    situationModel: {
      ...(context.situationModel ?? {}),
      audienceTemperature:     result.value.audience_temperature,
      situationDeltaMagnitude: result.value.situation_delta_magnitude,
      completenessScore:       result.value.completeness_score,
      relationshipStatus:      result.value.relationship_status,
      keyObservations:         result.value.key_observations,
    },
  };
}
