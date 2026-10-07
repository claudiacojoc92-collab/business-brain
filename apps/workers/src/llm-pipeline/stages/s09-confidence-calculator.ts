import type { PipelineContext, ConfidenceAssessment } from '../pipeline-context';
import { CONFIDENCE_HALLUCINATION_PENALTY } from '@bb/shared';

/**
 * S09 — Confidence Calculator
 * DETERMINISTIC. No LLM call. Pure formula.
 * F005 CORRECTION: S09 runs BEFORE S10 (Critic).
 * F002: confidence_delta for INCREASE events capped at 0.20.
 * Source: Prompt Registry V1 PR-007 (formula specification), Corrections Addendum V1 F002/F005.
 */
export async function runS09ConfidenceCalculator(
  context: PipelineContext,
): Promise<PipelineContext> {
  if (!context.selectedHypothesis) {
    return {
      ...context,
      errors: [...context.errors, 'S09: No selected hypothesis to assess confidence for.'],
    };
  }

  // Confidence inputs (all weighted to sum to 1.0)
  const weights = {
    memoryConfidence:       0.30,
    situationCompleteness:  0.20,
    hypothesisConfidence:   0.20,
    signalCount:            0.15,
    cycleMaturity:          0.15,
  };

  const situationModel = context.situationModel ?? {};
  const memoryLayers   = Object.values(
    (context.memoryPackage['layers'] as Record<string, { confidence: number }>) ?? {},
  );

  const memoryConfidence = memoryLayers.length > 0
    ? memoryLayers.reduce((sum, l) => sum + l.confidence, 0) / memoryLayers.length
    : 0.3;

  const situationCompleteness =
    (situationModel['completeness_score'] as number | undefined) ??
    (situationModel['completenessScore'] as number | undefined) ??
    0.5;

  const hypothesisConfidence =
    context.selectedHypothesis.confidenceContribution;

  const signalScore = Math.min(context.typedSignals.length / 10, 1.0);

  const maturityScore = Math.min(context.cycleNumber / 12, 1.0);

  let briefConfidence =
    memoryConfidence      * weights.memoryConfidence +
    situationCompleteness * weights.situationCompleteness +
    hypothesisConfidence  * weights.hypothesisConfidence +
    signalScore           * weights.signalCount +
    maturityScore         * weights.cycleMaturity;

  // Apply hallucination penalty if signals are sparse
  if (context.typedSignals.length < 3) {
    briefConfidence = Math.max(
      briefConfidence - CONFIDENCE_HALLUCINATION_PENALTY,
      0,
    );
  }

  // Cap at 1.0
  briefConfidence = Math.min(briefConfidence, 1.0);

  // Determine label and action
  let label: ConfidenceAssessment['label'];
  let thresholdAction: ConfidenceAssessment['thresholdAction'];

  if (briefConfidence >= 0.70) {
    label = 'HIGH';
    thresholdAction = 'PROCEED';
  } else if (briefConfidence >= 0.50) {
    label = 'MEDIUM';
    thresholdAction = 'PROCEED';
  } else if (briefConfidence >= 0.35) {
    label = 'LOW';
    thresholdAction = 'STRENGTHEN';
  } else {
    label = 'INSUFFICIENT';
    thresholdAction = 'FALLBACK';
  }

  const confidenceAssessment: ConfidenceAssessment = {
    briefConfidence,
    label,
    thresholdAction,
    contributingFactors: {
      memoryConfidence,
      situationCompleteness,
      hypothesisConfidence,
      signalScore,
      maturityScore,
    },
  };

  return { ...context, confidenceAssessment };
}
