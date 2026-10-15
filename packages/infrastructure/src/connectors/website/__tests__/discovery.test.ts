import { describe, it, expect } from 'vitest';
import { discoverKeyPagesWithSource } from '../discovery';

/**
 * Key-page discovery in TRUST order (2026-10-15): what the homepage links to (what visitors actually see) before what a
 * sitemap lists (possibly stale or orphaned). Sitemap XML documents and technical pages are never read as business pages.
 */
describe('discoverKeyPagesWithSource', () => {
  const entryHtml = `<nav><a href="/servicii/">Servicii</a><a href="/despre-noi/">Despre</a><a href="/cos/">Coș</a></nav>
    <a href="/test-postural/">Test postural</a><a href="mailto:x@y.ro">mail</a><a href="https://other.ro/">other</a>`;
  const sitemapXml = `<sitemapindex><sitemap><loc>https://a.ro/page-sitemap.xml</loc></sitemap><sitemap><loc>https://a.ro/product-sitemap.xml</loc></sitemap></sitemapindex>
    <urlset><url><loc>https://a.ro/maintenance/</loc></url><url><loc>https://a.ro/old-offer/</loc></url><url><loc>https://a.ro/servicii/</loc></url></urlset>`;
  const pages = discoverKeyPagesWithSource({ entryUrl: 'https://a.ro/', origin: 'https://a.ro', entryHtml, sitemapXml });

  it('homepage links come first, each tagged with how it was found; a page both linked and in the sitemap counts as linked', () => {
    expect(pages.slice(0, 4)).toEqual([
      { url: 'https://a.ro/', via: 'entry' },
      { url: 'https://a.ro/servicii/', via: 'link' },
      { url: 'https://a.ro/despre-noi/', via: 'link' },
      { url: 'https://a.ro/test-postural/', via: 'link' }, // a real offer named "test", not a test page
    ]);
    expect(pages.find((p) => p.url === 'https://a.ro/old-offer/')).toEqual({ url: 'https://a.ro/old-offer/', via: 'sitemap' });
  });

  it('never reads sitemap XML, maintenance, cart or other origins as pages', () => {
    const urls = pages.map((p) => p.url).join(' ');
    expect(urls).not.toMatch(/sitemap\.xml|maintenance|\/cos\/|other\.ro|mailto/);
  });

  it('stays within the budget', () => {
    expect(discoverKeyPagesWithSource({ entryUrl: 'https://a.ro/', origin: 'https://a.ro', entryHtml, sitemapXml }, 3)).toHaveLength(3);
  });
});
