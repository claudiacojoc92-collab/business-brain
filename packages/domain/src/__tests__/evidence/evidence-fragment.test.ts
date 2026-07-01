import { describe, it, expect } from 'vitest';
import {
  makeFragment,
  contentAddress,
  assertFragmentHonest,
  EvidenceHonestyError,
} from '../../evidence/evidence-fragment';

const base = {
  founderId: 'f1',
  source: 'website',
  sourceUrl: 'https://acme.co/about',
  payload: { text: 'we do X', pageType: 'about' },
};

describe('Evidence honesty gate (fail closed)', () => {
  it('rejects an inferred fragment with empty derivedFrom', () => {
    expect(() => makeFragment({ ...base, sourceUrl: null, confidenceKind: 'inferred' }))
      .toThrow(EvidenceHonestyError);
    expect(() => makeFragment({ ...base, sourceUrl: null, confidenceKind: 'inferred', derivedFrom: [] }))
      .toThrow(EvidenceHonestyError);
  });

  it('accepts an inferred fragment WITH non-empty derivedFrom', () => {
    const f = makeFragment({ founderId: 'f1', source: 'model', confidenceKind: 'inferred', derivedFrom: ['abc'], payload: { claim: 'positioning is X' } });
    expect(f.confidenceKind).toBe('inferred');
    expect(f.derivedFrom).toEqual(['abc']);
  });

  it('rejects an observed fragment with no source url', () => {
    expect(() => makeFragment({ ...base, sourceUrl: null, confidenceKind: 'observed' }))
      .toThrow(EvidenceHonestyError);
  });

  it('accepts an observed fragment with a real source url', () => {
    const f = makeFragment({ ...base, confidenceKind: 'observed' });
    expect(f.confidenceKind).toBe('observed');
    expect(f.sourceUrl).toBe('https://acme.co/about');
  });

  it('assertFragmentHonest throws on a sourceless fragment', () => {
    expect(() => assertFragmentHonest({ confidenceKind: 'observed', sourceUrl: 'x', derivedFrom: null, source: '' }))
      .toThrow(EvidenceHonestyError);
  });
});

describe('Content-addressed id', () => {
  it('is stable for identical content (dedupe) and differs when content differs', () => {
    const a = makeFragment({ ...base, confidenceKind: 'observed' });
    const b = makeFragment({ ...base, confidenceKind: 'observed' });
    expect(a.id).toBe(b.id); // identical content → same id → dedupes on insert

    const c = makeFragment({ ...base, confidenceKind: 'observed', payload: { text: 'different', pageType: 'about' } });
    expect(c.id).not.toBe(a.id);
  });

  it('contentAddress is a 64-char sha256 hex', () => {
    const id = contentAddress({ founderId: 'f1', source: 'website', sourceUrl: 'https://x.co', confidenceKind: 'observed', payload: { a: 1 } });
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});
