import { describe, it, expect } from 'vitest';
import { extractPage, extractReadableText, extractBlocks } from '../../../connectors/website/extract';

/**
 * WC-1 — structural-noise cleanup. Proves the extractor strips author-declared CHROME and
 * non-content artifacts (cookie/consent banners, ARIA-landmark chrome, doctype) while keeping
 * real business content VERBATIM. The line: remove chrome, never judge which content matters.
 * Also the selector-support gate — a strip selector that silently matches nothing leaves its
 * boilerplate in and turns "drops-boilerplate" RED.
 */

const NOISY_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <title>Acme</title>
    <meta name="description" content="Acme builds tools." />
    <style>.brand { color: red; }</style>
    <script>window.analytics = 1;</script>
  </head>
  <body>
    <div id="onetrust-banner-sdk" class="ot-sdk-container">Manage your cookie preferences before continuing.</div>
    <div class="cookie-consent">We would like to use cookies to help understand if our ads are working.</div>
    <div role="banner">Spring promo — 40% off all annual plans, this week only!</div>
    <nav>Home Pricing About Contact Login</nav>
    <div role="navigation">Products Solutions Company Careers</div>
    <main>
      <h1>Acme builds calm software for small teams</h1>
      <p>Every Acme customer gets one workspace where projects, messages, and files live together.</p>
    </main>
    <footer>© 2026 Acme, Inc. All rights reserved. Privacy Terms</footer>
  </body>
</html>`;

const NOISE_STRINGS = [
  '<!doctype', 'doctype html',
  'cookie preferences', 'would like to use cookies',
  'Spring promo', '40% off',
  'Home Pricing About', 'Products Solutions Company',
  '© 2026 Acme', 'All rights reserved',
  'window.analytics', 'color: red',
];

const REAL_H1 = 'Acme builds calm software for small teams';
const REAL_P = 'Every Acme customer gets one workspace where projects, messages, and files live together.';

describe('WC-1 extract — drops structural boilerplate', () => {
  it('page text + blocks contain NONE of: doctype, cookie/consent banners, ARIA-landmark chrome, nav/footer, script/style', () => {
    const { text } = extractPage('https://acme.example/', NOISY_PAGE);
    const blockText = extractBlocks(NOISY_PAGE).map((b) => b.text).join('  ');
    const readable = extractReadableText(NOISY_PAGE);
    for (const noise of NOISE_STRINGS) {
      expect(text, `page text must not contain "${noise}"`).not.toContain(noise);
      expect(blockText, `no block may contain "${noise}"`).not.toContain(noise);
      expect(readable, `readable text must not contain "${noise}"`).not.toContain(noise);
    }
  });
});

describe('WC-1 extract — keeps real content verbatim', () => {
  it('the real <h1>/<p> copy survives byte-for-byte in page text and as blocks', () => {
    const { text } = extractPage('https://acme.example/', NOISY_PAGE);
    expect(text).toContain(REAL_H1);
    expect(text).toContain(REAL_P);
    const blocks = extractBlocks(NOISY_PAGE).map((b) => b.text);
    expect(blocks).toContain(REAL_H1); // leaf <h1> stored exactly as written
    expect(blocks).toContain(REAL_P); // leaf <p> stored exactly as written
  });
});

describe('WC-1 extract — not over-stripped', () => {
  it('a prose-heavy page of plain <div>s (no <main>, no cookie/consent classes) keeps its content', () => {
    const paras = Array.from(
      { length: 6 },
      (_, i) => `<div class="row">Paragraph ${i} — a substantial run of real business prose about the offering.</div>`,
    ).join('');
    const html = `<html><body>${paras}</body></html>`;
    const { text, empty } = extractPage('https://plain.example/', html);
    expect(empty).toBe(false);
    expect(text).toContain('Paragraph 0 — a substantial run of real business prose about the offering.');
    expect(text).toContain('Paragraph 5 — a substantial run of real business prose about the offering.');
  });
});

describe('WC-1 extract — doctype / no-<body> edge (regression)', () => {
  it('a document with no <body> falls back to root WITHOUT leaking the doctype declaration', () => {
    const noBody = `<!doctype html><title>Acme</title><div class="cookie">We use cookies.</div><p>Real content that is long enough to count as meaningful for the extractor.</p>`;
    const readable = extractReadableText(noBody);
    expect(readable.startsWith('<!doctype')).toBe(false);
    expect(readable).not.toContain('<!doctype');
    expect(readable).not.toContain('We use cookies'); // cookie div still stripped on the no-body path
    expect(readable).toContain('Real content that is long enough to count as meaningful');
  });
});

describe('WC-1 extract — cookie false-positive guard', () => {
  it('a class that merely contains "cook" (not "cookie") is KEPT', () => {
    const html = `<html><body><div class="cook-book-recipe"><p>Our cook-book has forty tested recipes for busy weeknights.</p></div></body></html>`;
    const { text } = extractPage('https://food.example/', html);
    expect(text).toContain('Our cook-book has forty tested recipes for busy weeknights.');
  });
});
