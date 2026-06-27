import type { Query } from '../../shared/query-bus';

export interface GetBrainSnapshotQuery extends Query {
  readonly type: 'GetBrainSnapshot';
  readonly founderId: string;
}

export interface BrainSnapshotDTO {
  founderId: string;
  snapshotJson: Record<string, unknown>;
  estimatedTokens: number | null;
  builtAt: Date;
  isStale: boolean;
}
