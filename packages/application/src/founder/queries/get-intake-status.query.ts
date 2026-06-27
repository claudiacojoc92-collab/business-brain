import type { Query } from '../../shared/query-bus';

export interface GetIntakeStatusQuery extends Query {
  readonly type: 'GetIntakeStatus';
  readonly founderId: string;
}

export interface IntakeStatusDTO {
  founderId: string;
  status: string;
  sessionId: string | null;
  signalsSubmitted: string[];
  mandatorySignalTypes: string[];
  allSignalsComplete: boolean;
  expiresAt: Date | null;
}
