import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import { resolveDerivedFrom, enforceEpistemicCeiling } from '../../business-model/recompute';
import { buildWhatMattersNow } from '../../business-model/what-matters';
import { buildCalendarEvidence, calendarUri, type TimedEvent } from '../../connectors/google/calendar-temporal';

/**
 * Calendar Source §4 gate — part 2 (the heart): temporal evidence FUSES with declared intent
 * through the EXISTING fail-closed resolution path (no engine change), producing a grounded
 * TIME-VS-INTENT tension that C ranks as an observation — AND the epistemic ceiling still forbids
 * laundering time-allocation into an external-reality claim. Proven WITHOUT a live engine: we hand
 * resolveDerivedFrom an engine-shaped model whose evidence chain cites the real calendar prose + the
 * real declared text, exactly as the frozen engine would.
 */
const FID = 'f1';
const PRESCRIPTION = /\b(you should|you must|you need to|do this|try to|consider|recommend|reconcile|fix|start|stop|avoid|focus on|prioriti[sz]e)\b/i;

// Real calendar evidence (unit + category blocks) from real timed events.
const ev = (day: number, hour: number, durH: number, summary: string): TimedEvent => {
  const start = new Date(Date.UTC(2026, 4, 1 + day, hour, 0, 0));
  return { summary, start, end: new Date(start.getTime() + durH * 3_600_000) };
};
const calendarFrags = buildCalendarEvidence(FID, [
  ev(0, 9, 3, 'Sales call — prospect Acme'),
  ev(1, 10, 1, 'Client demo Beta'),
  ev(2, 9, 2, 'Product roadmap deep work'),
], { windowDays: 60, occurredAt: new Date(Date.UTC(2026, 5, 30)) });

// Declared intent (unit + block, source 'founder', kind 'declared'), mirroring declared capture.
const declaredText = 'Product excellence is our number one priority this year.';
const declaredUnit = makeFragment({
  founderId: FID, source: 'founder', sourceUrl: 'conversation://declared/direction',
  confidenceKind: 'declared', visibility: 'private', payload: { text: declaredText, field: 'direction', label: 'Direction' },
});
const declaredBlock = makeFragment({
  founderId: FID, source: 'founder', sourceUrl: 'conversation://declared/direction',
  confidenceKind: 'declared', visibility: 'private', payload: { kind: 'block', text: declaredText, blockType: 'answer' },
});

const stored: EvidenceFragment[] = [...calendarFrags, declaredUnit, declaredBlock];
const salesLine = 'Sales & client: '; // prefix of the real measured category line, present verbatim in unit + block

// An engine-shaped model: ONE contradiction citing declared intent + the calendar behavior prose.
const modelWithTension = {
  contradictions: [{
    statement: 'You told me product excellence is your top priority, yet your calendar shows the largest share of scheduled time going to sales and client meetings.',
    contributingFields: ['coreBeliefs', 'observedPositioning'],
    evidenceChain: [
      { source: 'conversation://declared/direction', fragment: 'Product excellence is our number one priority' },
      { source: calendarUri(60), fragment: fullSalesLine() },
    ],
    confidenceKind: 'inferred',
  }],
} as unknown as BusinessModel;

function fullSalesLine(): string {
  // the verbatim sales category line the engine would quote from the unit prose
  const block = calendarFrags.find((f) => f.payload['kind'] === 'block' && f.payload['category'] === 'sales');
  return String(block?.payload['text'] ?? salesLine);
}

describe('Calendar fusion — §4 gate (fuses to a time-vs-intent tension; ceiling holds)', () => {
  it('temporal evidence + declared intent RESOLVE through the fail-closed path (spans both kinds)', () => {
    const { toPersist, rejected } = resolveDerivedFrom(FID, modelWithTension, stored);
    expect(rejected).toHaveLength(0);            // both refs resolve → not rejected
    expect(toPersist).toHaveLength(1);
    const derived = toPersist[0]!.derivedFrom ?? [];
    const byId = new Map(stored.map((f) => [f.id, f]));
    const kinds = derived.map((id) => byId.get(id)).filter(Boolean);
    expect(kinds.some((f) => f!.source === 'google-calendar' && f!.confidenceKind === 'observed')).toBe(true); // calendar behavior
    expect(kinds.some((f) => f!.source === 'founder' && f!.confidenceKind === 'declared')).toBe(true);         // declared intent
  });

  it('C ranks it as a grounded time-vs-intent tension — observation, not prescription', () => {
    const { toPersist } = resolveDerivedFrom(FID, modelWithTension, stored);
    const all = [...stored, ...toPersist];
    const items = buildWhatMattersNow(toPersist, all);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.rank).toBe(1);
    expect(item.category).toBe('contradictions');
    expect(item.declaredFragmentIds.length).toBeGreaterThan(0);  // grounded in a REAL declared fragment…
    expect(item.observedFragmentIds.length).toBeGreaterThan(0);  // …AND a REAL calendar observed fragment
    expect(item.statement).toBe(modelWithTension.contradictions![0]!.statement); // engine verbatim — C never rewrites
    expect(item.stakes).not.toMatch(PRESCRIPTION);               // observation about stakes, never "you should…"
  });

  it('FAIL CLOSED: a tension citing a calendar quote that is NOT in the evidence is rejected', () => {
    const bogus = {
      contradictions: [{
        statement: 'fabricated',
        contributingFields: [],
        evidenceChain: [{ source: calendarUri(60), fragment: 'Marketing & growth: 80% of scheduled time (99 of 99 hours)' }],
        confidenceKind: 'inferred',
      }],
    } as unknown as BusinessModel;
    const { toPersist, rejected } = resolveDerivedFrom(FID, bogus, stored);
    expect(toPersist).toHaveLength(0);
    expect(rejected).toHaveLength(1); // the quote resolves to no stored fragment → not persisted
  });

  it('EPISTEMIC CEILING: marketContext may NOT cite calendar behavior (no laundering to external fact)', () => {
    const laundering = {
      marketContext: [{
        statement: 'The consulting market rewards founders who spend most of their time selling.',
        contextKind: 'market-pattern',
        evidenceChain: [{ source: calendarUri(60), fragment: fullSalesLine() }],
      }],
    } as unknown as BusinessModel;
    const violations = enforceEpistemicCeiling(laundering);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toMatch(/epistemic ceiling/i);
  });
});
