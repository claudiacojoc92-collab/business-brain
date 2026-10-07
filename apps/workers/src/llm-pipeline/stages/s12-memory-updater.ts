import type { PipelineContext } from '../pipeline-context';
import type { LLMRouter } from '@bb/infrastructure';
import { validateLLMOutput } from '../validation/universal-validators';
import { z } from 'zod';
import type { IntelligenceEventPayload } from '@bb/domain';
import { generateId } from '@bb/shared';
import { INTELLIGENCE_EVENT_INCREASE_MAX_DELTA } from '@bb/shared';

const MemoryUpdateSchema = z.object({
  intelligence_events: z.array(z.object({
    layer:                z.string(),
    event_type:           z.enum(['OBSERVATIONAL','INFERENTIAL','CONFIDENCE','BEHAVIOURAL','OUTCOME']),
    content:              z.record(z.unknown()),
    confidence:           z.number().min(0).max(1),
    reasoning:            z.string().optional(),
    confidence_direction: z.enum(['INCREASE','DECREASE']).nullable().optional(),
    confidence_delta:     z.number().nullable().optional(),
    source_signal_ids:    z.array(z.string()),
    replaces_pattern_id:  z.string().nullable().optional(),
  })),
  forward_question: z.object({
    question:     z.string(),
    target_layer: z.number().int().min(1).max(9),
    priority:     z.enum(['HIGH','MEDIUM','LOW']),
  }).nullable(),
});

/**
 * S12 — Memory Updater (PR-010)
 * LLM: MEDIUM tier.
 * F002: caps INCREASE confidence_delta at 0.20.
 * Produces IntelligenceEvents and optional ForwardQuestion.
 * Source: Prompt Registry V1 PR-010, Corrections Addendum V1 F002.
 */
export async function runS12MemoryUpdater(
  context:   PipelineContext,
  llmRouter: LLMRouter,
): Promise<PipelineContext> {
  const response = await llmRouter.call({
    promptId:  'PR-010',
    variables: {
      COMMITTED_BRIEF:  JSON.stringify(context.committedBrief),
      SITUATION_MODEL:  JSON.stringify(context.situationModel),
      MEMORY_PACKAGE:   JSON.stringify(context.memoryPackage),
      TYPED_SIGNALS:    JSON.stringify(context.typedSignals),
      FOUNDER_SNAPSHOT: JSON.stringify(context.founderSnapshot),
    },
  });

  const result = await validateLLMOutput(response.content, MemoryUpdateSchema);

  if (result.isErr) {
    return {
      ...context,
      errors: [...context.errors, `S12: ${result.error.message}`],
    };
  }

  // F002: cap INCREASE confidence_delta at 0.20
  const intelligenceEvents: IntelligenceEventPayload[] = result.value.intelligence_events.map((e) => {
    let delta = e.confidence_delta ?? null;
    if (e.confidence_direction === 'INCREASE' && delta !== null) {
      delta = Math.min(delta, INTELLIGENCE_EVENT_INCREASE_MAX_DELTA);
    }
    return {
      eventId:             generateId(),
      layer:               e.layer,
      eventType:           e.event_type,
      content:             e.content,
      confidence:          e.confidence,
      reasoning:           e.reasoning,
      confidenceDirection: e.confidence_direction ?? undefined,
      confidenceDelta:     delta ?? undefined,
      sourceSignalIds:     e.source_signal_ids,
      replacesPatternId:   e.replaces_pattern_id ?? undefined,
      quarantineStatus:    'APPLIED' as const,
    };
  });

  return {
    ...context,
    intelligenceEvents,
  };
}
