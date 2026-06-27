import type { Query } from '../../shared/query-bus';
import type { MarketingMode } from '@bb/shared';
import type { CycleStatus } from '@bb/domain';

export interface GetCurrentCycleQuery extends Query {
  readonly type: 'GetCurrentCycle';
  readonly founderId: string;
}

export interface CurrentCycleDTO {
  cycleId: string;
  cycleNumber: number;
  status: CycleStatus;
  scheduledFor: Date;
  contentDeliverBy: Date;
  selectedMode: MarketingMode | null;
  isFallback: boolean;
  startedAt: Date | null;
  committedAt: Date | null;
}
