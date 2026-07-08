import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { buildWhatMattersNow } from '../../business-model/what-matters';
import { groundedAnchors, reconcileRecompute, type MemoryThread } from '../../business-model/thread';

/**
 * Business Memory v1 §GATE — THREAD IDENTITY (the whole risk). A thread is matched across recomputes
 * by GROUNDED CONTENT (category + declared FIELD + observed SOURCE-KEY), NEVER by the tension id. These
 * prove both directions and consciously document the same-cell boundary:
 *   - recurring-not-recreated: the same declared-field↔observed-page tension across recomputes → the
 *     SAME thread, marked recurring, DESPITE tensionId + statement + evidence-fragment churn;
 *   - distinct-not-collapsed: a plausibly-confusable distinct case (contradiction on `direction` vs on
 *     `target`, same website page) → DISTINCT threads;
 *   - same-cell boundary: two substantively different tensions sharing (category, field, page) collapse
 *     to ONE thread — the accepted v1 DEFINITION of a thread, stated explicitly, not a silent merge.
 */
const FID = 'f1';
const declared = (field: string, text: string) => makeFragment({ founderId: FID, source: 'founder', platform: null, sourceUrl: `conversation://declared/${field}`, confidenceKind: 'declared', visibility: 'private', occurredAt: null, payload: { text, field } });
const observed = (text: string, url: string) => makeFragment({ founderId: FID, source: 'website', platform: null, sourceUrl: url, confidenceKind: 'observed', visibility: 'public', occurredAt: null, payload: { text } });
const inferred = (category: string, statement: string, derivedFrom: string[]) => makeFragment({ founderId: FID, source: 'business-model', platform: null, sourceUrl: null, confidenceKind: 'inferred', visibility: 'founder_only', derivedFrom, payload: { category, statement } });
const byIdOf = (frags: EvidenceFragment[]) => new Map(frags.map((f) => [f.id, f]));
const T0 = new Date('2026-01-01T00:00:00Z');
const T1 = new Date('2026-01-08T00:00:00Z');

describe('Memory v1 §gate — thread identity by grounded content, not tensionId', () => {
  it('RECURRING-NOT-RECREATED: same declared-field↔observed-page tension across recomputes → same thread, DESPITE tensionId churn', () => {
    const dDir = declared('direction', 'Product excellence is our number-one priority this year.');

    // Recompute #1
    const oWeb1 = observed('Calm, simple project management for small teams.', 'https://acme.co/');
    const t1 = inferred('contradictions', 'Your declared product-excellence priority contradicts your observed small-team positioning.', [dDir.id, oWeb1.id]);
    const all1 = [dDir, oWeb1, t1];
    const items1 = buildWhatMattersNow([t1], all1);
    const r1 = reconcileRecompute(FID, [], items1, byIdOf(all1), T0);
    expect(r1.threads).toHaveLength(1);
    expect(r1.opened).toHaveLength(1);
    expect(r1.threads[0]!.status).toBe('open');
    expect(r1.threads[0]!.currentTensionId).toBe(t1.id);

    // Recompute #2 — evidence re-crawled (SAME page url, DIFFERENT text → new fragment id) AND the
    // engine reworded the statement → a DIFFERENT tensionId. Grounding is unchanged.
    const oWeb2 = observed('We help small teams stay calm — straightforward project management.', 'https://acme.co/');
    const t2 = inferred('contradictions', 'The excellence-first claim you stated sits in tension with the small-team simplicity your site sells.', [dDir.id, oWeb2.id]);
    const all2 = [dDir, oWeb2, t2];
    const items2 = buildWhatMattersNow([t2], all2);

    // The id churned, but the grounded signature is identical.
    expect(t2.id).not.toBe(t1.id);
    expect(groundedAnchors(items2[0]!, byIdOf(all2)).signature).toBe(groundedAnchors(items1[0]!, byIdOf(all1)).signature);

    const r2 = reconcileRecompute(FID, r1.threads, items2, byIdOf(all2), T1);
    expect(r2.threads).toHaveLength(1);          // NOT re-created
    expect(r2.opened).toHaveLength(0);
    expect(r2.recurred).toHaveLength(1);
    const th = r2.threads[0]!;
    expect(th.status).toBe('recurring');
    expect(th.recurrenceCount).toBe(2);
    expect(th.currentTensionId).toBe(t2.id);      // relinked to the live tension
    expect(th.signature).toBe(r1.threads[0]!.signature);
    expect(th.history.map((e) => e.event)).toEqual(['opened', 'recurred']);
  });

  it('DISTINCT-NOT-COLLAPSED: contradiction on `direction` vs contradiction on `target` (same page) → distinct threads', () => {
    const dDir = declared('direction', 'Product excellence is our number-one priority.');
    const dTgt = declared('target', 'We are built for large enterprise buyers.');
    const oWeb = observed('Calm, simple project management for small teams.', 'https://acme.co/');
    const tDir = inferred('contradictions', 'Excellence-first vs the small-team simplicity you show.', [dDir.id, oWeb.id]);
    const tTgt = inferred('contradictions', 'Enterprise target vs the small-team audience you show.', [dTgt.id, oWeb.id]);
    const all = [dDir, dTgt, oWeb, tDir, tTgt];
    const items = buildWhatMattersNow([tDir, tTgt], all);
    const byId = byIdOf(all);

    // Same category, same page — but different declared FIELD → different grounded signature.
    expect(groundedAnchors(items[0]!, byId).signature).not.toBe(groundedAnchors(items[1]!, byId).signature);

    const r = reconcileRecompute(FID, [], items, byId, T0);
    expect(r.threads).toHaveLength(2);            // NOT merged
    expect(r.opened).toHaveLength(2);
    const fields = r.threads.flatMap((t) => t.declaredFields).sort();
    expect(fields).toEqual(['direction', 'target']);
  });

  it('SAME-CELL BOUNDARY (accepted v1 definition): two DISTINCT tensions sharing (category, field, page) → ONE thread', () => {
    // Two substantively different contradictions, both grounded on declared `direction` vs the SAME
    // homepage. Distinct tensions (distinct tensionIds) — but by the v1 definition a "thread" IS the
    // ongoing tension between a declared field and an observed surface, so they share one thread. This
    // is a CONSCIOUS boundary, asserted here so it can never become a silent merge.
    const dDir = declared('direction', 'Product excellence is our number-one priority.');
    const oWeb = observed('Calm, simple project management for small teams.', 'https://acme.co/');
    const tA = inferred('contradictions', 'Excellence-first vs the simplicity your homepage sells.', [dDir.id, oWeb.id]);
    const tB = inferred('contradictions', 'Excellence-first vs the low-touch, self-serve motion your homepage implies.', [dDir.id, oWeb.id]);
    const all = [dDir, oWeb, tA, tB];
    const items = buildWhatMattersNow([tA, tB], all);
    const byId = byIdOf(all);

    expect(tA.id).not.toBe(tB.id);                                                     // genuinely distinct tensions
    expect(groundedAnchors(items[0]!, byId).signature).toBe(groundedAnchors(items[1]!, byId).signature); // same grounded cell

    const r = reconcileRecompute(FID, [], items, byId, T0);
    expect(r.threads).toHaveLength(1);            // collapsed into one thread — the accepted definition
    expect(r.threads[0]!.recurrenceCount).toBe(2);
    expect(r.threads[0]!.declaredFields).toEqual(['direction']);
  });
});
