import { describe, it, expect } from 'vitest';
import type { EvidenceFragment } from '@bb/domain';
import type { ProofSourceUnit } from './contracts';
import { ProofExtractionService } from './proof-extraction.service';
import { toSourceUnits } from '../bi/source-units';

/**
 * CHARACTERIZATION (golden-master) test for the fragment→unit projection, written and proven GREEN against
 * the CURRENT code (ProofExtractionService.toUnits) BEFORE the commit-3 refactor extracts it to
 * bi/source-units.ts. It encodes what the projection does today — so that after the extraction the SAME
 * assertions prove behaviour was preserved. Do not relax it to match a refactor; it pins the pre-refactor
 * behaviour on purpose. (Proof extraction had no tests; this also becomes the projection's first coverage.)
 */

// toUnits is private; access it with a typed view (no `any`). It is a pure function of its argument —
// none of the service deps are touched — so a bare service instance is enough.
type Projector = { toUnits(frags: EvidenceFragment[]): ProofSourceUnit[] };
const project = (frags: EvidenceFragment[]): ProofSourceUnit[] =>
  (new ProofExtractionService({} as never) as unknown as Projector).toUnits(frags);

const frag = (p: Partial<EvidenceFragment>): EvidenceFragment => ({
  id: 'id', founderId: 'f', source: 'website', platform: null, sourceUrl: null,
  confidenceKind: 'observed' as never, occurredAt: null, capturedAt: new Date(0),
  visibility: 'business' as never, payload: {}, derivedFrom: null, ...p,
});

describe('fragment→unit projection — characterization (pre-refactor behaviour)', () => {
  it('supplied instagram fragment → sourceRef "Instagram", url from the fragment, text from payload', () => {
    const u = project([frag({ source: 'instagram', sourceUrl: 'https://instagram.com/p/x', payload: { text: 'post body' } })]);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ sourceRef: 'Instagram', sourceUrl: 'https://instagram.com/p/x', text: 'post body' });
  });

  it('supplied upload with no url → sourceRef "Uploaded material", url falls back to founder://supplied/<id>', () => {
    const u = project([frag({ source: 'upload', sourceUrl: null, id: 'frag9', payload: { text: 'brochure line' } })]);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ sourceRef: 'Uploaded material', sourceUrl: 'founder://supplied/frag9', text: 'brochure line' });
  });

  it('supplied fragment with an explicit payload.ref uses that ref', () => {
    const u = project([frag({ source: 'upload', sourceUrl: 'founder://supplied/7', payload: { ref: 'Brosura', text: 'servicii' } })]);
    expect(u[0]?.sourceRef).toBe('Brosura');
  });

  it('a block fragment is skipped (page/doc text only)', () => {
    const u = project([frag({ source: 'instagram', payload: { kind: 'block', text: 'x' } })]);
    expect(u).toHaveLength(0);
  });

  it('an empty-text supplied fragment is skipped', () => {
    const u = project([frag({ source: 'upload', payload: { text: '   ' } })]);
    expect(u).toHaveLength(0);
  });

  it('website pages are bridged: text + pageType + url survive; sitemap/.xml is skipped', () => {
    const u = project([
      frag({ source: 'website', sourceUrl: 'https://bodymovestudio.ro/', payload: { text: 'Kinetoterapie si masaj', pageType: 'home', title: 'Acasa' } }),
      frag({ source: 'website', sourceUrl: 'https://bodymovestudio.ro/sitemap.xml', payload: { text: 'should be dropped' } }),
    ]);
    const home = u.find((x) => x.text === 'Kinetoterapie si masaj');
    expect(home).toMatchObject({ sourceUrl: 'https://bodymovestudio.ro/', pageType: 'home' });
    expect(u.some((x) => x.text === 'should be dropped')).toBe(false);
  });

  it('dedup by sourceRef keeps the FIRST occurrence', () => {
    const u = project([
      frag({ source: 'upload', sourceUrl: 'founder://supplied/1', payload: { ref: 'Pliant', text: 'first' } }),
      frag({ source: 'upload', sourceUrl: 'founder://supplied/2', payload: { ref: 'Pliant', text: 'second' } }),
    ]);
    const pliant = u.filter((x) => x.sourceRef === 'Pliant');
    expect(pliant).toHaveLength(1);
    expect(pliant[0]?.text).toBe('first');
  });

  it('supplied units precede website units (processing order), all present', () => {
    const u = project([
      frag({ source: 'website', sourceUrl: 'https://bodymovestudio.ro/despre', payload: { text: 'echipa', pageType: 'about' } }),
      frag({ source: 'instagram', sourceUrl: 'https://instagram.com/p/y', payload: { text: 'ig' } }),
    ]);
    expect(u.map((x) => x.text)).toEqual(['ig', 'echipa']);
  });

  it('fails loudly: non-empty fragments → zero units invokes onAnomaly with the keys seen', () => {
    const anomalies: { fragmentCount: number; sampleKeys: string[] }[] = [];
    const out = toSourceUnits([frag({ source: 'website', payload: { kind: 'block', text: 'x' } })], (e) => anomalies.push(e));
    expect(out).toHaveLength(0);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.fragmentCount).toBe(1);
    expect(anomalies[0]?.sampleKeys).toContain('payload'); // names what it actually saw
  });

  it('does not cry wolf: a normal projection does not invoke onAnomaly', () => {
    const anomalies: unknown[] = [];
    toSourceUnits([frag({ source: 'upload', payload: { ref: 'u', text: 'hello' } })], (e) => anomalies.push(e));
    expect(anomalies).toHaveLength(0);
  });

  // Post-refactor: the extracted shared function is byte-for-byte equivalent to the private projection on
  // a combined fixture. (The service's private toUnits now delegates to this; asserting equality covers the
  // shared function directly, so it stays covered even if the delegate is later removed.)
  it('toSourceUnits() === the service projection on a combined fixture', () => {
    const frags = [
      frag({ source: 'website', sourceUrl: 'https://bodymovestudio.ro/', payload: { text: 'Kinetoterapie', pageType: 'home' } }),
      frag({ source: 'website', sourceUrl: 'https://bodymovestudio.ro/sitemap.xml', payload: { text: 'drop' } }),
      frag({ source: 'instagram', sourceUrl: 'https://instagram.com/p/z', payload: { text: 'ig post' } }),
      frag({ source: 'upload', sourceUrl: null, id: 'fragA', payload: { text: 'uploaded' } }),
      frag({ source: 'upload', sourceUrl: 'founder://supplied/3', payload: { ref: 'Pliant', text: 'first' } }),
      frag({ source: 'upload', sourceUrl: 'founder://supplied/4', payload: { ref: 'Pliant', text: 'second' } }),
      frag({ source: 'instagram', payload: { kind: 'block', text: 'skip' } }),
    ];
    expect(toSourceUnits(frags)).toEqual(project(frags));
  });
});
