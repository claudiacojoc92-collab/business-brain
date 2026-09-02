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
