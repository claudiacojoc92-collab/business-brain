import { describe, it, expect } from 'vitest';
import {
  FounderStatus,
  MarketingMode,
  MemoryLayer,
  ApprovalStatus,
  CampaignType,
  CampaignStatus,
  EditType,
  RejectionReasonCode,
  OutcomeType,
  SignalType,
} from '../../enums/index';

describe('Enum value counts', () => {
  it('FounderStatus has 7 values', () => {
    expect(Object.keys(FounderStatus)).toHaveLength(7);
  });
  it('MarketingMode has 4 values', () => {
    expect(Object.keys(MarketingMode)).toHaveLength(4);
  });
  it('MemoryLayer has 9 values', () => {
    expect(Object.keys(MemoryLayer)).toHaveLength(9);
  });
  it('ApprovalStatus has 5 values including AUTO_APPROVED (F004)', () => {
    expect(Object.keys(ApprovalStatus)).toHaveLength(5);
    expect(ApprovalStatus.AUTO_APPROVED).toBe('AUTO_APPROVED');
  });
  it('RejectionReasonCode has 10 values (F003 correction)', () => {
    expect(Object.keys(RejectionReasonCode)).toHaveLength(10);
  });
  it('EditType has 11 values', () => {
    expect(Object.keys(EditType)).toHaveLength(11);
  });
  it('CampaignType has 5 values', () => {
    expect(Object.keys(CampaignType)).toHaveLength(5);
  });
  it('CampaignStatus has 6 values', () => {
    expect(Object.keys(CampaignStatus)).toHaveLength(6);
  });
  it('OutcomeType has 5 values', () => {
    expect(Object.keys(OutcomeType)).toHaveLength(5);
  });
  it('SignalType has 4 values', () => {
    expect(Object.keys(SignalType)).toHaveLength(4);
  });
});

describe('Critical enum values', () => {
  it('FounderStatus.ACTIVE exists', () => {
    expect(FounderStatus.ACTIVE).toBe('ACTIVE');
  });
  it('MemoryLayer.AUDIENCE_TEMPERATURE exists', () => {
    expect(MemoryLayer.AUDIENCE_TEMPERATURE).toBe('AUDIENCE_TEMPERATURE');
  });
  it('RejectionReasonCode.CTA_AGGRESSIVE exists (F003)', () => {
    expect(RejectionReasonCode.CTA_AGGRESSIVE).toBe('CTA_AGGRESSIVE');
  });
  it('ApprovalStatus.AUTO_APPROVED exists (F004)', () => {
    expect(ApprovalStatus.AUTO_APPROVED).toBe('AUTO_APPROVED');
  });
});
