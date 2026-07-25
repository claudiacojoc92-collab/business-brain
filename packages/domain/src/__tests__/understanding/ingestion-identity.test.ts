import { describe, it, expect } from 'vitest';
import {
  buildRawCapture,
  buildObservation,
  corpusRevisionId,
  normalizePublication,
} from '../../understanding';

const entry = { externalId: 'p1', caption: 'Hello', mediaType: 'reel', occurredAt: '2025-01-06T09:00:00.000Z' };

function observationFor(e: typeof entry, capturedAt: string) {
  const cap = buildRawCapture({ source: 'instagram', externalId: e.externalId, entry: e, capturedAt });
  const n = normalizePublication(e, undefined);
  if (!n.ok) throw new Error('unexpected reject');
  const obs = buildObservation({ rawCaptureId: cap.id, payload: n.payload, extraction: n.extraction, capturedAt });
  return { cap, obs };
}

describe('ingestion identity', () => {
  it('RawCapture id is stable and excludes capturedAt (clock) from the hash', () => {
    const a = buildRawCapture({ source: 'instagram', externalId: 'p1', entry, capturedAt: '2020-01-01T00:00:00.000Z' });
    const b = buildRawCapture({ source: 'instagram', externalId: 'p1', entry, capturedAt: '2030-01-01T00:00:00.000Z' });
    expect(a.id).toBe(b.id);
  });

  it('same externalId + changed payload produces a DIFFERENT RawCapture id', () => {
    const a = buildRawCapture({ source: 'instagram', externalId: 'p1', entry, capturedAt: 'x' });
    const b = buildRawCapture({ source: 'instagram', externalId: 'p1', entry: { ...entry, caption: 'Changed' }, capturedAt: 'x' });
    expect(a.id).not.toBe(b.id);
  });

  it('Observation id is stable and excludes capturedAt from the hash', () => {
    const early = observationFor(entry, '2020-01-01T00:00:00.000Z');
    const late = observationFor(entry, '2030-01-01T00:00:00.000Z');
    expect(early.obs.id).toBe(late.obs.id);
    expect(early.cap.id).toBe(late.cap.id);
  });

  it('CorpusRevision id is stable and order-sensitive (source order is semantic)', () => {
    const a = corpusRevisionId({ observationIds: ['o1', 'o2', 'o3'], activeFacetCorrectionIds: [] });
    const aAgain = corpusRevisionId({ observationIds: ['o1', 'o2', 'o3'], activeFacetCorrectionIds: [] });
    const reordered = corpusRevisionId({ observationIds: ['o2', 'o1', 'o3'], activeFacetCorrectionIds: [] });
    expect(a).toBe(aAgain);
    expect(a).not.toBe(reordered);
  });
});
