import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalize } from '../../business-model/pg-business-read.repository';

/**
 * S1-T3 C1 — canonicalize must be a STABLE fingerprint across the JSONB round-trip, which loses object key
 * order and whitespace and drops absent/undefined keys. These are pure (no DB): they prove canonicalize is
 * key-order-independent and treats an unset optional identically to an absent key, so content_hash computed
 * before storage equals the hash of the reloaded snapshot. Arrays keep order (order is meaningful in a Read).
 */
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('canonicalize — round-trip-stable serialization', () => {
  it('is independent of object key insertion order (what JSONB does not preserve)', () => {
    const a = { founderId: 'f', sections: [{ id: 'x', title: 'X', empty: false }], assembledAt: 't' };
    const b = { assembledAt: 't', sections: [{ empty: false, title: 'X', id: 'x' }], founderId: 'f' };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(sha(canonicalize(a))).toBe(sha(canonicalize(b)));
  });

  it('treats an unset optional identically to an absent key (undefined omitted, like JSONB)', () => {
    const withUndefined = { statement: 's', epistemicKind: 'observed', receipts: undefined, internalCategory: undefined };
    const absent = { statement: 's', epistemicKind: 'observed' };
    expect(canonicalize(withUndefined)).toBe(canonicalize(absent));
  });

  it('simulated JSONB round-trip (parse of stringify) canonicalizes identically', () => {
    const read = {
      founderId: 'f1',
      assembledAt: '2026-07-10T00:00:00.000Z',
      sections: [
        { id: 'what_i_observe', title: 'What I Observe', empty: false, claims: [
          { statement: 'Calm software.', epistemicKind: 'observed', provenance: { fragmentIds: ['a'] },
            receipts: [{ fragmentId: 'a', epistemicKind: 'observed', sourceType: 'website', text: 'Calm software.', capturedAt: '2026-07-01T00:00:00.000Z' }] },
        ] },
        { id: 'bets', title: "What You're Betting On", empty: true, claims: [] },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(read));
    expect(canonicalize(read)).toBe(canonicalize(roundTripped));
  });

  it('preserves array order (section order / provenance order are meaningful)', () => {
    const forward = { sections: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
    const reversed = { sections: [{ id: 'c' }, { id: 'b' }, { id: 'a' }] };
    expect(canonicalize(forward)).not.toBe(canonicalize(reversed));
  });
});
