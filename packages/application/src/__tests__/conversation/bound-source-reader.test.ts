/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { BoundSourceReader } from '../../conversation/index';

/** Minimal fragment stub (only the fields the reader touches). */
function frag(f: Partial<any>): any {
  return {
    id: f.id ?? 'x',
    founderId: 'F',
    source: f.source ?? 'website',
    platform: f.platform ?? null,
    sourceUrl: f.sourceUrl ?? null,
    confidenceKind: f.confidenceKind ?? 'observed',
    occurredAt: null,
    capturedAt: new Date(0),
    visibility: 'private',
    payload: f.payload ?? {},
    derivedFrom: null,
  };
}

function reader(bound: string[], fragments: any[]) {
  return new BoundSourceReader(
    { bind: async () => ({ linked: 0 }), listFragmentIds: async () => bound } as any,
    { findByFounder: async () => fragments } as any,
  );
}

describe('BoundSourceReader', () => {
  it('returns only fragments bound to THIS business, honoring provenance', async () => {
    const web = frag({ id: 'w', source: 'website', sourceUrl: 'https://x.ro/about', confidenceKind: 'observed', payload: { text: 'We are a Schroth clinic', pageType: 'about', title: 'About' } });
    const pdf = frag({ id: 'p', source: 'pdf', sourceUrl: 'founder://file/1', confidenceKind: 'declared', payload: { text: 'Medical brochure — purely clinical, no fitness framing', ref: 'Medical brochure', pageType: 'pdf' } });
    const otherBiz = frag({ id: 'z', source: 'pdf', sourceUrl: 'founder://file/2', confidenceKind: 'declared', payload: { text: 'someone else', ref: 'X', pageType: 'pdf' } });
    const out = await reader(['w', 'p'], [web, pdf, otherBiz]).listForBusiness('B', 'F');
    expect(out.map((s) => s.ref)).not.toContain('X'); // unbound fragment excluded
    const brochure = out.find((s) => s.ref === 'Medical brochure');
    expect(brochure).toMatchObject({ provenance: 'declared', pageType: 'pdf' });
    expect(brochure!.text).toContain('no fitness framing');
    expect(out.find((s) => s.pageType === 'about')?.provenance).toBe('observed');
  });

  it('skips block payloads and empty text, and caps long source text', async () => {
    const block = frag({ id: 'b', source: 'pdf', sourceUrl: 'u1', confidenceKind: 'declared', payload: { text: 'ignored', kind: 'block' } });
    const empty = frag({ id: 'e', source: 'pdf', sourceUrl: 'u2', confidenceKind: 'declared', payload: { text: '   ', ref: 'Empty' } });
    const long = frag({ id: 'l', source: 'pdf', sourceUrl: 'u3', confidenceKind: 'declared', payload: { text: 'A'.repeat(9000), ref: 'Long' } });
    const out = await reader(['b', 'e', 'l'], [block, empty, long]).listForBusiness('B', 'F');
    expect(out.map((s) => s.ref)).toEqual(['Long']); // block + empty dropped
    expect(out[0]!.text.length).toBeLessThanOrEqual(3500); // per-source cap
  });

  it('filters sitemap/XML junk and puts founder-handed material BEFORE website pages (the real Body Move failure)', async () => {
    const sitemap = frag({ id: 's', source: 'website', sourceUrl: 'https://x.ro/post-sitemap.xml', confidenceKind: 'observed', payload: { text: '<urlset>...', pageType: 'page', title: 'Post-sitemap.xml' } });
    const home = frag({ id: 'h', source: 'website', sourceUrl: 'https://x.ro/', confidenceKind: 'observed', payload: { text: 'Homepage — two locations', pageType: 'home', title: 'Home' } });
    const pdf = frag({ id: 'p', source: 'pdf', sourceUrl: 'founder://file/1', confidenceKind: 'declared', payload: { text: 'Medical brochure — purely clinical', ref: 'Medical brochure', pageType: 'pdf' } });
    const out = await reader(['s', 'h', 'p'], [sitemap, home, pdf]).listForBusiness('B', 'F');
    expect(out.some((s) => /sitemap/i.test(s.ref))).toBe(false); // sitemap dropped
    expect(out[0]!.ref).toBe('Medical brochure'); // handed-over material first
    expect(out.map((s) => s.ref)).toContain('Homepage'); // labelFor maps pageType 'home' → 'Homepage'
  });

  it('caps at 12 sources but keeps handed-over material even behind many website pages', async () => {
    const many = Array.from({ length: 30 }, (_, i) => frag({ id: `w${i}`, source: 'website', sourceUrl: `https://x.ro/p${i}`, confidenceKind: 'observed', payload: { text: `page ${i}`, pageType: 'page', title: `P${i}` } }));
    const pdf = frag({ id: 'p', source: 'pdf', sourceUrl: 'founder://file/1', confidenceKind: 'declared', payload: { text: 'brochure body', ref: 'Brochure', pageType: 'pdf' } });
    const out = await reader([...many.map((m) => m.id), 'p'], [...many, pdf]).listForBusiness('B', 'F');
    expect(out.length).toBe(12);
    expect(out[0]!.ref).toBe('Brochure'); // survives the cap despite 30 website pages
  });

  it('returns [] when nothing is bound', async () => {
    expect(await reader([], []).listForBusiness('B', 'F')).toEqual([]);
  });
});
