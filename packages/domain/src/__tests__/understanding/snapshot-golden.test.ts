import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  buildRawCapture,
  buildObservation,
  corpusRevisionId,
  normalizePublication,
  extractCorpusFacets,
  buildScope,
  generateSnapshotStatements,
  buildBusinessSnapshotVersion,
  EXTRACTION_PROFILE,
  GENERATION_PROFILE_VERSION,
  type SubjectRef,
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
const golden = JSON.parse(readFileSync(repoRel('fixtures/physio-movement/golden/snapshot.json'), 'utf8')) as Record<string, unknown>;

const CAPTURED_AT = '2025-01-06T04:00:00.000Z';
const businessRef: SubjectRef = { type: 'business', id: 'A' };
const observations = corpus.posts.map((p) => {
  const cap = buildRawCapture({ source: 'instagram', externalId: p.externalId, entry: p, capturedAt: CAPTURED_AT });
  const n = normalizePublication(p, corpus.bio);
  if (!n.ok) throw new Error(`reject ${p.externalId}`);
  return buildObservation({ rawCaptureId: cap.id, payload: n.payload, extraction: n.extraction, capturedAt: CAPTURED_AT });
});
const corpusRevision = corpusRevisionId({ observationIds: observations.map((o) => o.id), activeFacetCorrectionIds: [] });
const facets = extractCorpusFacets(observations, EXTRACTION_PROFILE);
const scope = buildScope({ sources: observations.map(() => 'instagram'), occurredAts: observations.map((o) => o.payload.occurredAt), corpusSize: observations.length });
const statements = generateSnapshotStatements({ corpusRevision, understandingContextRevision: 'understanding_ctx_genesis', effectiveFacets: facets, scope });
const version = buildBusinessSnapshotVersion({ businessRef, corpusRevision, understandingContextRevision: 'understanding_ctx_genesis', observedStatements: statements, declaredContext: [], createdAt: CAPTURED_AT });

describe('snapshot golden (corpus → immutable BusinessSnapshotVersion)', () => {
  it('snapshotId + statement count + profile match', () => {
    expect(version.id).toBe(golden['snapshotId']);
    expect(statements.length).toBe(golden['statementCount']);
    expect(GENERATION_PROFILE_VERSION).toBe(golden['generationProfileVersion']);
    expect(scope).toEqual(golden['scope']);
  });
  it('ordered statements match golden (id/semanticKey/definition/subject/params/confidence)', () => {
    const mapped = statements.map((s) => ({
      semanticKey: s.semanticKey, versionId: s.versionId, definitionKey: s.definitionKey, definitionVersion: s.definitionVersion,
      subject: s.subject, params: s.params, confidence: s.confidence, provenanceKind: s.provenanceKind, observationCount: s.observationIds.length,
    }));
    expect(mapped).toEqual(golden['statements']);
  });
  it('declaredContext is empty', () => {
    expect(version.declaredContext).toEqual([]);
  });
});
