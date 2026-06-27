import { describe, it, expect } from 'vitest';
import { OutcomeReport } from '../../../outcome/entities/outcome-report.entity';
import { generateId } from '@bb/shared';

const NOW = new Date('2025-01-06T04:00:00Z');

function makeReport(): OutcomeReport {
  return new OutcomeReport({
    id:                    generateId(),
    founderId:             'f-01',
    outcomeType:           'DISCOVERY_CALL',
    description:           null,
    isImplicit:            false,
    attributionStatus:     'REPORTED',
    attributionConfidence: null,
    precedingCycleIds:     [],
    precedingModes:        [],
    confirmedAt:           null,
    reportedAt:            NOW,
  });
}

describe('OutcomeReport', () => {
  it('starts in REPORTED status', () => {
    expect(makeReport().attributionStatus).toBe('REPORTED');
  });

  it('isConfirmed() returns false initially', () => {
    expect(makeReport().isConfirmed()).toBe(false);
  });

  it('confirm() transitions to CONFIRMED', () => {
    const r = makeReport();
    r.confirm({
      confidence:        0.82,
      precedingCycleIds: ['c-01', 'c-02'],
      precedingModes:    ['AUTHORITY', 'TRUST'],
      confirmedAt:       NOW,
    });
    expect(r.attributionStatus).toBe('CONFIRMED');
    expect(r.attributionConfidence).toBe(0.82);
    expect(r.precedingModes).toEqual(['AUTHORITY', 'TRUST']);
    expect(r.isConfirmed()).toBe(true);
  });
});
