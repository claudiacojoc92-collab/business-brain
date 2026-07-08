import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { buildWhatMattersNow } from '../../business-model/what-matters';
import {
  reconcileRecompute, applyResponseToThreads, applyDecisionToThreads, type MemoryThread,
} from '../../business-model/thread';
import type { StoredResponse } from '../../business-model/memory';

/**
 * Business Memory v1 §GATE — GROUNDED RESOLUTION, never silent. A thread resolves ONLY via a grounded
 * reason: response='handled', a Decision, or the tension GONE from a fresh recompute. A tension still
 * present with no action stays open; engagement ('matters'/'context') is 'addressed', not resolved; a
 * resolved tension that reappears reopens. Every resolution names its reason.
 */
const FID = 'f1';
const declared = (field: string, text: string) => makeFragment({ founderId: FID, source: 'founder', platform: null, sourceUrl: `conversation://declared/${field}`, confidenceKind: 'declared', visibility: 'private', occurredAt: null, payload: { text, field } });
const observed = (text: string, url: string) => makeFragment({ founderId: FID, source: 'website', platform: null, sourceUrl: url, confidenceKind: 'observed', visibility: 'public', occurredAt: null, payload: { text } });
const inferred = (category: string, statement: string, derivedFrom: string[]) => makeFragment({ founderId: FID, source: 'business-model', platform: null, sourceUrl: null, confidenceKind: 'inferred', visibility: 'founder_only', derivedFrom, payload: { category, statement } });
const byIdOf = (frags: EvidenceFragment[]) => new Map(frags.map((f) => [f.id, f]));
const T0 = new Date('2026-01-01T00:00:00Z');
const T1 = new Date('2026-01-08T00:00:00Z');

// A single open thread grounded on direction↔homepage.
function openThread(): { threads: MemoryThread[]; tensionId: string; items: ReturnType<typeof buildWhatMattersNow>; byId: Map<string, EvidenceFragment> } {
  const dDir = declared('direction', 'Product excellence is our number-one priority.');
  const oWeb = observed('Calm, simple project management for small teams.', 'https://acme.co/');
  const t = inferred('contradictions', 'Excellence-first vs the small-team simplicity you show.', [dDir.id, oWeb.id]);
  const all = [dDir, oWeb, t];
  const items = buildWhatMattersNow([t], all);
  const byId = byIdOf(all);
  const r = reconcileRecompute(FID, [], items, byId, T0);
  return { threads: r.threads, tensionId: t.id, items, byId };
}

describe('Memory v1 §gate — thread resolves ONLY on a grounded reason, never silently', () => {
  it('RESOLVE via response=handled → resolved(handled)', () => {
    const { threads, tensionId } = openThread();
    const resp: StoredResponse = { choice: 'handled', text: 'We repriced and refocused last month.', fragmentId: 'x' };
    const [t] = applyResponseToThreads(threads, tensionId, resp, T1);
    expect(t!.status).toBe('resolved');
    expect(t!.resolvedReason).toBe('handled');
    expect(t!.history.at(-1)).toMatchObject({ event: 'resolved', reason: 'handled' });
  });

  it('RESOLVE via decision → resolved(decision)', () => {
    const { threads, tensionId } = openThread();
    const [t] = applyDecisionToThreads(threads, tensionId, T1);
    expect(t!.status).toBe('resolved');
    expect(t!.resolvedReason).toBe('decision');
    expect(t!.history.at(-1)).toMatchObject({ event: 'resolved', reason: 'decision' });
  });

  it('RESOLVE via tension-gone: absent from a FRESH recompute → resolved(tension_gone)', () => {
    const { threads } = openThread();
    // A fresh recompute produced NO grounded tensions → the tension is gone (grounded in this recompute).
    const r = reconcileRecompute(FID, threads, [], new Map(), T1);
    expect(r.resolvedGone).toHaveLength(1);
    expect(r.threads[0]!.status).toBe('resolved');
    expect(r.threads[0]!.resolvedReason).toBe('tension_gone');
    expect(r.threads[0]!.history.at(-1)).toMatchObject({ event: 'resolved', reason: 'tension_gone' });
  });

  it('NO REASON → STAYS OPEN: the tension still present in a fresh recompute never resolves it', () => {
    const { threads, items, byId } = openThread();
    const r = reconcileRecompute(FID, threads, items, byId, T1); // same tension present again
    expect(r.threads[0]!.status).not.toBe('resolved');
    expect(r.threads[0]!.status).toBe('recurring');
    expect(r.threads[0]!.resolvedReason).toBeNull();
    expect(r.resolvedGone).toHaveLength(0);
  });

  it('ENGAGEMENT is not resolution: response=matters/context → addressed, NOT resolved', () => {
    for (const choice of ['matters', 'context'] as const) {
      const { threads, tensionId } = openThread();
      const [t] = applyResponseToThreads(threads, tensionId, { choice, text: '', fragmentId: 'x' }, T1);
      expect(t!.status).toBe('addressed');
      expect(t!.resolvedReason).toBeNull();
      expect(t!.history.at(-1)).toMatchObject({ event: 'addressed' });
    }
  });

  it('REOPEN: a resolved thread whose tension reappears in a fresh recompute → recurring (not stuck resolved)', () => {
    const { threads } = openThread();
    const resolved = reconcileRecompute(FID, threads, [], new Map(), T0).threads; // tension_gone
    expect(resolved[0]!.status).toBe('resolved');
    // Later recompute surfaces the same grounded tension again.
    const { items, byId } = openThread();
    const r = reconcileRecompute(FID, resolved, items, byId, T1);
    expect(r.threads).toHaveLength(1);
    expect(r.threads[0]!.status).toBe('recurring');
    expect(r.threads[0]!.resolvedReason).toBeNull();
  });

  it('NEVER SILENT: across every transition, status==="resolved" IFF a grounded reason is set', () => {
    const { threads, tensionId, items, byId } = openThread();
    const universe: MemoryThread[] = [
      ...applyResponseToThreads(threads, tensionId, { choice: 'handled', text: '', fragmentId: 'x' }, T1),
      ...applyResponseToThreads(threads, tensionId, { choice: 'matters', text: '', fragmentId: 'x' }, T1),
      ...applyDecisionToThreads(threads, tensionId, T1),
      ...reconcileRecompute(FID, threads, [], new Map(), T1).threads,
      ...reconcileRecompute(FID, threads, items, byId, T1).threads,
    ];
    for (const t of universe) {
      expect(t.status === 'resolved').toBe(t.resolvedReason !== null);
      for (const e of t.history) expect(e.event === 'resolved').toBe(e.reason != null);
    }
  });
});
