import { describe, it, expect } from 'vitest';
import { makeFragment } from '@bb/domain';
import { buildObservedReflection, buildInferredLines } from '../../business-model/reflection';

const home = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/', confidenceKind: 'observed',
  payload: { pageType: 'home', title: 'Acme', description: 'x', og: { 'og:description': 'a calm, done-for-you content system for founders' }, text: 'home text' },
});
const services = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/services', confidenceKind: 'observed',
  payload: { pageType: 'services', title: 'Services', description: 'a monthly content retainer', text: 'services text' },
});
const blog = makeFragment({
  founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/blog/stop-posting', confidenceKind: 'observed',
  payload: { pageType: 'blog_post', title: 'Stop posting daily', text: 'blog text' },
});

describe('Beat 1 — observed reflection (deterministic, fast, traceable)', () => {
  it('builds grounded lines from evidence, each linked to its page', () => {
    const r = buildObservedReflection({ state: 'synced', observed: [home, services, blog], gaps: [] });
    const labels = r.lines.map((l) => l.label);
    expect(labels).toEqual(['Positioning', 'Offer', 'Themes']);
    expect(r.lines.find((l) => l.label === 'Positioning')!.fragmentIds).toEqual([home.id]);
    expect(r.lines.find((l) => l.label === 'Offer')!.fragmentIds).toEqual([services.id]);
    expect(r.lines.find((l) => l.label === 'Themes')!.fragmentIds).toEqual([blog.id]);
    expect(r.lines.every((l) => l.kind === 'observed')).toBe(true);
    expect(r.handoff).toMatch(/what are you actually trying to build/i);
  });

  it('ignores block fragments (resolution-only) — Beat 1 reads page fragments unchanged', () => {
    const block = makeFragment({
      founderId: 'f1', source: 'website', sourceUrl: 'https://acme.co/', confidenceKind: 'observed',
      payload: { kind: 'block', blockType: 'h1', pageType: 'home', text: 'A heading block that must not become a Beat-1 line' },
    });
    const r = buildObservedReflection({ state: 'synced', observed: [home, services, blog, block], gaps: [] });
    expect(r.lines.map((l) => l.label)).toEqual(['Positioning', 'Offer', 'Themes']);
    expect(r.lines.find((l) => l.label === 'Positioning')!.fragmentIds).toEqual([home.id]); // page fragment, not the block
  });

  it('honest empty when nothing usable was extracted (no fabricated read)', () => {
    const blank = makeFragment({ founderId: 'f1', source: 'website', sourceUrl: 'https://x.co/', confidenceKind: 'observed', payload: { pageType: 'other', text: '' } });
    const r = buildObservedReflection({ state: 'synced', observed: [blank], gaps: [] });
    expect(r.state).toBe('empty');
    expect(r.lines).toHaveLength(0);
  });

  it('failed state carries honest copy, no lines', () => {
    expect(buildObservedReflection({ state: 'failed', observed: [], gaps: [] }).message).toMatch(/couldn't reach/i);
  });
});

describe('Beat 2 — inferred lines from persisted synthesis (traceable by construction)', () => {
  it('renders a persisted inferred fragment with its resolved provenance', () => {
    const inf = makeFragment({
      founderId: 'f1', source: 'business-model', confidenceKind: 'inferred', derivedFrom: [home.id],
      payload: { statement: 'Your calm promise and hustle-weary audience are one story', category: 'contradictions' },
    });
    const lines = buildInferredLines([inf]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.kind).toBe('inferred');
    expect(lines[0]!.fragmentIds).toEqual([home.id]);
  });

  it('drops an inferred fragment with no statement', () => {
    const inf = makeFragment({ founderId: 'f1', source: 'business-model', confidenceKind: 'inferred', derivedFrom: [home.id], payload: { category: 'blindSpots' } });
    expect(buildInferredLines([inf])).toHaveLength(0);
  });
});
