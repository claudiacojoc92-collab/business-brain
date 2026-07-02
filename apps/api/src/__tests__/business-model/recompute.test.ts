import { describe, it, expect } from 'vitest';
import { makeFragment, assertFragmentHonest, EvidenceHonestyError, type EvidenceFragment, type IEvidenceRepository } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import { resolveDerivedFrom, resolveEvidenceRef } from '../../business-model/recompute';

// Stored observed evidence: a PAGE fragment per page (engine input + PASS test) PLUS BLOCK
// fragments (derived_from provenance). Resolution passes on the page blob, then credits the
// specific block(s) that share a substantive run of the quote.
const pageAbout = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/about', confidenceKind: 'observed',
  payload: { text: 'We help founders stop guessing and start showing up with clarity.', pageType: 'about' },
});
const blockAbout = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/about', confidenceKind: 'observed',
  payload: { kind: 'block', blockType: 'p', text: 'We help founders stop guessing and start showing up with clarity.', pageType: 'about' },
});
const blockHomeHeading = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/', confidenceKind: 'observed',
  payload: { kind: 'block', blockType: 'h1', text: 'The complete marketing clarity package for founders', pageType: 'home' },
});
const blockHomeBody = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/', confidenceKind: 'observed',
  payload: { kind: 'block', blockType: 'p', text: 'Consistent clients without the constant hustle or burnout.', pageType: 'home' },
});
const blockWin = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/', confidenceKind: 'observed',
  payload: { kind: 'block', blockType: 'p', text: 'We win.', pageType: 'home' },
});
// PAGE blob concatenates the block texts (as body.text does) + an orphan span present in NO block.
const pageHome = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/', confidenceKind: 'observed',
  payload: { text: 'The complete marketing clarity package for founders Consistent clients without the constant hustle or burnout. We win. An orphan sentence living only in a bare container element.', pageType: 'home' },
});
const stored = [pageAbout, pageHome, blockAbout, blockHomeHeading, blockHomeBody, blockWin];

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

describe('resolveEvidenceRef — page-blob PASS, block-credit provenance', () => {
  it('passes on the page blob and credits the SPECIFIC block the quote is within', () => {
    const ids = resolveEvidenceRef({ source: 'https://acme.co/about', fragment: 'stop guessing and start showing up with clarity' }, stored);
    expect(ids).toEqual([blockAbout.id]); // specific block, never the page fragment
  });

  it('a quote spanning two blocks credits BOTH specific blocks (each shares a substantive run)', () => {
    const ids = resolveEvidenceRef(
      { source: 'https://acme.co/', fragment: 'The complete marketing clarity package for founders Consistent clients without the constant hustle' },
      stored,
    );
    expect(new Set(ids)).toEqual(new Set([blockHomeHeading.id, blockHomeBody.id]));
  });

  it('NO coincidental block credit: a short quote on the page does not credit a block sharing only a short run', () => {
    // "We win." IS in the page blob (PASS) and IS a whole block, but the shared run is below the
    // credit floor → the block is not credited → ref maps to no block → dropped (fail closed).
    const ids = resolveEvidenceRef({ source: 'https://acme.co/', fragment: 'We win.' }, stored);
    expect(ids).toEqual([]);
  });

  it('fails closed when the quote is not a contiguous substring of any page blob', () => {
    const ids = resolveEvidenceRef({ source: 'https://acme.co/about', fragment: 'a sentence that is nowhere on the page at all whatsoever' }, stored);
    expect(ids).toEqual([]);
  });

  it('unmappable edge case: passes the page blob but no block covers it → dropped, page NEVER credited', () => {
    // The orphan sentence is in the PAGE blob but in no block fragment.
    const ids = resolveEvidenceRef({ source: 'https://acme.co/', fragment: 'An orphan sentence living only in a bare container element' }, stored);
    expect(ids).toEqual([]); // one-way ratchet: never falls back to the page fragment id
    expect(ids).not.toContain(pageHome.id);
  });
});

describe('group blocks — most-specific-wins + floor gates group-scale coincidence', () => {
  const mk = (kind: string, blockType: string, text: string) => makeFragment({
    founderId: 'f1', source: 'website', sourceUrl: 'https://g.co/', confidenceKind: 'observed',
    payload: kind === 'page' ? { text, pageType: 'home' } : { kind: 'block', blockType, text, pageType: 'home' },
  });
  const page = mk('page', '', 'Revenue earned each year by publications running on the platform. Alpha beta gamma delta epsilon.');

  it('prefers the LEAF when a sentence covers the quote — the enclosing group is not credited', () => {
    const leaf = mk('block', 'p', 'Revenue earned each year by publications running on the platform.');
    const group = mk('block', 'group', 'Revenue earned each year by publications running on the platform. Plus more section copy for length.');
    const ids = resolveEvidenceRef({ source: 'https://g.co/', fragment: 'Revenue earned each year by publications running on the platform' }, [page, leaf, group]);
    expect(ids).toEqual([leaf.id]); // smallest covering block wins; group adds no new coverage
  });

  it('credits the GROUP only for a cross-block span no leaf covers', () => {
    const tileA = mk('block', 'div', 'Revenue earned each year');            // 4-word leaf → no ≥5 run
    const tileB = mk('block', 'div', 'by publications running on the platform');
    const group = mk('block', 'group', 'Revenue earned each year by publications running on the platform.');
    const ids = resolveEvidenceRef({ source: 'https://g.co/', fragment: 'Revenue earned each year by publications running' }, [page, tileA, tileB, group]);
    expect(ids).toEqual([group.id]); // neither tile has a substantive run; the group does
  });

  it('a LARGE (~1150c, near-cap) GROUP block sharing only a SHORT run is NOT credited (floor holds at group scale)', () => {
    const leaf = mk('block', 'p', 'Revenue earned each year by publications running on the platform.');
    // A near-cap group block whose ONLY overlap with the quote is the 3-word "on the platform".
    const bigFiller = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet '.repeat(18); // ~1130 chars, no quote words
    const groupCoin = mk('block', 'group', `${bigFiller}on the platform`);
    expect(String(groupCoin.payload.text).length).toBeGreaterThan(1000); // exercises the floor at the 1200c cap scale
    const ids = resolveEvidenceRef({ source: 'https://g.co/', fragment: 'Revenue earned each year by publications running on the platform' }, [page, leaf, groupCoin]);
    expect(ids).toEqual([leaf.id]); // the big group's coincidental 3-word run is below the floor → not credited
  });
});

describe('recompute — fail-closed derived_from resolution (block-precise provenance)', () => {
  it('persists an inferred claim linked to the SPECIFIC block id(s) it resolved to', () => {
    const model = modelWith([{ statement: 'Positions on calm but the real pull is clarity-as-relief', source: 'https://acme.co/about', fragment: 'stop guessing and start showing up with clarity' }]);
    const { toPersist, rejected } = resolveDerivedFrom('f1', model, stored);

    expect(toPersist).toHaveLength(1);
    expect(rejected).toHaveLength(0);
    const claim = toPersist[0]!;
    expect(claim.confidenceKind).toBe('inferred');
    expect(claim.derivedFrom).toEqual([blockAbout.id]); // specific block, real resolved link
  });

  it('REJECTS an inferred claim whose ref resolves to no block (never persisted)', () => {
    const model = modelWith([{ statement: 'A surprising-but-ungrounded claim', source: 'https://acme.co/about', fragment: 'a phrase that appears on no page at all whatsoever' }]);
    const { toPersist, rejected } = resolveDerivedFrom('f1', model, stored);

    expect(toPersist).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatch(/does not resolve|fail closed/i);
  });

  it('mixed batch: resolvable persisted, unresolvable rejected; marketContext (i-know) never persisted', () => {
    const model = modelWith([
      { statement: 'grounded', source: 'https://acme.co/', fragment: 'Consistent clients without the constant hustle or burnout' },
      { statement: 'ungrounded', source: 'https://acme.co/', fragment: 'a sentence that is nowhere on the site at all' },
    ]);
    const { toPersist, rejected } = resolveDerivedFrom('f1', model, stored);

    expect(toPersist.map((f) => f.payload.statement)).toEqual(['grounded']);
    expect(toPersist[0]!.derivedFrom).toEqual([blockHomeBody.id]);
    expect(rejected.map((r) => r.statement)).toEqual(['ungrounded']);
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
    const model = modelWith([{ statement: 'grounded', source: 'https://acme.co/about', fragment: 'stop guessing and start showing up with clarity' }]);
    const { toPersist } = resolveDerivedFrom('f1', model, stored);
    const res = await repo.appendMany(toPersist);
    expect(res.stored).toBe(1);
    expect([...repo.store.values()][0]!.derivedFrom).toEqual([blockAbout.id]);

    const fabricated = { ...toPersist[0]!, confidenceKind: 'inferred' as const, derivedFrom: null };
    await expect(repo.append(fabricated)).rejects.toThrow(EvidenceHonestyError);
  });
});
