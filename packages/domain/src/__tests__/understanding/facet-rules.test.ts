import { describe, it, expect } from 'vitest';
import {
  extractForObservation,
  extractCorpusFacets,
  EXTRACTION_PROFILE,
  RULE_VERSION,
  facetId,
  type Facet,
  type NormalizedObservation,
} from '../../understanding';

function obs(id: string, caption: string): NormalizedObservation {
  return {
    id,
    rawCaptureId: 'rc_' + id,
    kind: 'publication',
    payload: { caption, mediaType: 'reel', occurredAt: '2025-01-06T09:00:00.000Z' },
    extraction: { ruleKey: 'understanding.ig_publication', ruleVersion: '1', mode: 'deterministic', sourceLocus: 'publication', reproducible: true },
    capturedAt: '2025-01-06T04:00:00.000Z',
  };
}
const values = (fs: Facet[]) => fs.map((f) => `${f.kind}/${f.value}:${f.confidence}`).sort();

describe('facet rules — deterministic observable matching', () => {
  it('is deterministic (same input → identical facets)', () => {
    const a = extractForObservation(obs('o1', 'A mobility drill and a stretch'), EXTRACTION_PROFILE);
    const b = extractForObservation(obs('o1', 'A mobility drill and a stretch'), EXTRACTION_PROFILE);
    expect(a).toEqual(b);
  });

  it('case-folds (uppercase matches)', () => {
    expect(values(extractForObservation(obs('o1', 'MOBILITY and STRETCHING'), EXTRACTION_PROFILE)))
      .toEqual(['activity_theme/mobility:high', 'activity_theme/stretching:high']);
  });

  it('does NOT fold diacritics (é ≠ e)', () => {
    // "strétching" is not "stretching"; must not match.
    expect(extractForObservation(obs('o1', 'strétching the body'), EXTRACTION_PROFILE)).toHaveLength(0);
  });

  it('respects word boundaries (no accidental substring)', () => {
    // "bookshelf" must not trigger the offer 'book'; "flowering" must not trigger 'flow'.
    const fs = extractForObservation(obs('o1', 'a bookshelf near the flowering plant'), EXTRACTION_PROFILE);
    expect(fs).toHaveLength(0);
  });

  it('matches multi-word phrases', () => {
    expect(values(extractForObservation(obs('o1', 'improve your range of motion'), EXTRACTION_PROFILE)))
      .toEqual(['activity_theme/mobility:medium', 'addressed_audience/second_person:low']);
  });

  it('maps confidence by match reliability (high / medium / low)', () => {
    expect(values(extractForObservation(obs('o1', 'rehab'), EXTRACTION_PROFILE))).toEqual(['activity_theme/rehabilitation:high']);
    expect(values(extractForObservation(obs('o1', 'recovery time'), EXTRACTION_PROFILE))).toEqual(['activity_theme/rehabilitation:medium']);
    expect(values(extractForObservation(obs('o1', 'a gentle flow'), EXTRACTION_PROFILE))).toEqual(['activity_theme/yoga_resembling:low']);
  });

  it('keeps yoga-resembling posts as OBSERVABLE resemblance only (never "the service is yoga")', () => {
    const fs = extractForObservation(obs('o1', 'a yoga-inspired flow'), EXTRACTION_PROFILE);
    expect(fs).toHaveLength(1);
    const f = fs[0]!;
    expect(f.kind).toBe('activity_theme');
    expect(f.value).toBe('yoga_resembling'); // resemblance signal, not a service claim
    expect(f.confidence).toBe('medium'); // yoga(medium) over flow(low)
  });

  it('produces canonical deterministic ordering', () => {
    const fs = extractCorpusFacets([obs('o2', 'stretch'), obs('o1', 'mobility')], EXTRACTION_PROFILE);
    expect(fs.map((f) => f.observationId)).toEqual(['o1', 'o2']); // sorted by observationId
  });

  it('Facet id is stable and excludes any clock/timestamp input', () => {
    const early = extractForObservation({ ...obs('o1', 'mobility'), capturedAt: '2020-01-01T00:00:00.000Z' }, EXTRACTION_PROFILE);
    const late = extractForObservation({ ...obs('o1', 'mobility'), capturedAt: '2030-01-01T00:00:00.000Z' }, EXTRACTION_PROFILE);
    expect(early[0]!.id).toBe(late[0]!.id);
  });

  it('extractionProfile change produces a different Facet id (frozen formula)', () => {
    const a = facetId({ observationId: 'o1', kind: 'activity_theme', ruleKey: 'physio_movement.mobility', ruleVersion: RULE_VERSION, extractionProfile: EXTRACTION_PROFILE, value: 'mobility' });
    const b = facetId({ observationId: 'o1', kind: 'activity_theme', ruleKey: 'physio_movement.mobility', ruleVersion: RULE_VERSION, extractionProfile: 'other.v2', value: 'mobility' });
    expect(a).not.toBe(b);
  });

  it('ruleVersion change produces a different Facet id', () => {
    const a = facetId({ observationId: 'o1', kind: 'activity_theme', ruleKey: 'physio_movement.mobility', ruleVersion: '1', extractionProfile: EXTRACTION_PROFILE, value: 'mobility' });
    const b = facetId({ observationId: 'o1', kind: 'activity_theme', ruleKey: 'physio_movement.mobility', ruleVersion: '2', extractionProfile: EXTRACTION_PROFILE, value: 'mobility' });
    expect(a).not.toBe(b);
  });

  it('an unknown profile yields no facets (extraction pinned to the profile)', () => {
    expect(extractForObservation(obs('o1', 'mobility rehab stretch'), 'not.a.profile')).toHaveLength(0);
  });
});

describe('facet rules — negative (no inferred interiority or external reception)', () => {
  it('emits only observable signal values, never conclusions', () => {
    const fs = extractCorpusFacets(
      [obs('o1', 'Recovering from injury? Book a physio assessment. Learn the why.'), obs('o2', 'yoga-inspired flow to mobilise')],
      EXTRACTION_PROFILE,
    );
    const forbidden = [
      'positioned_as_physiotherapy',
      'audience_understands',
      'content_is_educational',
      'yoga_is_primary',
      'offer_underrepresented',
      'high_quality',
      'popular',
      'consistent_strategy',
      'market_fit',
    ];
    const producedValues = new Set(fs.map((f) => f.value));
    for (const bad of forbidden) expect(producedValues.has(bad)).toBe(false);
    // every produced value is a bounded observable signal
    const allowed = new Set([
      'rehabilitation', 'mobility', 'stretching', 'physiotherapy', 'physiotherapy_session', 'yoga_resembling',
      'assessment', 'program', 'one_to_one', 'booking', 'second_person', 'educational',
    ]);
    for (const v of producedValues) expect(allowed.has(v)).toBe(true);
  });
});
