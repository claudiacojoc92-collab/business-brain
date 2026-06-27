import { describe, it, expect } from 'vitest';
import { runS09ConfidenceCalculator } from '../../../llm-pipeline/stages/s09-confidence-calculator';
import { createInitialContext } from '../../../llm-pipeline/pipeline-context';
import type { PipelineContext, Hypothesis } from '../../../llm-pipeline/pipeline-context';

const BASE = createInitialContext({
  cycleId:      'cycle-01',
  founderId:    'founder-01',
  cycleNumber:  5,
  correlationId:'corr-01',
  traceId:      'trace-01',
});

function withHypothesis(ctx: PipelineContext, overrides: Partial<Hypothesis> = {}): PipelineContext {
  const hypothesis: Hypothesis = {
    hypothesisId:           'h-01',
    mode:                   'AUTHORITY',
    beliefTarget:           'That consistent posting builds authority.',
    rationale:              'Memory shows approval pattern on authority content.',
    confidenceContribution: 0.75,
    ...overrides,
  };
  return {
    ...ctx,
    selectedHypothesis: hypothesis,
    typedSignals:       [
      { signalId: 's1', signalType: 'PLATFORM', value: 'v', collectedAt: new Date().toISOString(), typedConcept: 'engagement_level', direction: null, significanceScore: 0.5 },
      { signalId: 's2', signalType: 'OUTCOME',  value: 'v', collectedAt: new Date().toISOString(), typedConcept: 'business_result',  direction: null, significanceScore: 0.9 },
      { signalId: 's3', signalType: 'BEHAVIOURAL',value:'v', collectedAt: new Date().toISOString(), typedConcept: 'founder_behaviour', direction: null, significanceScore: 0.7 },
    ],
    memoryPackage: {
      layers: {
        APPROVAL_INTELLIGENCE: { confidence: 0.7, dataPoints: 5 },
        EDIT_PATTERN_INTELLIGENCE: { confidence: 0.6, dataPoints: 3 },
      },
    },
    situationModel: { completenessScore: 0.8 },
  };
}

describe('S09 Confidence Calculator', () => {
  it('produces a ConfidenceAssessment with briefConfidence in [0,1]', async () => {
    const ctx    = withHypothesis(BASE);
    const result = await runS09ConfidenceCalculator(ctx);
    expect(result.confidenceAssessment).not.toBeNull();
    expect(result.confidenceAssessment?.briefConfidence).toBeGreaterThanOrEqual(0);
    expect(result.confidenceAssessment?.briefConfidence).toBeLessThanOrEqual(1);
  });

  it('returns PROCEED action when confidence is high', async () => {
    const ctx    = withHypothesis(BASE, { confidenceContribution: 0.95 });
    const result = await runS09ConfidenceCalculator(ctx);
    expect(['PROCEED', 'STRENGTHEN']).toContain(result.confidenceAssessment?.thresholdAction);
  });

  it('returns FALLBACK action when signals are very sparse and confidence low', async () => {
    const ctx = {
      ...withHypothesis(BASE, { confidenceContribution: 0.1 }),
      typedSignals:  [],
      memoryPackage: { layers: {} },
      situationModel:{ completenessScore: 0.1 },
    };
    const result = await runS09ConfidenceCalculator(ctx);
    expect(result.confidenceAssessment?.thresholdAction).toBe('FALLBACK');
  });

  it('adds error and returns unchanged when no selected hypothesis', async () => {
    const result = await runS09ConfidenceCalculator(BASE);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.confidenceAssessment).toBeNull();
  });
});
