import type { Query } from '../../shared/query-bus';

export interface GetCycleHistoryQuery extends Query {
  readonly type: 'GetCycleHistory';
  readonly founderId: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface CycleHistoryItemDTO {
  cycleId: string;
  cycleNumber: number;
  selectedMode: string | null;
  contentPieceCount: number;
  committedAt: Date;
  isFallback: boolean;
}

export interface CycleHistoryDTO {
  items: CycleHistoryItemDTO[];
  nextCursor: string | null;
  hasMore: boolean;
}
