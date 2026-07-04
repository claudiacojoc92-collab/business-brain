import { describe, it, expect } from 'vitest';
import { assertFragmentHonest } from '@bb/domain';
import {
  summarizeAllocation, buildCalendarEvidence, calendarUri, CALENDAR_SOURCE, type TimedEvent,
} from '../../connectors/google/calendar-temporal';

/**
 * Calendar Source §4 gate — part 1: temporal evidence as a NEW observed shape TYPES correctly
 * through the UNCHANGED honesty gate, with real calendar:// provenance, and FAILS CLOSED (no
 * fabricated patterns). If temporal evidence could render without real events, or mis-types (not
 * observed / no provenance), the new shape has corrupted the model — these forbid that.
 */
const FID = 'f1';
const at = (dayOffset: number, startHour: number, durH: number): TimedEvent => {
  const start = new Date(Date.UTC(2026, 4, 1 + dayOffset, startHour, 0, 0));
  return { summary: 'x', start, end: new Date(start.getTime() + durH * 3_600_000) };
};

describe('Calendar temporal evidence — §4 gate (typing / provenance / fail-closed)', () => {
  const events: TimedEvent[] = [
    { ...at(0, 9, 2), summary: 'Sales call with prospect Acme' },
    { ...at(0, 13, 1), summary: 'Client demo — Beta Corp' },
    { ...at(1, 10, 3), summary: 'Product roadmap deep work' },
    { ...at(2, 9, 1), summary: 'Team standup' },
    { ...at(2, 14, 2), summary: 'Weekly staff sync' },
    { ...at(3, 11, 1), summary: 'Dentist' }, // unlabeled → other
  ];

  it('measures allocation from REAL events (percent from raw hours, non-empty categories only)', () => {
    const a = summarizeAllocation(events, 60);
    expect(a.totalEvents).toBe(6);
    expect(a.totalHours).toBe(10); // 2+1+3+1+2+1
    const sales = a.categories.find((c) => c.cat === 'sales')!;
    expect(sales.events).toBe(2);
    expect(sales.hours).toBe(3);
    expect(sales.pct).toBe(30); // 3/10
    expect(a.categories.map((c) => c.cat)).not.toContain('marketing'); // no fabricated empty buckets
    expect(a.categories.reduce((n, c) => n + c.pct, 0)).toBeGreaterThan(90); // percentages real, ~100
  });

  it('emits observed evidence through the UNCHANGED gate: source google-calendar, calendar:// URI, private, unit+blocks', () => {
    const frags = buildCalendarEvidence(FID, events, { windowDays: 60, occurredAt: new Date() });
    expect(frags.length).toBeGreaterThanOrEqual(2); // unit + ≥1 category block
    const unit = frags.find((f) => f.payload['kind'] === 'calendar-allocation')!;
    const blocks = frags.filter((f) => f.payload['kind'] === 'block');
    expect(blocks.length).toBe(summarizeAllocation(events, 60).categories.length);

    for (const f of frags) {
      expect(f.confidenceKind).toBe('observed');        // observed BEHAVIOR — not a new kind
      expect(f.source).toBe(CALENDAR_SOURCE);
      expect(f.sourceUrl).toBe(calendarUri(60));
      expect(f.visibility).toBe('private');
      // structural honesty gate would have thrown at makeFragment; re-assert explicitly
      expect(() => assertFragmentHonest({ confidenceKind: f.confidenceKind, sourceUrl: f.sourceUrl, derivedFrom: f.derivedFrom, source: f.source })).not.toThrow();
    }
    // the unit prose states MEASURED numbers, and each block line is a verbatim substring of it
    const unitText = String(unit.payload['text']);
    expect(unitText).toMatch(/scheduled event/);
    for (const b of blocks) expect(unitText).toContain(String(b.payload['text']));
  });

  it('behavior, not strategy: prose is about how TIME was spent (no "is the strategy" laundering)', () => {
    const unit = buildCalendarEvidence(FID, events, { windowDays: 60 }).find((f) => f.payload['kind'] === 'calendar-allocation')!;
    const text = String(unit.payload['text']).toLowerCase();
    expect(text).toMatch(/% of scheduled time/);
    expect(text).not.toMatch(/\bis the strategy\b|\byour business is\b|\bthe market\b/); // observed behavior only
  });

  it('FAIL CLOSED: no events → NO evidence (never a fabricated pattern)', () => {
    expect(buildCalendarEvidence(FID, [], { windowDays: 60 })).toHaveLength(0);
    // zero-duration events measure to zero → no pattern
    const zero: TimedEvent = { summary: 'x', start: new Date(), end: new Date() };
    expect(buildCalendarEvidence(FID, [zero], { windowDays: 60 })).toHaveLength(0);
  });
});
