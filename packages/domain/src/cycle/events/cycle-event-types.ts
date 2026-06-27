import type { MarketingMode } from '@bb/shared';
import type { AudienceTemperature, ValidationResult } from '../entities/internal-brief.entity';
export type { ForwardQuestionPriority } from '../value-objects/forward-question.vo';

export type CritiqueOutcome =
  | 'CONFIRMED'
  | 'CONDITIONAL'
  | 'MODIFIED'
  | 'REJECTED'
  | 'INCONCLUSIVE';

export type QuarantineStatus = 'APPLIED' | 'QUARANTINED';

/** Single intelligence event within IntelligenceEventsEmitted payload. */
export interface IntelligenceEventPayload {
  eventId: string;
  layer: string;
  eventType: 'OBSERVATIONAL' | 'INFERENTIAL' | 'CONFIDENCE' | 'BEHAVIOURAL' | 'OUTCOME';
  content: Record<string, unknown>;
  confidence: number;
  reasoning?: string;
  confidenceDirection?: 'INCREASE' | 'DECREASE';
  confidenceDelta?: number;
  sourceSignalIds: string[];
  replacesPatternId?: string;
  quarantineStatus: QuarantineStatus;
}

/** Shared brief metadata shape used in BriefCommitted and FallbackBriefCommitted. */
export interface BriefMetadata {
  cycleId: string;
  founderId: string;
  briefId: string;
  cycleNumber: number;
  selectedMode: MarketingMode;
  briefConfidence: number;
  uniquenessScore: number;
  validationResult: ValidationResult;
  isFallback: boolean;
  reviewFlag: boolean;
  audienceTemperature: AudienceTemperature;
  campaignId: string | null;
  committedAt: Date;
}
