import { Entity } from '../../shared/entity';
import type { MarketingMode } from '@bb/shared';

export type AudienceTemperature = 'COLD' | 'WARM' | 'HOT';
export type ValidationResult =
  | 'PASS'
  | 'PASS_AFTER_STRENGTHEN'
  | 'PASS_AFTER_RETRY_1'
  | 'PASS_AFTER_RETRY_2'
  | 'MARGINAL_DELIVERED'
  | 'FALLBACK_GENERIC_RISK';

export interface InternalBriefProps {
  id: string;
  cycleId: string;
  founderId: string;
  mode: MarketingMode;
  modeConfidence: number;
  modeReason: string;
  beliefTargetPrimary: string;
  beliefTargetSecondary: string | null;
  beliefGapAddressed: string;
  audienceSegment: string;
  audienceTemperature: AudienceTemperature;
  relationshipMoveType: string;
  relationshipMoveDesc: string;
  voiceParameters: Record<string, unknown>;
  hardBlocks: string[];
  voiceBoundaries: string[];
  offerConstraints: string[];
  convictionAngle: string;
  audienceLanguage: Record<string, unknown>;
  strategicPurpose: string;
  campaignId: string | null;
  pieceObjectives: unknown[];
  briefConfidence: number;
  uniquenessScore: number;
  validationResult: ValidationResult;
  reviewFlag: boolean;
  memoryConfidence: number;
  recalibrationNeeded: boolean;
  isFallback: boolean;
  committedAt: Date;
}

/**
 * The committed internal brief for a weekly cycle.
 * Immutable after creation. Produced by Stage 11 (Decision Commit).
 * Source: Domain Architecture V1 Chapter 03, Prompt Registry V1 PR-009.
 */
export class InternalBrief extends Entity {
  readonly cycleId: string;
  readonly founderId: string;
  readonly mode: MarketingMode;
  readonly modeConfidence: number;
  readonly modeReason: string;
  readonly beliefTargetPrimary: string;
  readonly beliefTargetSecondary: string | null;
  readonly beliefGapAddressed: string;
  readonly audienceSegment: string;
  readonly audienceTemperature: AudienceTemperature;
  readonly relationshipMoveType: string;
  readonly relationshipMoveDesc: string;
  readonly voiceParameters: Record<string, unknown>;
  readonly hardBlocks: readonly string[];
  readonly voiceBoundaries: readonly string[];
  readonly offerConstraints: readonly string[];
  readonly convictionAngle: string;
  readonly audienceLanguage: Record<string, unknown>;
  readonly strategicPurpose: string;
  readonly campaignId: string | null;
  readonly pieceObjectives: readonly unknown[];
  readonly briefConfidence: number;
  readonly uniquenessScore: number;
  readonly validationResult: ValidationResult;
  readonly reviewFlag: boolean;
  readonly memoryConfidence: number;
  readonly recalibrationNeeded: boolean;
  readonly isFallback: boolean;
  readonly committedAt: Date;

  constructor(props: InternalBriefProps) {
    super(props.id);
    this.cycleId              = props.cycleId;
    this.founderId            = props.founderId;
    this.mode                 = props.mode;
    this.modeConfidence       = props.modeConfidence;
    this.modeReason           = props.modeReason;
    this.beliefTargetPrimary  = props.beliefTargetPrimary;
    this.beliefTargetSecondary = props.beliefTargetSecondary;
    this.beliefGapAddressed   = props.beliefGapAddressed;
    this.audienceSegment      = props.audienceSegment;
    this.audienceTemperature  = props.audienceTemperature;
    this.relationshipMoveType = props.relationshipMoveType;
    this.relationshipMoveDesc = props.relationshipMoveDesc;
    this.voiceParameters      = props.voiceParameters;
    this.hardBlocks           = Object.freeze([...props.hardBlocks]);
    this.voiceBoundaries      = Object.freeze([...props.voiceBoundaries]);
    this.offerConstraints     = Object.freeze([...props.offerConstraints]);
    this.convictionAngle      = props.convictionAngle;
    this.audienceLanguage     = props.audienceLanguage;
    this.strategicPurpose     = props.strategicPurpose;
    this.campaignId           = props.campaignId;
    this.pieceObjectives      = Object.freeze([...props.pieceObjectives]);
    this.briefConfidence      = props.briefConfidence;
    this.uniquenessScore      = props.uniquenessScore;
    this.validationResult     = props.validationResult;
    this.reviewFlag           = props.reviewFlag;
    this.memoryConfidence     = props.memoryConfidence;
    this.recalibrationNeeded  = props.recalibrationNeeded;
    this.isFallback           = props.isFallback;
    this.committedAt          = props.committedAt;
  }
}
