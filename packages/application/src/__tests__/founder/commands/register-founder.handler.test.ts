import { describe, it, expect, vi } from 'vitest';
import { RegisterFounderHandler } from '../../../founder/commands/register-founder.handler';
import type { IFounderProfileRepository } from '@bb/domain';
import type { IEventStore } from '../../../shared/event-store';
import type { ITransactionManager } from '../../../shared/transaction-manager';
import type { RegisterFounderCommand } from '../../../founder/commands/register-founder.command';

function makeCmd(overrides: Partial<RegisterFounderCommand> = {}): RegisterFounderCommand {
  return {
    type:           'RegisterFounder',
    email:          'test@example.com',
    name:           'Test Founder',
    businessName:   'Test Business',
    timezone:       'UTC',
    correlationId:  'corr-01',
    traceId:        'trace-01',
    idempotencyKey: 'idem-01',
    ...overrides,
  };
}

function makeDeps() {
  const founderRepo: IFounderProfileRepository = {
    findById:           vi.fn().mockResolvedValue(null),
    findByIdForUpdate:  vi.fn(),
    findByEmail:        vi.fn().mockResolvedValue(null),
    save:               vi.fn().mockResolvedValue(undefined),
    findActiveFounders: vi.fn().mockResolvedValue([]),
  };

  const eventStore: IEventStore = {
    append: vi.fn().mockResolvedValue(undefined),
  };

  const txManager: ITransactionManager = {
    run: vi.fn().mockImplementation((work) => work({})),
  };

  return { founderRepo, eventStore, txManager };
}

describe('RegisterFounderHandler', () => {
  it('registers a new founder and returns founderId', async () => {
    const { founderRepo, eventStore, txManager } = makeDeps();
    const handler = new RegisterFounderHandler(founderRepo, eventStore, txManager);

    const result = await handler.handle(makeCmd());

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.founderId).toHaveLength(26); // ULID
    }
    expect(founderRepo.save).toHaveBeenCalledOnce();
    expect(eventStore.append).toHaveBeenCalledOnce();
  });

  it('returns ConflictError when email already registered', async () => {
    const { founderRepo, eventStore, txManager } = makeDeps();
    // Simulate existing founder
    vi.mocked(founderRepo.findByEmail).mockResolvedValue({
      id: 'existing-01',
    } as never);

    const handler = new RegisterFounderHandler(founderRepo, eventStore, txManager);
    const result = await handler.handle(makeCmd());

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    }
    expect(founderRepo.save).not.toHaveBeenCalled();
  });
});
