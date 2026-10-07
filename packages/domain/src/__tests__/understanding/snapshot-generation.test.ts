import { describe, it, expect } from 'vitest';
import {
  generateSnapshotStatements,
  buildScope,
  buildBusinessSnapshotVersion,
  type Facet,
  type SubjectRef,
} from '../../understanding';

function facet(observationId: string, kind: Facet['kind'], value: string, confidence: Facet['confidence']): Facet {
  return { id: `f:${observationId}:${kind}:${value}`, observationId, kind, value, mode: 'deterministic', confidence, ruleKey: 'r', ruleVersion: '1', extractionProfile: 'understanding.physio_movement.v1' };
}
function scopeN(n: number, rev = 'c1'): { scope: ReturnType<typeof buildScope>; corpusRevision: string } {
  return { scope: buildScope({ sources: ['instagram'], occurredAts: ['2025-01-01T00:00:00.000Z', '2025-03-01T00:00:00.000Z'], corpusSize: n }), corpusRevision: rev };
}
const CTX = 'understanding_ctx_genesis';
function gen(facets: Facet[], corpusSize: number, rev = 'c1') {
  const { scope, corpusRevision } = scopeN(corpusSize, rev);
  return generateSnapshotStatements({ corpusRevision, understandingContextRevision: CTX, effectiveFacets: facets, scope });
}
const many = (kind: Facet['kind'], value: string, conf: Facet['confidence'], n: number) =>
  Array.from({ length: n }, (_, i) => facet(`o${value}${i}`, kind, value, conf));

describe('snapshot generation — confidence precedence', () => {
  it('all-low support → tentative even at high volume (precedence rule 1)', () => {
    const s = gen(many('activity_theme', 'x', 'low', 5), 10);
    expect(s).toHaveLength(1);
    expect(s[0]!.confidence).toBe('tentative');
  });
  it('≥4 support & coverage ≥25% & not all-low → clear', () => {
    const s = gen(many('activity_theme', 'x', 'high', 4), 16); // 4/16 = 2500 bps
    expect(s[0]!.confidence).toBe('clear');
  });
  it('≥2 support & coverage ≥10% → appears', () => {
    const s = gen(many('activity_theme', 'x', 'high', 2), 16); // 2/16 = 1250 bps
    expect(s[0]!.confidence).toBe('appears');
  });
  it('exactly 1 support (offer, min 1) → tentative', () => {
    const s = gen(many('offer_mention', 'assessment', 'high', 1), 16);
    expect(s[0]!.confidence).toBe('tentative');
  });
});

describe('snapshot generation — eligibility & selection', () => {
  it('activity theme with support 1 is omitted (definition minSupport = 2)', () => {
    expect(gen(many('activity_theme', 'x', 'high', 1), 16)).toHaveLength(0);
  });
  it('caps activity themes at max 3 by support', () => {
    const facets = [
      ...many('activity_theme', 'a', 'high', 7),
      ...many('activity_theme', 'b', 'high', 6),
      ...many('activity_theme', 'c', 'high', 5),
      ...many('activity_theme', 'd', 'high', 4),
    ];
    const s = gen(facets, 20);
    expect(s.map((x) => x.params['theme'])).toEqual(['a', 'b', 'c']); // 'd' truncated
  });
  it('subjects are Channel for activity/educational and Offer(value) for offers; params carry no evidence stats', () => {
    const s = gen([...many('activity_theme', 'mobility', 'high', 3), ...many('offer_mention', 'program', 'high', 2), ...many('communication_style', 'educational', 'medium', 2)], 16);
    const activity = s.find((x) => x.definitionKey.endsWith('activity_theme_recurs'))!;
    const offer = s.find((x) => x.definitionKey.endsWith('offer_mention_observed'))!;
    const edu = s.find((x) => x.definitionKey.endsWith('educational_explanation_recurs'))!;
    expect(activity.subject).toEqual({ type: 'channel', id: 'instagram' });
    expect(offer.subject).toEqual({ type: 'offer', id: 'program' });
    expect(edu.subject).toEqual({ type: 'channel', id: 'instagram' });
    for (const st of s) {
      expect(Object.keys(st.params).every((k) => k === 'theme' || k === 'offerType')).toBe(true);
      expect('supportCount' in st.params).toBe(false);
      expect('coverageBps' in st.params).toBe(false);
      expect(st.provenanceKind).toBe('observed');
    }
  });
  it('final ordering is by fixed slot: activity → offer → educational', () => {
    const s = gen([...many('communication_style', 'educational', 'medium', 6), ...many('offer_mention', 'assessment', 'medium', 2), ...many('activity_theme', 'mobility', 'high', 3)], 16);
    expect(s.map((x) => x.definitionKey.split('.').pop())).toEqual(['activity_theme_recurs', 'offer_mention_observed', 'educational_explanation_recurs']);
  });
});

describe('snapshot generation — identity invariance (support 6 → 7)', () => {
  it('semanticKey is support-invariant; versionId changes with corpus/scope', () => {
    const at6 = gen(many('activity_theme', 'rehabilitation', 'high', 6), 16, 'c1');
    const at7 = gen(many('activity_theme', 'rehabilitation', 'high', 7), 17, 'c2');
    expect(at6[0]!.semanticKey).toBe(at7[0]!.semanticKey); // proposition identity preserved
    expect(at6[0]!.versionId).not.toBe(at7[0]!.versionId); // realization changed (corpus + scope)
    expect(at6[0]!.confidence).toBe('clear');
    expect(at7[0]!.confidence).toBe('clear');
  });
});

describe('buildScope + snapshot version', () => {
  it('derives window from min/max occurredAt and sorts unique sources', () => {
    const scope = buildScope({ sources: ['instagram', 'instagram'], occurredAts: ['2025-02-27T09:00:00.000Z', '2025-01-06T09:00:00.000Z'], corpusSize: 2 });
    expect(scope.window).toBe('2025-01-06T09:00:00.000Z/2025-02-27T09:00:00.000Z');
    expect(scope.sources).toEqual(['instagram']);
    expect(scope.corpusSize).toBe(2);
  });
  it('BusinessSnapshotVersion is order-independent in id and carries empty declaredContext', () => {
    const biz: SubjectRef = { type: 'business', id: 'A' };
    const s = gen([...many('activity_theme', 'mobility', 'high', 3), ...many('offer_mention', 'program', 'high', 2)], 16);
    const v1 = buildBusinessSnapshotVersion({ businessRef: biz, corpusRevision: 'c1', understandingContextRevision: CTX, observedStatements: s, declaredContext: [], createdAt: '2025-01-06T04:00:00.000Z' });
    const v2 = buildBusinessSnapshotVersion({ businessRef: biz, corpusRevision: 'c1', understandingContextRevision: CTX, observedStatements: [...s].reverse(), declaredContext: [], createdAt: '2030-01-01T00:00:00.000Z' });
    expect(v1.id).toBe(v2.id); // sorted version ids + createdAt excluded
    expect(v1.declaredContext).toEqual([]);
  });
});
