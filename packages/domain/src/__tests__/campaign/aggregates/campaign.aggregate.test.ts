import { describe, it, expect } from 'vitest';
import { Campaign } from '../../../campaign/aggregates/campaign.aggregate';
import { CampaignPhase } from '../../../campaign/entities/campaign-phase.entity';
import { generateId } from '@bb/shared';

const NOW   = new Date('2025-01-06T04:00:00Z');
const CORR  = 'corr-01';
const TRACE = 'trace-01';

function makePhase(phaseIndex: number): CampaignPhase {
  return new CampaignPhase({
    id:                     generateId(),
    campaignId:             'campaign-01',
    founderId:              'f-01',
    phaseIndex,
    mode:                   'EDUCATION',
    beliefTarget:           'That consistent content builds authority.',
    expectedAudienceChange: 'Audience moves from COLD to WARM.',
    assignedCycleId:        null,
    executedAt:             null,
  });
}

describe('Campaign.launch', () => {
  it('creates ACTIVE campaign when no active campaign exists', () => {
    const result = Campaign.launch({
      campaignId:       generateId(),
      founderId:        'f-01',
      campaignType:     'POSITIONING',
      beliefTarget:     'Authority in service marketing.',
      successCriteria:  {},
      maxDurationWeeks: 8,
      phases:           [makePhase(0), makePhase(1)],
      hasActiveCampaign:false,
      correlationId:    CORR,
      traceId:          TRACE,
      now:              NOW,
    });
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.status).toBe('ACTIVE');
      const events = result.value.pullEvents();
      expect(events[0]?.event_type).toBe('campaign.Campaign.CampaignCreated');
    }
  });

  it('fails when active campaign already exists', () => {
    const result = Campaign.launch({
      campaignId:       generateId(),
      founderId:        'f-01',
      campaignType:     'POSITIONING',
      beliefTarget:     'Authority.',
      successCriteria:  {},
      maxDurationWeeks: 8,
      phases:           [makePhase(0)],
      hasActiveCampaign:true,
      correlationId:    CORR,
      traceId:          TRACE,
      now:              NOW,
    });
    expect(result.isErr).toBe(true);
    expect(result.isErr && result.error.code).toBe('CAMPAIGN_ALREADY_ACTIVE');
  });

  it('fails with no phases', () => {
    const result = Campaign.launch({
      campaignId:       generateId(),
      founderId:        'f-01',
      campaignType:     'POSITIONING',
      beliefTarget:     'Authority.',
      successCriteria:  {},
      maxDurationWeeks: 8,
      phases:           [],
      hasActiveCampaign:false,
      correlationId:    CORR,
      traceId:          TRACE,
      now:              NOW,
    });
    expect(result.isErr).toBe(true);
    expect(result.isErr && result.error.code).toBe('CAMPAIGN_NO_PHASES');
  });
});

describe('Campaign.interrupt', () => {
  function makeActiveCampaign(): Campaign {
    const r = Campaign.launch({
      campaignId:       generateId(),
      founderId:        'f-01',
      campaignType:     'POSITIONING',
      beliefTarget:     'Authority.',
      successCriteria:  {},
      maxDurationWeeks: 8,
      phases:           [makePhase(0)],
      hasActiveCampaign:false,
      correlationId:    CORR,
      traceId:          TRACE,
      now:              NOW,
    });
    if (r.isErr) throw new Error('setup failed');
    r.value.pullEvents();
    return r.value;
  }

  it('transitions to INTERRUPTED', () => {
    const c = makeActiveCampaign();
    const result = c.interrupt({
      reason:        'Business evolution detected.',
      interruptedBy: 'BUSINESS_EVOLUTION',
      correlationId: CORR,
      traceId:       TRACE,
      now:           NOW,
    });
    expect(result.isOk).toBe(true);
    expect(c.status).toBe('INTERRUPTED');
    const events = c.pullEvents();
    expect(events[0]?.event_type).toBe('campaign.Campaign.CampaignInterrupted');
  });

  it('fails if campaign not ACTIVE', () => {
    const c = makeActiveCampaign();
    c.interrupt({
      reason: 'First.', interruptedBy: 'FOUNDER',
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    c.pullEvents();
    const result = c.interrupt({
      reason: 'Second.', interruptedBy: 'FOUNDER',
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isErr).toBe(true);
    expect(result.isErr && result.error.code).toBe('CAMPAIGN_NOT_ACTIVE');
  });
});
