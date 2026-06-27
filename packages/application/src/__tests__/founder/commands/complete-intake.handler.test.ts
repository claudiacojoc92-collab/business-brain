import { describe, it, expect, vi } from 'vitest';
import { CompleteIntakeHandler } from '../../../founder/commands/complete-intake.handler';
import { FounderProfile } from '@bb/domain';
import type { IFounderProfileRepository } from '@bb/domain';
import type { IEventStore } from '../../../shared/event-store';
import type { ITransactionManager } from '../../../shared/transaction-manager';
import type { IIntakeSessionRepository, IntakeSessionRecord } from '../../../founder/repositories/intake-session.repository';
import type { IntakeMemoryMapper } from '../../../founder/intake-memory-mapper';
import type { CompleteIntakeCommand } from '../../../founder/commands/complete-intake.command';

const NOW = new Date('2025-01-06T04:00:00Z');

function makeIntakePendingFounder(): FounderProfile {
  const f = FounderProfile.register({
    email: 'test@example.com', name: 'Test', businessName: 'Biz',
    timezone: 'UTC', correlationId: 'c', traceId: 't', now: NOW,
  });
  f.pullEvents();
  f.startIntake({
    sessionId: 'sess-01', mandatorySignalTypes: [],
    expiresAt: new Date('2025-01-13T04:00:00Z'),
    correlationId: 'c', traceId: 't',
  });
  f.pullEvents();
  return f;
}

function makeSessionRecord(founderId: string): IntakeSessionRecord {
  return {
    id: 'sess-01',
    founderId,
    signals: {},
    mandatorySignalTypes: [],
    expiresAt: new Date('2025-01-13T04:00:00Z'),
    completedAt: null,
    abandonedAt: null,
  };
}

describe('CompleteIntakeHandler (B1 Option-1)', () => {
  it('marks the session complete, activates the founder, saves + appends in one transaction', async () => {
    const founder = makeIntakePendingFounder();

    const founderRepo: IFounderProfileRepository = {
      findById:           vi.fn(),
      findByIdForUpdate:  vi.fn().mockResolvedValue(founder),
      findByEmail:        vi.fn(),
      save:               vi.fn().mockResolvedValue(undefined),
      findActiveFounders: vi.fn().mockResolvedValue([]),
    };
    const intakeSessionRepo: IIntakeSessionRepository = {
      findActiveByFounderId: vi.fn().mockResolvedValue(makeSessionRecord(founder.id)),
      upsertSignal:          vi.fn().mockResolvedValue(undefined),
      markCompleted:         vi.fn().mockResolvedValue(undefined),
    };
    const eventStore: IEventStore = { append: vi.fn().mockResolvedValue(undefined) };
    const txManager: ITransactionManager = {
      run: vi.fn().mockImplementation((work) => work({})),
    };
    const intakeMemoryMapper = {
      seedFromIntake: vi.fn().mockResolvedValue({ founderId: founder.id, seededLayers: {}, intelligenceEvents: 0 }),
    } as unknown as IntakeMemoryMapper;

    const handler = new CompleteIntakeHandler(
      founderRepo, intakeSessionRepo, eventStore, txManager, intakeMemoryMapper);
    const cmd: CompleteIntakeCommand = {
      type:           'CompleteIntake',
      founderId:      founder.id,
      correlationId:  'corr-01',
      traceId:        'trace-01',
      idempotencyKey: 'idem-01',
    };

    const result = await handler.handle(cmd);

    expect(result.isOk).toBe(true);
    expect(founder.status).toBe('ACTIVE');
    expect(founderRepo.findByIdForUpdate).toHaveBeenCalledWith(founder.id, {});
    expect(intakeSessionRepo.markCompleted).toHaveBeenCalledWith('sess-01');
    expect(founderRepo.save).toHaveBeenCalledOnce();
    expect(intakeMemoryMapper.seedFromIntake).toHaveBeenCalledOnce();
    expect(eventStore.append).toHaveBeenCalledOnce();
    expect(txManager.run).toHaveBeenCalledOnce();
  });

  it('returns NO_ACTIVE_INTAKE_SESSION when no active session exists', async () => {
    const founder = makeIntakePendingFounder();

    const founderRepo: IFounderProfileRepository = {
      findById:           vi.fn(),
      findByIdForUpdate:  vi.fn().mockResolvedValue(founder),
      findByEmail:        vi.fn(),
      save:               vi.fn(),
      findActiveFounders: vi.fn().mockResolvedValue([]),
    };
    const intakeSessionRepo: IIntakeSessionRepository = {
      findActiveByFounderId: vi.fn().mockResolvedValue(null),
      upsertSignal:          vi.fn(),
      markCompleted:         vi.fn(),
    };
    const eventStore: IEventStore = { append: vi.fn() };
    const txManager: ITransactionManager = {
      run: vi.fn().mockImplementation((work) => work({})),
    };
    const intakeMemoryMapper = {
      seedFromIntake: vi.fn().mockResolvedValue({ founderId: founder.id, seededLayers: {}, intelligenceEvents: 0 }),
    } as unknown as IntakeMemoryMapper;

    const handler = new CompleteIntakeHandler(
      founderRepo, intakeSessionRepo, eventStore, txManager, intakeMemoryMapper);
    const cmd: CompleteIntakeCommand = {
      type:           'CompleteIntake',
      founderId:      founder.id,
      correlationId:  'corr-01',
      traceId:        'trace-01',
      idempotencyKey: 'idem-01',
    };

    const result = await handler.handle(cmd);

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.code).toBe('NO_ACTIVE_INTAKE_SESSION');
    }
    expect(intakeSessionRepo.markCompleted).not.toHaveBeenCalled();
    expect(founderRepo.save).not.toHaveBeenCalled();
    expect(intakeMemoryMapper.seedFromIntake).not.toHaveBeenCalled();
    expect(eventStore.append).not.toHaveBeenCalled();
  });
});
