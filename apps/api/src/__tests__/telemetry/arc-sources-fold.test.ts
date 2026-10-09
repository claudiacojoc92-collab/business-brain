import { describe, it, expect } from 'vitest';
import { foldArcSourceEvents } from '../../telemetry/founder-events';

const ev = (url: string, type: string, detail?: string) => ({ metadata: { url, type, ...(detail ? { detail } : {}) } });

describe('foldArcSourceEvents — the pour-in source list', () => {
  it('re-adding a source shows its LATEST read (Instagram 12 → 50 posts), in first-added position', () => {
    const rows = foldArcSourceEvents([
      ev('bodymovestudio.ro', 'website', '8 pages read'),
      ev('@claudiacojoc', 'instagram', '12 posts read'),
      ev('brochure.pdf', 'pdf', '4 pages read'),
      ev('@claudiacojoc', 'instagram', '50 posts read'),
    ]);
    expect(rows).toEqual([
      { url: 'bodymovestudio.ro', type: 'website', detail: '8 pages read' },
      { url: '@claudiacojoc', type: 'instagram', detail: '50 posts read' },
      { url: 'brochure.pdf', type: 'pdf', detail: '4 pages read' },
    ]);
  });

  it('applies to website, link and file sources too', () => {
    const rows = foldArcSourceEvents([
      ev('x.ro', 'website', '3 pages read'), ev('https://press/x', 'link'), ev('offer.pdf', 'pdf', '1 page read'),
      ev('x.ro', 'website', '10 pages read'), ev('https://press/x', 'link', 'read'), ev('offer.pdf', 'pdf', '2 pages read'),
    ]);
    expect(rows.map((r) => r.detail)).toEqual(['10 pages read', 'read', '2 pages read']);
  });

  it('skips rows without a url; unknown types fall back to website', () => {
    expect(foldArcSourceEvents([{ metadata: {} }, { metadata: null }, ev('y.com', 'weird')])).toEqual([{ url: 'y.com', type: 'website' }]);
  });
});

describe('foldArcSourceEvents — removed sources', () => {
  const removed = (url: string, type: string) => ({ event_type: 'arc_source_removed', metadata: { url, type } });
  const added = (url: string, type: string, detail?: string) => ({ event_type: 'arc_source_added', ...ev(url, type, detail) });

  it('a removed source drops out of the list', () => {
    const rows = foldArcSourceEvents([added('x.ro', 'website'), added('@me', 'instagram', '50 posts read'), removed('@me', 'instagram')]);
    expect(rows.map((r) => r.url)).toEqual(['x.ro']);
  });

  it('adding it again after removal brings it back, at the end', () => {
    const rows = foldArcSourceEvents([added('x.ro', 'website'), added('@me', 'instagram'), removed('@me', 'instagram'), added('brochure.pdf', 'pdf'), added('@me', 'instagram', '50 posts read')]);
    expect(rows.map((r) => r.url)).toEqual(['x.ro', 'brochure.pdf', '@me']);
    expect(rows[2]?.detail).toBe('50 posts read');
  });
});
