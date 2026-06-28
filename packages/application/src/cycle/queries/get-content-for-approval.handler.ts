import type { QueryHandler } from '../../shared/query-bus';
import type { IWeeklyCycleRepository } from '@bb/domain';
import { NotFoundError } from '@bb/shared';
import type {
  GetContentForApprovalQuery,
  ContentForApprovalDTO,
} from './get-content-for-approval.query';

export class GetContentForApprovalHandler
  implements QueryHandler<GetContentForApprovalQuery, ContentForApprovalDTO[]>
{
  constructor(private readonly cycleRepo: IWeeklyCycleRepository) {}

  async handle(query: GetContentForApprovalQuery): Promise<ContentForApprovalDTO[]> {
    const cycle = await this.cycleRepo.findById(query.cycleId);
    if (!cycle) {
      throw new NotFoundError('CYCLE_NOT_FOUND', `Cycle ${query.cycleId} not found.`);
    }
    // C3 default: the cycle's AWAITING_APPROVAL pieces (founder-scoped, priority order),
    // mapped into the existing DTO. Empty state → []. When an opt-in status filter is supplied
    // (e.g. APPROVED), return the cycle's pieces in that status instead — making already-approved
    // content retrievable. Default (no status) behaviour is unchanged.
    const pieces = query.status
      ? await this.cycleRepo.findContentPiecesByCycle(query.cycleId, query.founderId, query.status)
      : await this.cycleRepo.findAwaitingApprovalPieces(query.cycleId, query.founderId);
    return pieces.map((p) => ({
      contentPieceId:          p.id,
      cycleId:                 p.cycleId,
      pieceType:               p.pieceType,
      pieceRole:               p.pieceRole,
      contentPreview:          p.contentPreview,
      approvalStatus:          p.approvalStatus,
      approvalWindowExpiresAt: p.approvalWindowExpiresAt,
    }));
  }
}
