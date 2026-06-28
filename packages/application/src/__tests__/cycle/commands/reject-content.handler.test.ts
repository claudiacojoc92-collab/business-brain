import { describe, it, expect, vi } from 'vitest';
import { RejectContentHandler } from '../../../cycle/commands/reject-content.handler';
import { WeeklyCycle, ContentPiece } from '@bb/domain';
import type { IWeeklyCycleRepository } from '@bb/domain';
import type { IEventStore } from '../../../shared/event-store';
import type { ITransactionManager } from '../../../shared/transaction-manager';
import type { RejectContentCommand } from '../../../cycle/commands/reject-content.command';
import { generateId } from '@bb/shared';

const NOW = new Date('2025-01-06T04:00:00Z');

function makeCommittedCycle(): WeeklyCycle {
  return WeeklyCycle.reconstitute({
    id: 'cycle-01', founderId: 'f-01', cycleNumber: 1,
    status: 'COMMITTED', scheduledFor: NOW,
    contentDeliverBy: new Date(), campaignId: null,
    campaignPhaseIndex: null, selectedMode: 'AUTHORITY',
    startedAt: NOW, reasoningStartedAt: NOW, committedAt: NOW,
    failedAt: null, failureReason: null,
    critiqueOutcome: 'CONFIRMED', critiqueReturnCount: 0,
    isFallback: false,
  });
}

function makePiece(): ContentPiece {
  return new ContentPiece({
    id: generateId(), cycleId: 'cycle-01', founderId: 'f-01',
    briefId: generateId(), pieceType: 'REEL', pieceRole: 'Authority',
    contentBlobKey: null, contentPreview: 'Preview text here.',
    approvalStatus: 'AWAITING_APPROVAL',
    approvalWindowExpiresAt: null, approvedAt: null,
    rejectedAt: null, rejectionReasonCode: null,
    publishedAt: null, platformPostId: null,
  });
}

describe('RejectContentHandler (F003)', () => {
  it('rejects content with a valid reason code', async () => {
    const cycle = makeCommittedCycle();
    const piece = makePiece();

    const cycleRepo: IWeeklyCycleRepository = {
      findById:                    vi.fn().mockResolvedValue(cycle),
      findActive:                  vi.fn(),
      findByFounderAndNumber:      vi.fn(),
      findAwaitingApprovalPieces:  vi.fn().mockResolvedValue([]),
      findContentPieceById:        vi.fn().mockResolvedValue(null),
      findContentPiecesByCycle:    vi.fn().mockResolvedValue([]),
      findCurrentReviewCycle:      vi.fn().mockResolvedValue(null),
      findHistory:                 vi.fn(),
      findPreceding:               vi.fn(),
      findForwardQuestion:         vi.fn(),
      findSignalsForCycle:         vi.fn().mockResolvedValue([]),
      insertSignal:                vi.fn().mockResolvedValue(undefined),
      save:                        vi.fn().mockResolvedValue(undefined),
      updateContentPieceDecision:  vi.fn().mockResolvedValue(undefined),
      markForwardQuestionConsumed: vi.fn(),
    };
    const eventStore: IEventStore = { append: vi.fn().mockResolvedValue(undefined) };
    const txManager: ITransactionManager = {
      run: vi.fn().mockImplementation((work) => work({})),
    };

    const handler = new RejectContentHandler(cycleRepo, eventStore, txManager);
    const cmd: RejectContentCommand = {
      type:             'RejectContent',
      cycleId:          'cycle-01',
      founderId:        'f-01',
      contentPiece:     piece,
      reasonCode:       'VOICE_MISMATCH',
      hardBoundaryFlag: false,
      correlationId:    'corr-01',
      traceId:          'trace-01',
      idempotencyKey:   'idem-01',
    };

    const result = await handler.handle(cmd);

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.reasonCode).toBe('VOICE_MISMATCH');
    }
    expect(cycleRepo.save).toHaveBeenCalledOnce();
    // The decision must be persisted to the content_pieces read model (not only the event store),
    // otherwise the GET read-back and the PIECE_ALREADY_DECIDED guard never reflect it.
    expect(cycleRepo.updateContentPieceDecision).toHaveBeenCalledOnce();
    expect(cycleRepo.updateContentPieceDecision).toHaveBeenCalledWith(piece, expect.anything());
    expect(eventStore.append).toHaveBeenCalledOnce();
  });
});
