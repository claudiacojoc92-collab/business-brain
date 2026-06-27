import { describe, it, expect, vi } from 'vitest';
import { GetFounderStatusHandler } from '../../../founder/queries/get-founder-status.handler';
import { FounderProfile } from '@bb/domain';
import type { IFounderProfileRepository } from '@bb/domain';
import type { GetFounderStatusQuery } from '../../../founder/queries/get-founder-status.query';

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

describe('GetFounderStatusHandler', () => {
  it('returns FounderStatusDTO for an existing founder', async () => {
    const founder = makeActiveFounder();
    const founderRepo: IFounderProfileRepository = {
      findById:           vi.fn().mockResolvedValue(founder),
      findByIdForUpdate:  vi.fn(),
      findByEmail:        vi.fn(),
      save:               vi.fn(),
      findActiveFounders: vi.fn().mockResolvedValue([]),
    };

    const handler = new GetFounderStatusHandler(founderRepo);
    const query: GetFounderStatusQuery = {
      type: 'GetFounderStatus', founderId: 'f-01',
      correlationId: 'c', traceId: 't',
    };

    const dto = await handler.handle(query);

    expect(dto.founderId).toBe('f-01');
    expect(dto.status).toBe('ACTIVE');
    expect(dto.name).toBe('Alice');
    expect(dto.autoApproveOnWindowClose).toBe(true);
    expect(dto.approvalWindowHours).toBe(72);
  });

  it('throws NotFoundError when founder does not exist', async () => {
    const founderRepo: IFounderProfileRepository = {
      findById:           vi.fn().mockResolvedValue(null),
      findByIdForUpdate:  vi.fn(),
      findByEmail:        vi.fn(),
      save:               vi.fn(),
      findActiveFounders: vi.fn().mockResolvedValue([]),
    };

    const handler = new GetFounderStatusHandler(founderRepo);
    const query: GetFounderStatusQuery = {
      type: 'GetFounderStatus', founderId: 'missing-01',
      correlationId: 'c', traceId: 't',
    };

    await expect(handler.handle(query)).rejects.toThrow('not found');
  });
});
