import { describe, it, expect } from 'vitest';
import { normalizeUrl, isSameOrigin } from '../../../connectors/website/url';
import { parseSitemapUrls, extractLinks, discoverKeyPages } from '../../../connectors/website/discovery';
import { extractPage, classifyPageType, extractReadableText, extractBlocks } from '../../../connectors/website/extract';
import { parseRobots, isAllowed } from '../../../connectors/website/fetcher';

describe('URL normalization', () => {
  it('adds https:// when scheme missing', () => {
    expect(normalizeUrl('acme.co')).toMatchObject({ ok: true, host: 'acme.co' });
  });
  it('trims and keeps an explicit scheme', () => {
    const r = normalizeUrl('  http://acme.co/about  ');
    expect(r).toMatchObject({ ok: true, url: 'http://acme.co/about', origin: 'http://acme.co' });
  });
  it('rejects empty and non-domain input', () => {
    expect(normalizeUrl('').ok).toBe(false);
    expect(normalizeUrl('notaurl').ok).toBe(false);
  });
  it('rejects non-http(s) schemes', () => {
    expect(normalizeUrl('ftp://acme.co').ok).toBe(false);
  });
  it('isSameOrigin distinguishes hosts', () => {
    expect(isSameOrigin('https://acme.co/a', 'https://acme.co/b')).toBe(true);
    expect(isSameOrigin('https://acme.co', 'https://evil.co')).toBe(false);
  });
});

describe('Discovery', () => {
  it('parses <loc> urls from a sitemap', () => {
    const xml = '<urlset><url><loc>https://acme.co/</loc></url><url><loc>https://acme.co/pricing</loc></url></urlset>';
    expect(parseSitemapUrls(xml)).toEqual(['https://acme.co/', 'https://acme.co/pricing']);
  });
  it('extracts only same-origin links, dropping mailto/fragments/third-party', () => {
    const html = '<a href="/about">a</a><a href="mailto:x@y.z">m</a><a href="https://twitter.com/acme">t</a><a href="#top">top</a>';
    expect(extractLinks('https://acme.co/', html)).toEqual(['https://acme.co/about']);
  });
  it('composes a bounded key-page set: entry first, sitemap+nav+common, deduped, same-origin', () => {
    const pages = discoverKeyPages(
      { entryUrl: 'https://acme.co/', origin: 'https://acme.co', entryHtml: '<a href="/services">s</a>', sitemapXml: '<loc>https://acme.co/pricing</loc>' },
      5,
    );
    expect(pages[0]).toBe('https://acme.co/');
    expect(pages).toContain('https://acme.co/pricing');
    expect(pages).toContain('https://acme.co/services');
    expect(pages.length).toBeLessThanOrEqual(5);
    expect(pages.every((u) => u.startsWith('https://acme.co'))).toBe(true);
  });
});

describe('Extraction', () => {
  const html = `<!doctype html><html lang="en"><head>
    <title>Acme — Clarity for founders</title>
    <meta name="description" content="We bring calm and clarity.">
    <meta property="og:title" content="Acme">
    <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
    </head><body><nav>skip me</nav><main><h1>What we do</h1><p>${'We help founders. '.repeat(30)}</p></main><footer>skip</footer></body></html>`;

  it('pulls title, description, OG, JSON-LD, lang', () => {
    const ex = extractPage('https://acme.co/', html);
    expect(ex.title).toBe('Acme — Clarity for founders');
    expect(ex.description).toBe('We bring calm and clarity.');
    expect(ex.og['og:title']).toBe('Acme');
    expect(ex.jsonld).toHaveLength(1);
    expect(ex.lang).toBe('en');
  });
  it('strips nav/footer/script from readable text', () => {
    const text = extractReadableText(html);
    expect(text).toContain('We help founders.');
    expect(text).not.toContain('skip me');
    expect(text).not.toContain('skip');
  });
  it('classifies page types from the path', () => {
    expect(classifyPageType('https://acme.co/', null)).toBe('home');
    expect(classifyPageType('https://acme.co/about', null)).toBe('about');
    expect(classifyPageType('https://acme.co/pricing', null)).toBe('pricing');
    expect(classifyPageType('https://acme.co/blog/post-1', null)).toBe('blog_post');
  });
  it('marks a near-empty page as empty (no hollow fragment)', () => {
    const ex = extractPage('https://acme.co/x', '<html><body><div id="app"></div></body></html>');
    expect(ex.empty).toBe(true);
  });
  it('extracts leaf block text from readable content, skipping boilerplate and sub-floor blocks', () => {
    const blocks = extractBlocks(html);
    const texts = blocks.map((b) => b.text);
    expect(texts.some((t) => t.startsWith('We help founders.'))).toBe(true); // the <p> leaf (long enough)
    expect(texts.some((t) => t.includes('skip me') || t === 'skip')).toBe(false); // nav/footer stripped
    expect(texts).not.toContain('What we do'); // 10-char heading is below the block floor (never matchable)
    expect(blocks.every((b) => b.text.length >= 24)).toBe(true); // floor holds
  });
});

describe('robots.txt', () => {
  it('respects Disallow for the * group', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\n');
    expect(isAllowed(rules, '/about')).toBe(true);
    expect(isAllowed(rules, '/private/x')).toBe(false);
  });
  it('absent rules allow everything', () => {
    expect(isAllowed({ disallow: [] }, '/anything')).toBe(true);
  });
});
