import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  buildRawCapture,
  buildObservation,
  corpusRevisionId,
  normalizePublication,
  NORMALIZATION_RULE_KEY,
  NORMALIZATION_RULE_VERSION,
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
const golden = JSON.parse(readFileSync(repoRel('fixtures/physio-movement/golden/ingestion.json'), 'utf8')) as {
  normalizationRule: string;
  rawCaptureIds: string[];
  observationIds: string[];
  corpusRevisionId: string;
};

// FixedClock instant — deliberately excluded from every semantic id.
const CAPTURED_AT = '2025-01-06T04:00:00.000Z';

const rawCaptureIds: string[] = [];
const observationIds: string[] = [];
for (const p of corpus.posts) {
  const cap = buildRawCapture({ source: 'instagram', externalId: p.externalId, entry: p, capturedAt: CAPTURED_AT });
  const n = normalizePublication(p, corpus.bio);
  if (!n.ok) throw new Error(`unexpected reject ${p.externalId}`);
  const obs = buildObservation({ rawCaptureId: cap.id, payload: n.payload, extraction: n.extraction, capturedAt: CAPTURED_AT });
  rawCaptureIds.push(cap.id);
  observationIds.push(obs.id);
}
const revId = corpusRevisionId({ observationIds, activeFacetCorrectionIds: [] });

describe('ingestion golden (fixture → ordered ids → corpusRevisionId)', () => {
  it('normalization rule matches', () => {
    expect(`${NORMALIZATION_RULE_KEY}@${NORMALIZATION_RULE_VERSION}`).toBe(golden.normalizationRule);
  });
  it('ordered RawCapture ids match golden', () => {
    expect(rawCaptureIds).toEqual(golden.rawCaptureIds);
  });
  it('ordered Observation ids match golden', () => {
    expect(observationIds).toEqual(golden.observationIds);
  });
  it('CorpusRevision id matches golden', () => {
    expect(revId).toBe(golden.corpusRevisionId);
  });
});
