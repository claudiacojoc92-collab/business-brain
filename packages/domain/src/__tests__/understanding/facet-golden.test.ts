import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  buildRawCapture,
  buildObservation,
  corpusRevisionId,
  normalizePublication,
  extractCorpusFacets,
  EXTRACTION_PROFILE,
} from '../../understanding';

function repoRel(rel: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const c = join(dir, rel);
    if (existsSync(c)) return c;
    dir = dirname(dir);
  }
  throw new Error(`not found: ${rel}`);
}

interface Post { externalId: string; caption: string; mediaType: string; occurredAt: string }
const corpus = JSON.parse(readFileSync(repoRel('fixtures/physio-movement/corpus.json'), 'utf8')) as { bio?: string; posts: Post[] };
const golden = JSON.parse(readFileSync(repoRel('fixtures/physio-movement/golden/facets.json'), 'utf8')) as {
  corpusRevision: string;
  extractionProfile: string;
  facetCount: number;
  facets: Array<{ facetId: string; observationId: string; kind: string; value: string; confidence: string; ruleKey: string; ruleVersion: string }>;
};

const CAPTURED_AT = '2025-01-06T04:00:00.000Z';
const observations = corpus.posts.map((p) => {
  const cap = buildRawCapture({ source: 'instagram', externalId: p.externalId, entry: p, capturedAt: CAPTURED_AT });
  const n = normalizePublication(p, corpus.bio);
  if (!n.ok) throw new Error(`reject ${p.externalId}`);
  return buildObservation({ rawCaptureId: cap.id, payload: n.payload, extraction: n.extraction, capturedAt: CAPTURED_AT });
});
const revId = corpusRevisionId({ observationIds: observations.map((o) => o.id), activeFacetCorrectionIds: [] });
const facets = extractCorpusFacets(observations, EXTRACTION_PROFILE);

describe('facet golden (corpus → profile → ordered facets)', () => {
  it('corpusRevision + profile match', () => {
    expect(revId).toBe(golden.corpusRevision);
    expect(EXTRACTION_PROFILE).toBe(golden.extractionProfile);
  });
  it('facet count matches', () => {
    expect(facets.length).toBe(golden.facetCount);
  });
  it('ordered facets match golden byte-for-byte (id/observation/kind/value/confidence/rule)', () => {
    const mapped = facets.map((f) => ({
      facetId: f.id, observationId: f.observationId, kind: f.kind, value: f.value,
      confidence: f.confidence, ruleKey: f.ruleKey, ruleVersion: f.ruleVersion,
    }));
    expect(mapped).toEqual(golden.facets);
  });
});
