import { describe, it, expect } from 'vitest';
import { makeFragment, assertFragmentHonest, EvidenceHonestyError, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import { resolveDerivedFrom } from '../../business-model/recompute';

// Stored observed evidence (as the connector would have written it).
const pageAbout = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/about', confidenceKind: 'observed',
  payload: { text: 'We help founders stop guessing and start showing up with clarity.', pageType: 'about' },
});
const pageHome = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/', confidenceKind: 'observed',
  payload: { text: 'The Marketing Clarity Package. Consistent clients without the constant hustle.', pageType: 'home' },
});
const stored = [pageAbout, pageHome];

function modelWith(insightRefs: { statement: string; source: string; fragment: string }[]): BusinessModel {
  return {
    coreBeliefs: [], recurringThemes: [],
    contradictions: insightRefs.map((r) => ({
      statement: r.statement,
      contributingFields: ['claimedPositioning', 'coreBeliefs'],
      evidenceChain: [{ source: r.source, fragment: r.fragment }],
      confidenceKind: 'inferred' as const,
    })),
    blindSpots: [], hiddenStrengths: [], hiddenWeaknesses: [], positioningOpportunities: [],
    marketContext: [{ statement: 'anti-hustle is a crowded category', contextKind: 'category-signal', confidenceKind: 'i-know' }],
    modelConfidence: 'ok',
  } as unknown as BusinessModel;
}

describe('recompute — fail-closed derived_from resolution', () => {
  it('persists an inferred claim whose ref resolves, linked to the REAL stored fragment id', () => {
    const model = modelWith([{ statement: 'Positions on calm but the real pull is clarity-as-relief', source: 'https://acme.co/about', fragment: 'stop guessing and start showing up' }]);
    const { toPersist, rejected } = resolveDerivedFrom('f1', model, stored);

    expect(toPersist).toHaveLength(1);
    expect(rejected).toHaveLength(0);
    const claim = toPersist[0]!;
    expect(claim.confidenceKind).toBe('inferred');
    expect(claim.derivedFrom).toEqual([pageAbout.id]); // real, resolved link — not a guess
    expect(claim.payload.statement).toBe('Positions on calm but the real pull is clarity-as-relief');
  });

  it('REJECTS an inferred claim whose ref resolves to no stored fragment (never persisted)', () => {
    const model = modelWith([{ statement: 'A surprising-but-ungrounded claim', source: 'https://acme.co/about', fragment: 'a phrase that appears on no page at all' }]);
    const { toPersist, rejected } = resolveDerivedFrom('f1', model, stored);

    expect(toPersist).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.statement).toBe('A surprising-but-ungrounded claim');
    expect(rejected[0]!.reason).toMatch(/does not resolve|fail closed/i);
  });

  it('mixed batch: resolvable persisted, unresolvable rejected; marketContext (i-know) never persisted', () => {
    const model = modelWith([
      { statement: 'grounded', source: 'https://acme.co/', fragment: 'consistent clients without the constant hustle' },
      { statement: 'ungrounded', source: 'https://acme.co/', fragment: 'nowhere on the site' },
    ]);
    const { toPersist, rejected } = resolveDerivedFrom('f1', model, stored);

    expect(toPersist.map((f) => f.payload.statement)).toEqual(['grounded']);
    expect(toPersist[0]!.derivedFrom).toEqual([pageHome.id]);
    expect(rejected.map((r) => r.statement)).toEqual(['ungrounded']);
    // i-know market context is prior knowledge, not founder evidence — never in the persist set.
    expect(toPersist.some((f) => f.confidenceKind !== 'inferred')).toBe(false);
    expect(toPersist.some((f) => String(f.payload.category) === 'marketContext')).toBe(false);
  });
});

describe('store-layer honesty gate (mirrors PgEvidenceRepository.append)', () => {
  class FakeRepo implements IEvidenceRepository {
    store = new Map<string, EvidenceFragment>();
    async append(f: EvidenceFragment) {
      assertFragmentHonest({ confidenceKind: f.confidenceKind, sourceUrl: f.sourceUrl, derivedFrom: f.derivedFrom, source: f.source });
      const isNew = !this.store.has(f.id);
      this.store.set(f.id, f);
      return { stored: isNew };
    }
    async appendMany(fs: EvidenceFragment[]) { let s = 0; for (const f of fs) if ((await this.append(f)).stored) s += 1; return { stored: s, deduped: fs.length - s }; }
    async findByFounder() { return [...this.store.values()]; }
    async findObserved() { return [...this.store.values()].filter((f) => f.confidenceKind === 'observed'); }
    async deleteBySource() { /* no-op for test */ }
  }

  it('persists a resolved inferred fragment and refuses one with empty derived_from', async () => {
    const repo = new FakeRepo();
    const model = modelWith([{ statement: 'grounded', source: 'https://acme.co/about', fragment: 'stop guessing and start showing up' }]);
    const { toPersist } = resolveDerivedFrom('f1', model, stored);
    const res = await repo.appendMany(toPersist);
    expect(res.stored).toBe(1);
    expect([...repo.store.values()][0]!.derivedFrom).toEqual([pageAbout.id]);

    // A raw inferred fragment with no provenance must be refused at the store edge (fail closed).
    const fabricated = { ...toPersist[0]!, confidenceKind: 'inferred' as const, derivedFrom: null };
    await expect(repo.append(fabricated)).rejects.toThrow(EvidenceHonestyError);
  });
});
