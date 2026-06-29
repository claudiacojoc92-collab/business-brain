import { describe, it, expect, vi } from 'vitest';
import { StartWeeklyCycleHandler } from '../../../cycle/commands/start-weekly-cycle.handler';
import { FounderProfile, WeeklyCycle } from '@bb/domain';
import type { IFounderProfileRepository, IWeeklyCycleRepository } from '@bb/domain';
import type { IEventStore } from '../../../shared/event-store';
import type { ITransactionManager } from '../../../shared/transaction-manager';
import type { StartWeeklyCycleCommand } from '../../../cycle/commands/start-weekly-cycle.command';
import { generateId } from '@bb/shared';

const NOW = new Date('2025-01-06T04:00:00Z');

function makeActiveFounder(): FounderProfile {
  return FounderProfile.reconstitute({
    id: 'f-01', email: 'a@b.com', name: 'Alice', businessName: 'AliceCo',
    timezone: 'UTC', status: 'ACTIVE',
    currentVoice: null, currentBeliefChain: null,
    currentConviction: null, currentAudience: null, currentOffer: null,
    notificationChannel: 'EMAIL',
    autoApproveOnWindowClose: true, approvalWindowHours: 72,
    registeredAt: NOW, activatedAt: NOW, pausedAt: null,
  });
}

function makeCmd(founderId = 'f-01'): StartWeeklyCycleCommand {
  return {
    type:              'StartWeeklyCycle',
    founderId,
    cycleId:           generateId(),
    cycleNumber:       1,
    scheduledFor:      NOW,
    contentDeliverBy:  new Date('2025-01-06T08:00:00Z'),
    campaignId:        null,
    campaignPhaseIndex:null,
    correlationId:     'corr-01',
    traceId:           'trace-01',
    idempotencyKey:    'idem-01',
  };
}

describe('StartWeeklyCycleHandler (F001)', () => {
  it('starts a cycle when founder is ACTIVE and no existing cycle', async () => {
    const founder = makeActiveFounder();
    const founderRepo: IFounderProfileRepository = {
      findById:           vi.fn(),
      findByIdForUpdate:  vi.fn().mockResolvedValue(founder),
      findByEmail:        vi.fn(),
      save:               vi.fn().mockResolvedValue(undefined),
      findActiveFounders: vi.fn().mockResolvedValue([]),
    };
    const cycleRepo: IWeeklyCycleRepository = {
      findById:                    vi.fn(),
      findActive:                  vi.fn().mockResolvedValue(null),
      findByFounderAndNumber:      vi.fn(),
      findAwaitingApprovalPieces:  vi.fn().mockResolvedValue([]),
      findContentPieceById:        vi.fn().mockResolvedValue(null),
      findContentPiecesByCycle:    vi.fn().mockResolvedValue([]),
      countContentPiecesByCycleIds: vi.fn().mockResolvedValue(new Map()),
      findCurrentReviewCycle:      vi.fn().mockResolvedValue(null),
      findHistory:                 vi.fn(),
      findPreceding:               vi.fn(),
      findForwardQuestion:         vi.fn(),
      findSignalsForCycle:         vi.fn().mockResolvedValue([]),
      insertSignal:                vi.fn().mockResolvedValue(undefined),
      save:                        vi.fn().mockResolvedValue(undefined),
      updateContentPieceDecision: vi.fn().mockResolvedValue(undefined),
      markForwardQuestionConsumed: vi.fn(),
    };
    const eventStore: IEventStore = { append: vi.fn().mockResolvedValue(undefined) };
    const txManager: ITransactionManager = {
      run: vi.fn().mockImplementation((work) => work({})),
    };

    const handler = new StartWeeklyCycleHandler(founderRepo, cycleRepo, eventStore, txManager);
    const result = await handler.handle(makeCmd());

    expect(result.isOk).toBe(true);
    // F001: must use findByIdForUpdate
    expect(founderRepo.findByIdForUpdate).toHaveBeenCalledWith('f-01', {});
    expect(cycleRepo.save).toHaveBeenCalledOnce();
    expect(eventStore.append).toHaveBeenCalledOnce();
  });

  it('returns FOUNDER_NOT_ACTIVE when founder is PAUSED', async () => {
    const founder = FounderProfile.reconstitute({
      id: 'f-01', email: 'a@b.com', name: 'Alice', businessName: 'AliceCo',
      timezone: 'UTC', status: 'PAUSED',
      currentVoice: null, currentBeliefChain: null,
      currentConviction: null, currentAudience: null, currentOffer: null,
      notificationChannel: 'EMAIL',
      autoApproveOnWindowClose: true, approvalWindowHours: 72,
      registeredAt: NOW, activatedAt: NOW, pausedAt: NOW,
    });

    const founderRepo: IFounderProfileRepository = {
      findById:           vi.fn(),
      findByIdForUpdate:  vi.fn().mockResolvedValue(founder),
      findByEmail:        vi.fn(),
      save:               vi.fn(),
      findActiveFounders: vi.fn().mockResolvedValue([]),
    };
    const cycleRepo: IWeeklyCycleRepository = {
      findById:                    vi.fn(),
      findActive:                  vi.fn().mockResolvedValue(null),
      findByFounderAndNumber:      vi.fn(),
      findAwaitingApprovalPieces:  vi.fn().mockResolvedValue([]),
      findContentPieceById:        vi.fn().mockResolvedValue(null),
      findContentPiecesByCycle:    vi.fn().mockResolvedValue([]),
      countContentPiecesByCycleIds: vi.fn().mockResolvedValue(new Map()),
      findCurrentReviewCycle:      vi.fn().mockResolvedValue(null),
      findHistory:                 vi.fn(),
      findPreceding:               vi.fn(),
      findForwardQuestion:         vi.fn(),
      findSignalsForCycle:         vi.fn().mockResolvedValue([]),
      insertSignal:                vi.fn().mockResolvedValue(undefined),
      save:                        vi.fn(),
      updateContentPieceDecision: vi.fn().mockResolvedValue(undefined),
      markForwardQuestionConsumed: vi.fn(),
    };
    const eventStore: IEventStore = { append: vi.fn() };
    const txManager: ITransactionManager = {
      run: vi.fn().mockImplementation((work) => work({})),
    };

    const handler = new StartWeeklyCycleHandler(founderRepo, cycleRepo, eventStore, txManager);
    const result = await handler.handle(makeCmd());

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.code).toBe('FOUNDER_NOT_ACTIVE');
    }
    expect(cycleRepo.save).not.toHaveBeenCalled();
  });

  it('returns CYCLE_ALREADY_RUNNING when active cycle exists', async () => {
    const founder = makeActiveFounder();
    const existingCycle = WeeklyCycle.reconstitute({
      id: generateId(), founderId: 'f-01', cycleNumber: 1,
      status: 'COLLECTING', scheduledFor: NOW,
      contentDeliverBy: new Date(), campaignId: null,
      campaignPhaseIndex: null, selectedMode: null,
      startedAt: NOW, reasoningStartedAt: null, committedAt: null,
      failedAt: null, failureReason: null, critiqueOutcome: null,
      critiqueReturnCount: 0, isFallback: false,
    });

    const founderRepo: IFounderProfileRepository = {
      findById:           vi.fn(),
      findByIdForUpdate:  vi.fn().mockResolvedValue(founder),
      findByEmail:        vi.fn(),
      save:               vi.fn(),
      findActiveFounders: vi.fn().mockResolvedValue([]),
    };
    const cycleRepo: IWeeklyCycleRepository = {
      findById:                    vi.fn(),
      findActive:                  vi.fn().mockResolvedValue(existingCycle),
      findByFounderAndNumber:      vi.fn(),
      findAwaitingApprovalPieces:  vi.fn().mockResolvedValue([]),
      findContentPieceById:        vi.fn().mockResolvedValue(null),
      findContentPiecesByCycle:    vi.fn().mockResolvedValue([]),
      countContentPiecesByCycleIds: vi.fn().mockResolvedValue(new Map()),
      findCurrentReviewCycle:      vi.fn().mockResolvedValue(null),
      findHistory:                 vi.fn(),
      findPreceding:               vi.fn(),
      findForwardQuestion:         vi.fn(),
      findSignalsForCycle:         vi.fn().mockResolvedValue([]),
      insertSignal:                vi.fn().mockResolvedValue(undefined),
      save:                        vi.fn(),
      updateContentPieceDecision: vi.fn().mockResolvedValue(undefined),
      markForwardQuestionConsumed: vi.fn(),
    };
    const eventStore: IEventStore = { append: vi.fn() };
    const txManager: ITransactionManager = {
      run: vi.fn().mockImplementation((work) => work({})),
    };

    const handler = new StartWeeklyCycleHandler(founderRepo, cycleRepo, eventStore, txManager);
    const result = await handler.handle(makeCmd());

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.code).toBe('CYCLE_ALREADY_RUNNING');
    }
  });
});
