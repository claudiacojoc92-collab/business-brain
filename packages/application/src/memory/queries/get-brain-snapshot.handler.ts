import type { QueryHandler } from '../../shared/query-bus';
import type { IBusinessMemoryRepository } from '@bb/domain';
import { MEMORY_SNAPSHOT_STALENESS_MINUTES } from '@bb/shared';
import type { GetBrainSnapshotQuery, BrainSnapshotDTO } from './get-brain-snapshot.query';

export class GetBrainSnapshotHandler
  implements QueryHandler<GetBrainSnapshotQuery, BrainSnapshotDTO | null>
{
  constructor(private readonly memoryRepo: IBusinessMemoryRepository) {}

  async handle(query: GetBrainSnapshotQuery): Promise<BrainSnapshotDTO | null> {
    const snapshot = await this.memoryRepo.findSnapshot(query.founderId);
    if (!snapshot) return null;

    const now = new Date();
    return {
      founderId:       snapshot.founderId,
      snapshotJson:    snapshot.snapshotJson,
      estimatedTokens: snapshot.estimatedTokens,
      builtAt:         snapshot.builtAt,
      isStale:         snapshot.isStale(MEMORY_SNAPSHOT_STALENESS_MINUTES, now),
    };
  }
}
