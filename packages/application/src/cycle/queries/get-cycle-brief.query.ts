import type { Query } from '../../shared/query-bus';
import type { MarketingMode } from '@bb/shared';
import type { ValidationResult } from '@bb/domain';

export interface GetCycleBriefQuery extends Query {
  readonly type: 'GetCycleBrief';
  readonly cycleId: string;
  readonly founderId: string;
}

export interface CycleBriefDTO {
  briefId: string;
  cycleId: string;
  mode: MarketingMode;
  modeConfidence: number;
  strategicPurpose: string;
  audienceSegment: string;
  briefConfidence: number;
  uniquenessScore: number;
  validationResult: ValidationResult;
  isFallback: boolean;
  reviewFlag: boolean;
  committedAt: Date;
}
