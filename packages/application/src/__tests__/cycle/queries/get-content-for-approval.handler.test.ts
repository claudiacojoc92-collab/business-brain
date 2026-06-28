import { describe, it, expect, vi } from 'vitest';
import { ContentPiece } from '@bb/domain';
import type { IWeeklyCycleRepository } from '@bb/domain';
import { GetContentForApprovalHandler } from '../../../cycle/queries/get-content-for-approval.handler';
import type { GetContentForApprovalQuery } from '../../../cycle/queries/get-content-for-approval.query';

function makePiece(id: string, role = 'Authority'): ContentPiece {
  return new ContentPiece({
    id, cycleId: 'cycle-1', founderId: 'founder-1', briefId: 'brief-1',
    pieceType: 'REEL', pieceRole: role,
    contentBlobKey: null, contentPreview: `{"piece":"${id}"}`,
    approvalStatus: 'AWAITING_APPROVAL', approvalWindowExpiresAt: null,
    approvedAt: null, rejectedAt: null, rejectionReasonCode: null,
    publishedAt: null, platformPostId: null,
  });
}

function makeRepo(over: Partial<IWeeklyCycleRepository> = {}): IWeeklyCycleRepository {
  return {
    findById: vi.fn().mockResolvedValue({ id: 'cycle-1' }),
    findAwaitingApprovalPieces: vi.fn().mockResolvedValue([]),
    findContentPiecesByCycle: vi.fn().mockResolvedValue([]),
    ...over,
  } as unknown as IWeeklyCycleRepository;
}

const query = {
  type: 'GetContentForApproval', founderId: 'founder-1', cycleId: 'cycle-1',
  correlationId: 'c', traceId: 't',
} as GetContentForApprovalQuery;

describe('GetContentForApprovalHandler (C3)', () => {
  it('maps current-cycle AWAITING_APPROVAL pieces into the existing DTO, order preserved', async () => {
    const repo = makeRepo({
      findAwaitingApprovalPieces: vi.fn().mockResolvedValue([makePiece('p1'), makePiece('p2', 'Nurture')]),
    });
    const dtos = await new GetContentForApprovalHandler(repo).handle(query);

    expect(dtos).toHaveLength(2);
    expect(dtos[0]).toEqual({
      contentPieceId: 'p1', cycleId: 'cycle-1', pieceType: 'REEL', pieceRole: 'Authority',
      contentPreview: '{"piece":"p1"}', approvalStatus: 'AWAITING_APPROVAL', approvalWindowExpiresAt: null,
    });
    expect(dtos[1]!.contentPieceId).toBe('p2');
    expect(dtos[1]!.pieceRole).toBe('Nurture');
  });

  it('delegates founder + cycle scoping to the repository', async () => {
    const repo = makeRepo();
    await new GetContentForApprovalHandler(repo).handle(query);
    expect(repo.findAwaitingApprovalPieces).toHaveBeenCalledWith('cycle-1', 'founder-1');
  });

  it('returns [] for the empty state (no error)', async () => {
    const dtos = await new GetContentForApprovalHandler(makeRepo()).handle(query);
    expect(dtos).toEqual([]);
  });

  it('throws CYCLE_NOT_FOUND and does not read pieces when the cycle is missing', async () => {
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
    await expect(new GetContentForApprovalHandler(repo).handle(query)).rejects.toMatchObject({ code: 'CYCLE_NOT_FOUND' });
    expect(repo.findAwaitingApprovalPieces).not.toHaveBeenCalled();
  });

  it('default (no status) reads AWAITING_APPROVAL only — unchanged behaviour', async () => {
    const repo = makeRepo({
      findAwaitingApprovalPieces: vi.fn().mockResolvedValue([makePiece('p1')]),
      findContentPiecesByCycle:   vi.fn().mockResolvedValue([]),
    });
    const dtos = await new GetContentForApprovalHandler(repo).handle(query);
    expect(repo.findAwaitingApprovalPieces).toHaveBeenCalledWith('cycle-1', 'founder-1');
    expect(repo.findContentPiecesByCycle).not.toHaveBeenCalled();
    expect(dtos).toHaveLength(1);
  });

  it('status filter (e.g. APPROVED) reads that status via findContentPiecesByCycle and skips the default', async () => {
    const approved = new ContentPiece({
      id: 'a1', cycleId: 'cycle-1', founderId: 'founder-1', briefId: 'brief-1',
      pieceType: 'CAROUSEL', pieceRole: 'PRIMARY', contentBlobKey: null, contentPreview: '{"piece":"a1"}',
      approvalStatus: 'APPROVED', approvalWindowExpiresAt: null, approvedAt: new Date(),
      rejectedAt: null, rejectionReasonCode: null, publishedAt: null, platformPostId: null,
    });
    const repo = makeRepo({
      findAwaitingApprovalPieces: vi.fn().mockResolvedValue([]),
      findContentPiecesByCycle:   vi.fn().mockResolvedValue([approved]),
    });
    const dtos = await new GetContentForApprovalHandler(repo).handle({ ...query, status: 'APPROVED' });
    expect(repo.findContentPiecesByCycle).toHaveBeenCalledWith('cycle-1', 'founder-1', 'APPROVED');
    expect(repo.findAwaitingApprovalPieces).not.toHaveBeenCalled();
    expect(dtos).toHaveLength(1);
    expect(dtos[0]!.approvalStatus).toBe('APPROVED');     // serialises through the SAME DTO
    expect(dtos[0]!.contentPieceId).toBe('a1');
  });
});
