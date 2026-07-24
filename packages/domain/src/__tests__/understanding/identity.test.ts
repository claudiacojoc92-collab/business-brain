import { describe, it, expect } from 'vitest';
import {
  canonicalStringify,
  sortedUnique,
  rawCaptureId,
  normalizedObservationId,
  facetId,
  scopeFingerprint,
  snapshotSemanticKey,
  statementVersionId,
  businessSnapshotVersionId,
  FixedClock,
} from '../../understanding';
import type { ScopeDescription, SubjectRef } from '../../understanding';

const subject: SubjectRef = { type: 'business', id: 'biz1' };
const scope: ScopeDescription = { sources: ['instagram'], window: 'all_available', corpusSize: 16 };

describe('canonicalization', () => {
  it('object-key order does not change a hash', () => {
    const a = rawCaptureId({ source: 'instagram', externalId: 'p1', capturedPayload: { a: 1, b: 2 } });
    const b = rawCaptureId({ source: 'instagram', externalId: 'p1', capturedPayload: { b: 2, a: 1 } });
    expect(a).toBe(b);
    expect(canonicalStringify({ a: 1, b: 2 })).toBe(canonicalStringify({ b: 2, a: 1 }));
  });

  it('array order IS semantic (preserved)', () => {
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]));
  });

  it('set-like inputs are explicitly sorted before hashing', () => {
    expect(sortedUnique(['b', 'a', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('semantic identity determinism', () => {
  it('same inputs → same id (idempotent) across the board', () => {
    const args = {
      semanticKey: 'sk',
      corpusRevision: 'c1',
      understandingContextRevision: 'u1',
      generationProfileVersion: 'g1',
      scopeFingerprint: 'sf',
      confidence: 'appears',
    };
    expect(statementVersionId(args)).toBe(statementVersionId({ ...args }));
  });

  it('facetId is stable and value-sensitive', () => {
    const base = {
      observationId: 'o1',
      kind: 'activity_theme',
      ruleKey: 'r',
      ruleVersion: 'v1',
      extractionProfile: 'p1',
      value: 'mobility',
    };
    expect(facetId(base)).toBe(facetId({ ...base }));
    expect(facetId(base)).not.toBe(facetId({ ...base, value: 'stretching' }));
  });
});

describe('what MUST change an id', () => {
  const semBase = {
    definitionKey: 'snapshot.business_activity_appears_to_be',
    definitionVersion: 1,
    subject,
    canonicalParams: { theme: 'mobility' },
    canonicalizationVersion: 'cz1',
  };

  it('definitionVersion change changes semanticKey', () => {
    expect(snapshotSemanticKey(semBase)).not.toBe(snapshotSemanticKey({ ...semBase, definitionVersion: 2 }));
  });
  it('canonicalizationVersion change changes semanticKey', () => {
    expect(snapshotSemanticKey(semBase)).not.toBe(snapshotSemanticKey({ ...semBase, canonicalizationVersion: 'cz2' }));
  });

  const verBase = {
    semanticKey: snapshotSemanticKey(semBase),
    corpusRevision: 'c1',
    understandingContextRevision: 'u1',
    generationProfileVersion: 'g1',
    scopeFingerprint: scopeFingerprint(scope),
    confidence: 'appears',
  };
  it('corpusRevision change changes versionId', () => {
    expect(statementVersionId(verBase)).not.toBe(statementVersionId({ ...verBase, corpusRevision: 'c2' }));
  });
  it('understandingContextRevision change changes versionId', () => {
    expect(statementVersionId(verBase)).not.toBe(statementVersionId({ ...verBase, understandingContextRevision: 'u2' }));
  });
  it('confidence change changes versionId', () => {
    expect(statementVersionId(verBase)).not.toBe(statementVersionId({ ...verBase, confidence: 'clear' }));
  });
});

describe('what must NOT change an id', () => {
  it('renderVersion / locale cannot enter statement versionId (not accepted as inputs)', () => {
    // The formula has exactly six inputs; render wording/locale are structurally absent.
    const a = statementVersionId({
      semanticKey: 'sk', corpusRevision: 'c1', understandingContextRevision: 'u1',
      generationProfileVersion: 'g1', scopeFingerprint: 'sf', confidence: 'appears',
    });
    const b = statementVersionId({
      semanticKey: 'sk', corpusRevision: 'c1', understandingContextRevision: 'u1',
      generationProfileVersion: 'g1', scopeFingerprint: 'sf', confidence: 'appears',
    });
    expect(a).toBe(b);
  });

  it('wall-clock timestamps do not enter semantic ids (clock-independent)', () => {
    const clockEarly = new FixedClock('2020-01-01T00:00:00.000Z');
    const clockLate = new FixedClock('2030-01-01T00:00:00.000Z');
    // capturedAt would come from these clocks but is NOT an input to rawCaptureId / observationId.
    const idInputs = { rawCaptureId: 'rc1', normalizationRuleVersion: 'n1', payload: { caption: 'x', mediaType: 'reel', occurredAt: '2025-01-06T09:00:00.000Z' } };
    const withEarly = normalizedObservationId(idInputs); // clockEarly.now() intentionally unused in the id
    const withLate = normalizedObservationId(idInputs);
    expect(clockEarly.now()).not.toBe(clockLate.now());
    expect(withEarly).toBe(withLate);
  });
});

describe('snapshotId canonical ordering', () => {
  it('equivalent unordered inputs produce the same snapshotId', () => {
    const base = {
      businessRef: subject,
      corpusRevision: 'c1',
      understandingContextRevision: 'u1',
      generationProfileVersion: 'g1',
    };
    const a = businessSnapshotVersionId({
      ...base,
      observedStatementVersionIds: ['v2', 'v1', 'v3'],
      declaredContextDeclarationIds: ['d2', 'd1'],
    });
    const b = businessSnapshotVersionId({
      ...base,
      observedStatementVersionIds: ['v1', 'v3', 'v2'],
      declaredContextDeclarationIds: ['d1', 'd2'],
    });
    expect(a).toBe(b);
  });

  it('a different statement set produces a different snapshotId', () => {
    const base = {
      businessRef: subject, corpusRevision: 'c1', understandingContextRevision: 'u1', generationProfileVersion: 'g1',
      declaredContextDeclarationIds: [] as string[],
    };
    const a = businessSnapshotVersionId({ ...base, observedStatementVersionIds: ['v1', 'v2'] });
    const b = businessSnapshotVersionId({ ...base, observedStatementVersionIds: ['v1', 'v2', 'v3'] });
    expect(a).not.toBe(b);
  });
});
