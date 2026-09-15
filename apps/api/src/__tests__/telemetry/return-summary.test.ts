import { describe, it, expect } from 'vitest';
import { summarizeReturn, summarizeTodayNote, type ReturnEvent } from '../../telemetry/founder-events';

const NOW = '2026-09-15T12:00:00.000Z';
const daysAgo = (n: number): string => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString();
const minsAgo = (n: number): string => new Date(new Date(NOW).getTime() - n * 60_000).toISOString();

describe('summarizeReturn — "since you were last here" survives a real absence', () => {
  it('a first visit (no anchor) never shows the block', () => {
    const r = summarizeReturn([{ eventType: 'impact_evaluated', metadata: { verdict: 'REVISE', whatChanged: ['x'] }, occurredAt: daysAgo(3) }], null, NOW);
    expect(r.show).toBe(false);
    expect(r.since).toBeNull();
  });

  it('same-session return (gap < 30 min) is suppressed — no block', () => {
    const r = summarizeReturn([{ eventType: 'strategy_adopted', metadata: { version: 2 }, occurredAt: minsAgo(5) }], minsAgo(10), NOW);
    expect(r.show).toBe(false);
    expect(r.awayHours).toBe(0);
  });

  it('a QUIET week (real absence, nothing happened) shows a calm, honest block — no invented activity', () => {
    const r = summarizeReturn([], daysAgo(7), NOW);
    expect(r.show).toBe(true);            // a real absence → the block appears
    expect(r.hasChanges).toBe(false);     // …but says nothing moved
    expect(r.changes).toEqual([]);
    expect(r.strategyMoved).toBe(false);
    expect(r.awayHours).toBeGreaterThanOrEqual(168);
  });

  it('a BUSY week produces a meaningful summary: strategy moved, Today changed, freshest one-thing wins', () => {
    const events: ReturnEvent[] = [
      { eventType: 'impact_evaluated', metadata: { verdict: 'STILL_HOLDS', whatChanged: ['outcome evidence exists'], todayChanges: true, newMove: 'Follow up with the doctor.' }, occurredAt: daysAgo(5) },
      { eventType: 'impact_evaluated', metadata: { verdict: 'REVISE', whatChanged: ['referral assumption weakened'], todayChanges: true, newMove: 'Re-derive the plan.' }, occurredAt: daysAgo(2) },
      { eventType: 'action_marked_done', metadata: {}, occurredAt: daysAgo(1) },
    ];
    const r = summarizeReturn(events, daysAgo(7), NOW);
    expect(r.show).toBe(true);
    expect(r.hasChanges).toBe(true);
    expect(r.strategyMoved).toBe(true);
    expect(r.todayChanged).toBe(true);
    expect(r.oneThing).toBe('Re-derive the plan.');
    expect(r.changes).toContain('referral assumption weakened');
    expect(r.changes.some((c) => /completed a move/i.test(c))).toBe(true);
  });

  it('deduplicates repeated change lines and caps the list', () => {
    const events: ReturnEvent[] = Array.from({ length: 8 }, (_, i) => ({
      eventType: 'impact_evaluated' as const, metadata: { whatChanged: [`change ${i % 2}`] }, occurredAt: daysAgo(6 - (i % 6)),
    }));
    const r = summarizeReturn(events, daysAgo(7), NOW);
    expect(r.changes.filter((c) => c === 'change 0')).toHaveLength(1); // deduped
    expect(r.changes.length).toBeLessThanOrEqual(4);
  });
});

describe('summarizeTodayNote — "Today updated because …"', () => {
  it('reports a recent strategy adoption with its version', () => {
    const n = summarizeTodayNote([{ eventType: 'strategy_adopted', metadata: { version: 3 }, occurredAt: minsAgo(5) }], NOW);
    expect(n).toEqual({ kind: 'strategy_adopted', version: 3 });
  });

  it('reports a recent TUNE reason when Today changed', () => {
    const n = summarizeTodayNote([{ eventType: 'impact_evaluated', metadata: { todayChanges: true, todayReason: 'Execution shifts, the bet does not.' }, occurredAt: minsAgo(2) }], NOW);
    expect(n).toEqual({ kind: 'impact', reason: 'Execution shifts, the bet does not.' });
  });

  it('the freshest qualifying event wins; ignores events older than 24h and non-Today-changing ones', () => {
    const n = summarizeTodayNote([
      { eventType: 'strategy_adopted', metadata: { version: 2 }, occurredAt: daysAgo(3) },        // too old
      { eventType: 'impact_evaluated', metadata: { todayChanges: false }, occurredAt: minsAgo(30) }, // no Today change
      { eventType: 'strategy_adopted', metadata: { version: 4 }, occurredAt: minsAgo(10) },        // freshest qualifying
    ], NOW);
    expect(n).toEqual({ kind: 'strategy_adopted', version: 4 });
  });

  it('returns null when nothing qualifies', () => {
    expect(summarizeTodayNote([], NOW)).toBeNull();
  });
});
