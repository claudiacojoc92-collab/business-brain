import type { PipelineContext, TypedSignal } from '../pipeline-context';

/**
 * S01 — Signal Typer
 * Deterministic. No LLM call.
 * Types each raw signal with a concept, direction, and significance score.
 * Source: Prompt Registry V1 Stage 01.
 */
export async function runS01SignalTyper(
  context: PipelineContext,
): Promise<PipelineContext> {
  const typedSignals: TypedSignal[] = context.rawSignals.map((signal) => ({
    ...signal,
    typedConcept:      deriveTypedConcept(signal.signalType),
    direction:         null,
    significanceScore: deriveSignificance(signal.signalType),
  }));

  return { ...context, typedSignals };
}

function deriveTypedConcept(signalType: string): string | null {
  const conceptMap: Record<string, string> = {
    PLATFORM:    'engagement_level',
    BEHAVIOURAL: 'founder_behaviour',
    OUTCOME:     'business_result',
    TEMPORAL:    'timing_pattern',
  };
  return conceptMap[signalType] ?? null;
}

function deriveSignificance(signalType: string): number {
  const significanceMap: Record<string, number> = {
    OUTCOME:     0.9,
    BEHAVIOURAL: 0.7,
    PLATFORM:    0.5,
    TEMPORAL:    0.4,
  };
  return significanceMap[signalType] ?? 0.5;
}
