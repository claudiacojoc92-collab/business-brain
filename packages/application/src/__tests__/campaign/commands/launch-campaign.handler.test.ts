import { describe, it, expect, vi } from 'vitest';
import { LaunchCampaignHandler } from '../../../campaign/commands/launch-campaign.handler';
import { CampaignPhase } from '@bb/domain';
import type { ICampaignRepository } from '@bb/domain';
import type { IEventStore } from '../../../shared/event-store';
import type { ITransactionManager } from '../../../shared/transaction-manager';
import type { LaunchCampaignCommand } from '../../../campaign/commands/launch-campaign.command';
import { generateId } from '@bb/shared';

function makePhase(): CampaignPhase {
  return new CampaignPhase({
    id:                     generateId(),
    campaignId:             'campaign-01',
    founderId:              'f-01',
    phaseIndex:             0,
    mode:                   'EDUCATION',
    beliefTarget:           'Authority.',
    expectedAudienceChange: 'COLD to WARM.',
    assignedCycleId:        null,
    executedAt:             null,
  });
}

function makeCmd(overrides: Partial<LaunchCampaignCommand> = {}): LaunchCampaignCommand {
  return {
    type:             'LaunchCampaign',
    founderId:        'f-01',
    campaignId:       generateId(),
    campaignType:     'POSITIONING',
    beliefTarget:     'Authority in service marketing.',
    successCriteria:  {},
    maxDurationWeeks: 8,
    phases:           [makePhase()],
    correlationId:    'corr-01',
    traceId:          'trace-01',
    idempotencyKey:   'idem-01',
    ...overrides,
  };
}

describe('LaunchCampaignHandler', () => {
  it('launches a campaign when no active campaign exists', async () => {
    const campaignRepo: ICampaignRepository = {
      findById:         vi.fn(),
      findActive:       vi.fn().mockResolvedValue(null),
      hasActiveCampaign:vi.fn().mockResolvedValue(false),
      save:             vi.fn().mockResolvedValue(undefined),
      findHistory:      vi.fn().mockResolvedValue([]),
    };
    const eventStore: IEventStore = { append: vi.fn().mockResolvedValue(undefined) };
    const txManager: ITransactionManager = {
      run: vi.fn().mockImplementation((work) => work({})),
    };

    const handler = new LaunchCampaignHandler(campaignRepo, eventStore, txManager);
    const result = await handler.handle(makeCmd());

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.status).toBe('ACTIVE');
    }
    expect(campaignRepo.save).toHaveBeenCalledOnce();
    expect(eventStore.append).toHaveBeenCalledOnce();
  });

  it('returns CAMPAIGN_ALREADY_ACTIVE when one exists', async () => {
    const campaignRepo: ICampaignRepository = {
      findById:         vi.fn(),
      findActive:       vi.fn(),
      hasActiveCampaign:vi.fn().mockResolvedValue(true),
      save:             vi.fn(),
      findHistory:      vi.fn().mockResolvedValue([]),
    };
    const eventStore: IEventStore = { append: vi.fn() };
    const txManager: ITransactionManager = {
      run: vi.fn().mockImplementation((work) => work({})),
    };

    const handler = new LaunchCampaignHandler(campaignRepo, eventStore, txManager);
    const result = await handler.handle(makeCmd());

    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.code).toBe('CAMPAIGN_ALREADY_ACTIVE');
    }
    expect(campaignRepo.save).not.toHaveBeenCalled();
  });
});
