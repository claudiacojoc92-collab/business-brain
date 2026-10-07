import { describe, it, expect } from 'vitest';
import type { EvidenceFragment } from '@bb/domain';
import { bridgeFragmentsToObservations, hostOf } from '../../bi/index';

function frag(over: Partial<EvidenceFragment> & { payload: Record<string, unknown> }): EvidenceFragment {
  return {
    id: over.id ?? 'f' + Math.random().toString(36).slice(2),
    founderId: 'F',
    source: 'website',
    platform: over.platform ?? 'acme.com',
    sourceUrl: over.sourceUrl ?? 'https://acme.com/',
    confidenceKind: 'observed',
    occurredAt: null,
    capturedAt: new Date(0),
    visibility: 'public',
    derivedFrom: null,
    ...over,
  } as EvidenceFragment;
}

describe('bridgeFragmentsToObservations', () => {
  it('projects PAGE fragments into observations and skips BLOCK fragments', () => {
    const frags = [
      frag({ sourceUrl: 'https://acme.com/', payload: { text: 'Home text here', pageType: 'home', title: 'Acme' } }),
      frag({ sourceUrl: 'https://acme.com/services', payload: { text: 'We do services', pageType: 'services' } }),
      frag({ sourceUrl: 'https://acme.com/', payload: { kind: 'block', text: 'a block', blockType: 'p' } }),
    ];
    const obs = bridgeFragmentsToObservations(frags, 'acme.com');
    expect(obs).toHaveLength(2);
    expect(obs.map((o) => o.ref).sort()).toEqual(['Homepage', 'Services']);
  });

  it('filters out fragments from a different host', () => {
    const frags = [
      frag({ platform: 'acme.com', sourceUrl: 'https://acme.com/', payload: { text: 'ours', pageType: 'home' } }),
      frag({ platform: 'evil.com', sourceUrl: 'https://evil.com/', payload: { text: 'theirs', pageType: 'home' } }),
    ];
    const obs = bridgeFragmentsToObservations(frags, 'acme.com');
    expect(obs).toHaveLength(1);
    expect(obs[0]?.url).toBe('https://acme.com/');
  });

  it('dedupes by url and skips empty text', () => {
    const frags = [
      frag({ sourceUrl: 'https://acme.com/x', payload: { text: 'x', pageType: 'page' } }),
      frag({ sourceUrl: 'https://acme.com/x', payload: { text: 'x again', pageType: 'page' } }),
      frag({ sourceUrl: 'https://acme.com/empty', payload: { text: '   ', pageType: 'page' } }),
    ];
    const obs = bridgeFragmentsToObservations(frags, 'acme.com');
    expect(obs).toHaveLength(1);
  });

  it('hostOf strips www', () => {
    expect(hostOf('https://www.acme.com/path')).toBe('acme.com');
  });
});

describe('hostOf — scheme-less normalization (production bind regression)', () => {
  // Regression: a bare domain used to throw in new URL() → '' → the fragment-host filter matched
  // zero rows even though ingestion stored fragments under the real host. All valid equivalents must
  // resolve to the SAME canonical host.
  it('normalizes bare, www, scheme-full, and path/query variants to one canonical host', () => {
    expect(hostOf('basecamp.com')).toBe('basecamp.com');
    expect(hostOf('www.basecamp.com')).toBe('basecamp.com');
    expect(hostOf('https://basecamp.com')).toBe('basecamp.com');
    expect(hostOf('http://basecamp.com')).toBe('basecamp.com');
    expect(hostOf('https://www.basecamp.com')).toBe('basecamp.com');
    expect(hostOf('basecamp.com/path')).toBe('basecamp.com');
    expect(hostOf('https://basecamp.com/path?x=1')).toBe('basecamp.com');
    expect(hostOf('https://www.basecamp.com/path')).toBe('basecamp.com');
  });

  it('fails safely on malformed input', () => {
    expect(hostOf('')).toBe('');
    expect(hostOf('   ')).toBe('');
    expect(hostOf('http://')).toBe('');
    expect(hostOf('::::')).toBe('');
  });

  it('bind seam: a bare-domain input matches fragments stored under the real host', () => {
    // Fragments as ingestion persists them (platform = real host); founder typed a bare domain.
    const frags = [
      frag({ platform: 'basecamp.com', sourceUrl: 'https://basecamp.com/', payload: { text: 'Homepage copy', pageType: 'home', title: 'Basecamp' } }),
      frag({ platform: 'basecamp.com', sourceUrl: 'https://basecamp.com/pricing', payload: { text: 'Pricing copy', pageType: 'pricing' } }),
    ];
    const host = hostOf('basecamp.com'); // the raw founder input
    const forHost = frags.filter((f) => (f.platform ?? '').replace(/^www\./, '') === host);
    expect(forHost).toHaveLength(2); // was 0 before the fix
    expect(bridgeFragmentsToObservations(forHost, host)).toHaveLength(2);
  });
});
