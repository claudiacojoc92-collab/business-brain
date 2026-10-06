import { describe, it, expect } from 'vitest';
import type { EvidenceFragment } from '@bb/domain';
import { ProofExtractionService } from './proof-extraction.service';
import type { ProofCandidate, ProofFact } from './contracts';

/**
 * Numeric sanity bound on counted checkable proof (tenure/team_size/service_count). A live site that renders a
 * broken counter ("Ani de experiență 0 +") must not license a tenure of 0 — and the rejection must be
 * LANGUAGE-INDEPENDENT (not the accidental English about-business gate), since the de-anglicize work is deferred.
 */
const frag = (text: string): EvidenceFragment => ({
  id: 'u', founderId: 'f', source: 'upload', platform: null, sourceUrl: 'founder://supplied/u',
  confidenceKind: 'observed' as never, occurredAt: null, capturedAt: new Date(0),
  visibility: 'business' as never, payload: { ref: 'u', text }, derivedFrom: null,
});
function run(text: string, proofs: ProofCandidate[]): Promise<ProofFact[]> {
  let saved: ProofFact[] = [];
  const svc = new ProofExtractionService({
    links: { listFragmentIds: async () => ['u'] } as never,
    evidence: { findByIds: async () => [frag(text)] } as never,
    model: { extract: async () => ({ proofs, unsourced: [] }) } as never,
    repo: {
      latestFingerprint: async () => null,
      replaceForBusiness: async (_b: string, _f: string, p: ProofFact[]) => { saved = p; },
      listProof: async () => saved, listUnsourced: async () => [],
    } as never,
  });
  return svc.facts('b1', 'Body Move');
}

describe('proof extraction — numeric sanity bound', () => {
  it('rejects a non-positive tenure (the "0 years" counter) but keeps a real one', async () => {
    const text = 'Body Move. We have 0 years of experience. We have 7 years of experience.';
    const proofs = await run(text, [
      { kind: 'tenure', anchorQuote: 'We have 0 years of experience', sourceRef: 'u' },
      { kind: 'tenure', anchorQuote: 'We have 7 years of experience', sourceRef: 'u' },
    ]);
    const quotes = proofs.map((p) => p.anchorQuote);
    expect(quotes).toContain('We have 7 years of experience');
    expect(quotes).not.toContain('We have 0 years of experience'); // 0 → dropped on value, not language
  });

  it('rejects a zero team_size (which cleanTeamSize alone would have passed)', async () => {
    const text = 'Our team of 0 therapists. Our team of 7 therapists.';
    const proofs = await run(text, [
      { kind: 'team_size', anchorQuote: 'Our team of 0 therapists', sourceRef: 'u' },
      { kind: 'team_size', anchorQuote: 'Our team of 7 therapists', sourceRef: 'u' },
    ]);
    expect(proofs.map((p) => p.anchorQuote)).toEqual(['Our team of 7 therapists']);
  });

  it('allows a founding-YEAR tenure (not mistaken for an absurd count)', async () => {
    const text = 'We have been open since 2015, serving the community.';
    const proofs = await run(text, [{ kind: 'tenure', anchorQuote: 'We have been open since 2015', sourceRef: 'u' }]);
    expect(proofs).toHaveLength(1);
  });
});
