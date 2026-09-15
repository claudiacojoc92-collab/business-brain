import { describe, it, expect } from 'vitest';
import { summarizeReturn, type ReturnEvent } from '../../telemetry/founder-events';

const at = (s: string): string => `2026-09-1${s}T00:00:00.000Z`;

describe('summarizeReturn — the "since you were last here" aggregation', () => {
  it('a first visit (no anchor) never reports changes', () => {
    const r = summarizeReturn([{ eventType: 'impact_evaluated', metadata: { verdict: 'REVISE', whatChanged: ['x'] }, occurredAt: at('1') }], null);
    expect(r.hasChanges).toBe(false);
    expect(r.since).toBeNull();
  });

  it('folds impact verdicts: strategy moved, Today changed, and the freshest one-thing wins (Trace 4)', () => {
    const events: ReturnEvent[] = [
      { eventType: 'impact_evaluated', metadata: { verdict: 'STILL_HOLDS', whatChanged: ['outcome evidence exists'], todayChanges: true, newMove: 'Follow up with the doctor.' }, occurredAt: at('1') },
      { eventType: 'impact_evaluated', metadata: { verdict: 'REVISE', whatChanged: ['referral assumption weakened'], todayChanges: true, newMove: 'Re-derive the plan.' }, occurredAt: at('2') },
    ];
    const r = summarizeReturn(events, at('0'));
    expect(r.hasChanges).toBe(true);
    expect(r.strategyMoved).toBe(true);                       // a REVISE moved the strategy
    expect(r.todayChanged).toBe(true);
    expect(r.oneThing).toBe('Re-derive the plan.');          // newest newMove wins
    expect(r.changes).toContain('outcome evidence exists');
    expect(r.changes).toContain('referral assumption weakened');
  });

  it('counts completed moves and marks a strategy adoption as a move', () => {
    const events: ReturnEvent[] = [
      { eventType: 'action_marked_done', metadata: {}, occurredAt: at('1') },
      { eventType: 'action_marked_done', metadata: {}, occurredAt: at('2') },
      { eventType: 'strategy_adopted', metadata: {}, occurredAt: at('3') },
    ];
    const r = summarizeReturn(events, at('0'));
    expect(r.strategyMoved).toBe(true);
    expect(r.changes.some((c) => /completed 2 moves/i.test(c))).toBe(true);
  });

  it('an anchor with no events since = a quiet return (no changes)', () => {
    const r = summarizeReturn([], at('0'));
    expect(r.hasChanges).toBe(false);
    expect(r.since).toBe(at('0'));
  });

  it('deduplicates repeated change lines and caps the list', () => {
    const events: ReturnEvent[] = Array.from({ length: 8 }, (_, i) => ({
      eventType: 'impact_evaluated' as const, metadata: { whatChanged: [`change ${i % 2}`] }, occurredAt: at(String(i)),
    }));
    const r = summarizeReturn(events, at('0'));
    expect(r.changes).toEqual(['change 0', 'change 1']); // deduped
    expect(r.changes.length).toBeLessThanOrEqual(4);
  });
});
