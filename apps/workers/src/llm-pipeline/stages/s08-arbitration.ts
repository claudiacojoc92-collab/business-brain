import type { PipelineContext } from '../pipeline-context';
import type { MarketingMode } from '@bb/shared';

/**
 * S08 — Arbitration
 * Deterministic. No LLM call.
 * Selects the winning hypothesis from the evaluation, applying hard constraints.
 * Source: Prompt Registry V1 Stage 08.
 */
export async function runS08Arbitration(
  context: PipelineContext,
): Promise<PipelineContext> {
  const evaluation = context.evaluation;
  if (!evaluation) {
    return {
      ...context,
      errors: [...context.errors, 'S08: No evaluation output to arbitrate.'],
    };
  }

  const scoredHypotheses = evaluation['scored_hypotheses'] as Array<{
    hypothesis_id: string;
    mode: string;
    score: number;
  }>;

  if (!Array.isArray(scoredHypotheses) || scoredHypotheses.length === 0) {
    return {
      ...context,
      errors: [...context.errors, 'S08: No scored hypotheses available.'],
    };
  }

  // Filter hypotheses blocked by hard constraints
  const filtered = scoredHypotheses.filter((h) => {
    if (h.mode === 'CONVERSION' && context.hardConstraints.includes('NO_CONVERSION_MODE')) {
      return false;
    }
    return true;
  });

  const winning = filtered.reduce(
    (best, current) => (current.score > best.score ? current : best),
    filtered[0] ?? scoredHypotheses[0]!,
  );

  if (!winning) {
    return {
      ...context,
      errors: [...context.errors, 'S08: Could not select a winning hypothesis.'],
    };
  }

  const selectedHypothesis = context.hypotheses.find(
    (h) => h.hypothesisId === winning.hypothesis_id,
  ) ?? context.hypotheses[0] ?? null;

  return {
    ...context,
    selectedHypothesis,
    selectedMode: selectedHypothesis?.mode as MarketingMode ?? null,
  };
}
