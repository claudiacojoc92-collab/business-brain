/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { fragmentMatchesSource, fileSourceSlug } from '../../bi/pour-in-source';
import { LearnBusinessService } from '../../bi/learn-business.use-case';

const frag = (source: string, sourceUrl: string, payload: Record<string, unknown>, platform: string | null = null): EvidenceFragment =>
  makeFragment({ founderId: 'f1', source, platform, sourceUrl, confidenceKind: source === 'founder_supplied' ? 'declared' : 'observed',
    visibility: source === 'founder_supplied' ? 'private' : 'public', occurredAt: null, payload: { text: 'x', ...payload } });

const website = frag('website', 'https://www.bodymovestudio.ro/about', { pageType: 'about' }, 'www.bodymovestudio.ro');
const ig = frag('instagram', 'https://instagram.com/p/1', { pageType: 'instagram_post' }, 'instagram');
const linkNew = frag('founder_supplied', 'https://press.example/final', { pageType: 'link', sourceKey: 'press.example/story' });
const linkOld = frag('founder_supplied', 'https://press.example/story', { pageType: 'link' });
const fileNew = frag('founder_supplied', 'founder://file/brochure-2026-pdf/1', { pageType: 'founder_supplied', sourceKey: 'Brochure 2026.pdf' });
const fileOld = frag('founder_supplied', `founder://file/${fileSourceSlug('Price list.pdf')}/2`, { pageType: 'founder_supplied' });
const desc = frag('founder_supplied', 'founder://text', { pageType: 'founder_supplied' });
const all = [website, ig, linkNew, linkOld, fileNew, fileOld, desc];
const matching = (url: string, type: string) => all.filter((f) => fragmentMatchesSource(f, { url, type })).map((f) => f.id);

describe('fragmentMatchesSource — which stored evidence a listed source owns', () => {
  it('website: by host (www-insensitive)', () => expect(matching('bodymovestudio.ro', 'website')).toEqual([website.id]));
  it('instagram: every Instagram fragment', () => expect(matching('@claudiacojoc', 'instagram')).toEqual([ig.id]));
  it('link: by sourceKey (survives redirects), or by url/host for older rows', () => {
    expect(matching('press.example/story', 'link')).toEqual([linkNew.id, linkOld.id]);
  });
  it('file: by sourceKey, or by the founder://file/<slug>/ prefix for older rows', () => {
    expect(matching('Brochure 2026.pdf', 'pdf')).toEqual([fileNew.id]);
    expect(matching('Price list.pdf', 'pdf')).toEqual([fileOld.id]);
  });
  it('description: the founder://text rows', () => expect(matching('Your description', 'description')).toEqual([desc.id]));
  it('unknown type matches nothing', () => expect(matching('x', 'weird')).toEqual([]));
});

describe('LearnBusinessService.unlinkPourInSource', () => {
  function harness() {
    const bound = new Set(all.map((f) => f.id));
    const unbound: string[][] = [];
    const deps: any = {
      evidenceRepo: { findByFounder: async () => all },
      links: { listFragmentIds: async () => [...bound], bind: async () => ({ linked: 0 }),
        unbind: async (_b: string, ids: readonly string[]) => { unbound.push([...ids]); ids.forEach((i) => bound.delete(i)); return { unlinked: ids.length }; } },
    };
    return { service: new LearnBusinessService(deps), bound, unbound };
  }

  it('unlinks only the fragments of that source; other sources stay bound', async () => {
    const h = harness();
    const r = await h.service.unlinkPourInSource({ businessId: 'B', founderId: 'f1', source: { url: '@claudiacojoc', type: 'instagram' } });
    expect(r.unlinked).toBe(1);
    expect(h.bound.has(ig.id)).toBe(false);
    expect(h.bound.has(website.id)).toBe(true);
  });

  it('nothing to unlink → no repository call', async () => {
    const h = harness();
    const r = await h.service.unlinkPourInSource({ businessId: 'B', founderId: 'f1', source: { url: 'nope.com', type: 'website' } });
    expect(r.unlinked).toBe(0);
    expect(h.unbound).toHaveLength(0);
  });
});
