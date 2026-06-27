import type { QueryHandler } from '../../shared/query-bus';
import type { IWeeklyCycleRepository, ContentPiece } from '@bb/domain';
import { NotFoundError } from '@bb/shared';
import type { GetContentPieceForApprovalQuery } from './get-content-piece-for-approval.query';

/**
 * Returns the real persisted content_piece by id, founder-scoped (C4 load-swap).
 * Throws CONTENT_PIECE_NOT_FOUND (existing NotFoundError pathway) when no piece exists
 * for that id and founder — so another founder's piece is never loadable.
 */
export class GetContentPieceForApprovalHandler
  implements QueryHandler<GetContentPieceForApprovalQuery, ContentPiece>
{
  constructor(private readonly cycleRepo: IWeeklyCycleRepository) {}

  async handle(query: GetContentPieceForApprovalQuery): Promise<ContentPiece> {
    const piece = await this.cycleRepo.findContentPieceById(query.contentPieceId, query.founderId);
    if (!piece) {
      throw new NotFoundError(
        'CONTENT_PIECE_NOT_FOUND',
        `Content piece ${query.contentPieceId} not found.`,
      );
    }
    return piece;
  }
}
