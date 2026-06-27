import { describe, it, expect } from 'vitest';
import { ContentPiece } from '../../../cycle/entities/content-piece.entity';

function makePiece(overrides: Partial<ConstructorParameters<typeof ContentPiece>[0]> = {}) {
  return new ContentPiece({
    id:                      'piece-01',
    cycleId:                 'cycle-01',
    founderId:               'founder-01',
    briefId:                 'brief-01',
    pieceType:               'REEL',
    pieceRole:               'Authority anchor',
    contentBlobKey:          null,
    contentPreview:          null,
    approvalStatus:          'AWAITING_APPROVAL',
    approvalWindowExpiresAt: null,
    approvedAt:              null,
    rejectedAt:              null,
    rejectionReasonCode:     null,
    publishedAt:             null,
    platformPostId:          null,
    ...overrides,
  });
}

describe('ContentPiece', () => {
  it('isAwaitingApproval true when status is AWAITING_APPROVAL', () => {
    expect(makePiece().isAwaitingApproval()).toBe(true);
  });

  it('isAwaitingApproval false when APPROVED', () => {
    expect(makePiece({ approvalStatus: 'APPROVED' }).isAwaitingApproval()).toBe(false);
  });

  it('isDecided true for APPROVED', () => {
    expect(makePiece({ approvalStatus: 'APPROVED' }).isDecided()).toBe(true);
  });

  it('isDecided true for AUTO_APPROVED', () => {
    expect(makePiece({ approvalStatus: 'AUTO_APPROVED' }).isDecided()).toBe(true);
  });

  it('isDecided false for AWAITING_APPROVAL', () => {
    expect(makePiece().isDecided()).toBe(false);
  });
});
