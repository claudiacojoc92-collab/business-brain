import { describe, it, expect, vi } from 'vitest';
import { ContentPiece } from '@bb/domain';
import type { IWeeklyCycleRepository } from '@bb/domain';
import { GetContentPieceForApprovalHandler } from '../../../cycle/queries/get-content-piece-for-approval.handler';
import type { GetContentPieceForApprovalQuery } from '../../../cycle/queries/get-content-piece-for-approval.query';

function makePiece(id = 'p1'): ContentPiece {
  return new ContentPiece({
    id, cycleId: 'cycle-1', founderId: 'founder-1', briefId: 'brief-1',
    pieceType: 'REEL', pieceRole: 'Authority', contentBlobKey: null, contentPreview: '{}',
    approvalStatus: 'AWAITING_APPROVAL', approvalWindowExpiresAt: null,
    approvedAt: null, rejectedAt: null, rejectionReasonCode: null, publishedAt: null, platformPostId: null,
  });
}

function makeRepo(over: Partial<IWeeklyCycleRepository> = {}): IWeeklyCycleRepository {
  return { findContentPieceById: vi.fn().mockResolvedValue(makePiece()), ...over } as unknown as IWeeklyCycleRepository;
}

const query = {
  type: 'GetContentPieceForApproval', founderId: 'founder-1', contentPieceId: 'p1',
  correlationId: 'c', traceId: 't',
} as GetContentPieceForApprovalQuery;

describe('GetContentPieceForApprovalHandler (C4)', () => {
  it('returns the real piece loaded by id, founder-scoped', async () => {
    const repo = makeRepo();
    const piece = await new GetContentPieceForApprovalHandler(repo).handle(query);
    expect(piece.id).toBe('p1');
    expect(repo.findContentPieceById).toHaveBeenCalledWith('p1', 'founder-1');
  });

  it('throws CONTENT_PIECE_NOT_FOUND when no piece exists for that founder', async () => {
    const repo = makeRepo({ findContentPieceById: vi.fn().mockResolvedValue(null) });
    await expect(new GetContentPieceForApprovalHandler(repo).handle(query))
      .rejects.toMatchObject({ code: 'CONTENT_PIECE_NOT_FOUND' });
  });
});
