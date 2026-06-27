import type { MarketingMode } from '@bb/shared';
import type { ForwardQuestion } from '@bb/domain';
import type { IntelligenceEventPayload, CritiqueOutcome } from '@bb/domain';

/**
 * The shared context object passed through all 12 pipeline stages.
 * Each stage reads from context and writes its outputs back.
 * Source: MDE Engineering Specification V1, Prompt Registry V1.
 */
export interface FounderSnapshot {
  founderId:     string;
  name:          string;     // pseudonymised before LLM calls
  businessName:  string;     // pseudonymised
  offer: {
    name:           string;  // pseudonymised
    primaryPromise: string;  // pseudonymised
    priceTier:      string;
    availability:   string;
    trustMultiplier:number;
  };
  audience: {
    description:       string;  // pseudonymised
    sophisticationLevel:string;
    primaryPlatform:   string;
    emotionalRegister: string;
    avoidPhrases:      string[];
  };
  voice: {
    sentenceRhythm:     string;
    openingPattern:     string;
    convictionPosture:  string;
    ctaStyle:           string;
    vulnerabilityLevel: string;
  };
  conviction: {
    statement:  string;  // pseudonymised
    domain:     string;
    confidence: number;
  };
}

export interface RawSignal {
  signalId:    string;
  signalType:  string;
  value:       string;
  collectedAt: string;
}

export interface TypedSignal extends RawSignal {
  typedConcept:      string | null;
  direction:         string | null;
  significanceScore: number | null;
}

export interface Hypothesis {
  hypothesisId: string;
  mode:         MarketingMode;
  beliefTarget: string;
  rationale:    string;
  confidenceContribution: number;
}

export interface ConfidenceAssessment {
  briefConfidence:    number;
  label:              'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  thresholdAction:    'PROCEED' | 'STRENGTHEN' | 'FALLBACK';
  contributingFactors:Record<string, number>;
}

export interface PipelineContext {
  // Job identity
  cycleId:      string;
  founderId:    string;
  cycleNumber:  number;
  correlationId:string;
  traceId:      string;

  // Stage inputs
  founderSnapshot:     FounderSnapshot | null;
  rawSignals:          RawSignal[];
  memoryPackage:       Record<string, unknown>;

  // Stage outputs (populated progressively)
  typedSignals:        TypedSignal[];
  situationModel:      Record<string, unknown> | null;
  forwardQuestion:     ForwardQuestion | null;
  memoryInterrogation: Record<string, unknown> | null;
  hypotheses:          Hypothesis[];
  evaluation:          Record<string, unknown> | null;
  hardConstraints:     string[];
  softConstraints:     string[];
  selectedHypothesis:  Hypothesis | null;
  selectedMode:        MarketingMode | null;
  confidenceAssessment:ConfidenceAssessment | null;
  critiqueOutcome:     CritiqueOutcome | null;
  critiqueReturnCount: number;
  committedBrief:      Record<string, unknown> | null;
  intelligenceEvents:  IntelligenceEventPayload[];

  // Pipeline state
  isFallback:    boolean;
  fallbackReason:string | null;
  errors:        string[];
}

export function createInitialContext(params: {
  cycleId:      string;
  founderId:    string;
  cycleNumber:  number;
  correlationId:string;
  traceId:      string;
}): PipelineContext {
  return {
    ...params,
    founderSnapshot:     null,
    rawSignals:          [],
    memoryPackage:       {},
    typedSignals:        [],
    situationModel:      null,
    forwardQuestion:     null,
    memoryInterrogation: null,
    hypotheses:          [],
    evaluation:          null,
    hardConstraints:     [],
    softConstraints:     [],
    selectedHypothesis:  null,
    selectedMode:        null,
    confidenceAssessment:null,
    critiqueOutcome:     null,
    critiqueReturnCount: 0,
    committedBrief:      null,
    intelligenceEvents:  [],
    isFallback:          false,
    fallbackReason:      null,
    errors:              [],
  };
}
