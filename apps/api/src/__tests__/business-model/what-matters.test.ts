import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { buildWhatMattersNow, groundedTensions } from '../../business-model/what-matters';

/**
 * Capability C v1 §GATE — C ranks REAL grounded declared-vs-observed tensions as prioritized
 * OBSERVATIONS, fail-closed, never prescriptive. If a C item could render without a grounded
 * declared+observed pair, or the language drifted to prescription, C has gone generic — the one
 * thing that makes it untrustworthy. These tests forbid both.
 */
const FID = 'f1';

const declared = (field: string, text: string) => makeFragment({
  founderId: FID, source: 'founder', platform: null, sourceUrl: `conversation://declared/${field}`,
  confidenceKind: 'declared', visibility: 'private', occurredAt: null, payload: { text, field },
});
const observed = (text: string, url = 'https://acme.co/') => makeFragment({
  founderId: FID, source: 'website', platform: null, sourceUrl: url,
  confidenceKind: 'observed', visibility: 'public', occurredAt: null, payload: { text },
});
const inferred = (category: string, statement: string, derivedFrom: string[]) => makeFragment({
  founderId: FID, source: 'business-model', platform: null, sourceUrl: null,
  confidenceKind: 'inferred', visibility: 'founder_only', derivedFrom, payload: { category, statement },
});

// Prescription/imperative phrasing C must NEVER introduce (mirrors B's "you told me" not "you should").
const PRESCRIPTION = /\b(you should|you must|you need to|do this|try to|consider|recommend|reconcile|fix|start|stop|avoid|focus on|prioriti[sz]e)\b/i;

describe('Capability C §gate — grounded, ranked, observational', () => {
  const dDir = declared('direction', 'We are pivoting to enterprise compliance tooling.');       // central
  const dSucc = declared('success', 'Forty percent enterprise revenue in a year.');              // peripheral
  const oWeb = observed('Calm simple project management for small teams.');
  const oWeb2 = observed('Flat-rate pricing, twenty users, forever free.', 'https://acme.co/pricing');

  const cCentral = inferred('contradictions', 'Your declared enterprise direction contradicts your observed small-team positioning.', [dDir.id, oWeb.id]);
  const bPeriph = inferred('blindSpots', 'Your success target ignores that your observed pricing self-selects against enterprise.', [dSucc.id, oWeb2.id]);
  const wCentral = inferred('hiddenWeaknesses', 'Your declared pivot assumes retention your observed base has no reason to give.', [dDir.id, oWeb.id]);
  const cUngrounded = inferred('contradictions', 'Two observed pages disagree on pricing.', [oWeb.id, oWeb2.id]); // NO declared → not a tension
  const strengthNonTension = inferred('hiddenStrengths', 'Your declared focus aligns with an observed strength.', [dDir.id, oWeb.id]); // not a tension category

  const all: EvidenceFragment[] = [dDir, dSucc, oWeb, oWeb2, cCentral, bPeriph, wCentral, cUngrounded, strengthNonTension];
  const allInferred = [cCentral, bPeriph, wCentral, cUngrounded, strengthNonTension];

  it('GROUNDING (fail closed): only tension claims spanning declared + observed become C items', () => {
    const items = buildWhatMattersNow(allInferred, all);
    expect(items).toHaveLength(3); // cCentral, bPeriph, wCentral — the grounded tensions only
    const statements = items.map((i) => i.statement);
    expect(statements).not.toContain('Two observed pages disagree on pricing.');          // ungrounded (no declared) — excluded
    expect(statements).not.toContain('Your declared focus aligns with an observed strength.'); // non-tension category — excluded
    for (const i of items) {
      expect(i.declaredFragmentIds.length).toBeGreaterThan(0);   // every item spans a declared…
      expect(i.observedFragmentIds.length).toBeGreaterThan(0);   // …AND an observed fragment
      expect(i.fragmentIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('FAIL CLOSED: a tension claim missing the declared OR the observed side cannot render', () => {
    const onlyDeclared = inferred('contradictions', 'declared vs declared', [dDir.id, dSucc.id]);
    const onlyObserved = inferred('contradictions', 'observed vs observed', [oWeb.id, oWeb2.id]);
    expect(groundedTensions([onlyDeclared], new Map(all.map((f) => [f.id, f])))).toHaveLength(0);
    expect(groundedTensions([onlyObserved], new Map(all.map((f) => [f.id, f])))).toHaveLength(0);
    expect(buildWhatMattersNow([onlyDeclared, onlyObserved], all)).toHaveLength(0);
  });

  it('RANKING: contradiction > blindSpot > hiddenWeakness (reversible default)', () => {
    const items = buildWhatMattersNow(allInferred, all);
    expect(items.map((i) => i.category)).toEqual(['contradictions', 'blindSpots', 'hiddenWeaknesses']);
    expect(items[0]!.rank).toBe(1);
  });

  it('OBSERVATION not PRESCRIPTION: C-added stakes never prescribe; statements passed verbatim', () => {
    const items = buildWhatMattersNow(allInferred, all);
    for (const i of items) {
      expect(i.stakes).not.toMatch(PRESCRIPTION);               // C's framing is observational, never "you should…"
      expect(i.stakes.toLowerCase()).toMatch(/tension|pull|gap|matters|apart/); // it is ABOUT the tension/stakes
    }
    // C does not rewrite the engine's observation — statements pass through unchanged
    expect(items.find((i) => i.category === 'contradictions')!.statement).toBe(cCentral.payload['statement']);
  });

  it('empty in → empty out (no grounded tension → no C output)', () => {
    expect(buildWhatMattersNow([], [])).toHaveLength(0);
    expect(buildWhatMattersNow([strengthNonTension], all)).toHaveLength(0); // no tensions at all
  });
});
