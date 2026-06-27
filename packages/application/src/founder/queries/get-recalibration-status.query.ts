import type { Query } from '../../shared/query-bus';

export interface GetRecalibrationStatusQuery extends Query {
  readonly type: 'GetRecalibrationStatus';
  readonly founderId: string;
}

export interface RecalibrationStatusDTO {
  founderId: string;
  isRecalibrating: boolean;
  sessionId: string | null;
  questionsTotal: number;
  responsesSubmitted: number;
  expiresAt: Date | null;
}
