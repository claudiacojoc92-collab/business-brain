import { describe, it, expect } from 'vitest';
import { extractReadableText, extractBlocks, extractPage } from '../extract';

const page = (body: string) => `<html><head><title>T</title></head><body>${body}</body></html>`;

describe('the reader keeps block boundaries (BUS-73: "participationIntegrate")', () => {
  it('list items in one list are joined with " · "', () => {
    expect(extractReadableText(page('<h3>Next steps</h3><ul><li>Expand network participation</li><li>Integrate with additional blockchains</li><li>Deploy enterprise solutions</li></ul>')))
      .toBe('Next steps Expand network participation · Integrate with additional blockchains · Deploy enterprise solutions');
  });
  it('a heading and the text after it get a space; text already ending in punctuation is left as is', () => {
    expect(extractReadableText(page('<div><h2>Global adoption</h2><p>Regulatory readiness driving growth.</p><p>Second line.</p></div>')))
      .toBe('Global adoption Regulatory readiness driving growth. Second line.');
    expect(extractReadableText(page('<ul><li>One, </li><li>two.</li><li>three</li></ul>'))).toBe('One, two. three');
  });
  it('inline elements never add a separator; <br> does', () => {
    expect(extractReadableText(page('<p>Qu<b>Fi</b> Network by <a href="#">Qu<span>Vault</span></a></p>'))).toBe('QuFi Network by QuVault');
    expect(extractReadableText(page('<p>50+ countries<br>200+ organisations</p>'))).toBe('50+ countries 200+ organisations');
    // a label and its line as two touching inline elements (qufi.network): "identityPortable" before the fix
    expect(extractReadableText(page('<div><b>Digital identity</b><span>Portable, verifiable credentials.</span></div>'))).toBe('Digital identity Portable, verifiable credentials.');
  });
  it('separate lists do not run into each other with " · "', () => {
    expect(extractReadableText(page('<ul><li>A item</li></ul><ul><li>B item</li></ul>'))).toBe('A item B item');
  });
  it('blocks stay substrings of the page text (the resolver and the atoms anchor against both)', () => {
    const html = page('<section><h2>Next steps</h2><ul><li>Expand network participation now</li><li>Integrate with additional blockchains</li></ul></section><p>QuSettle checks conditions before settlement.</p>');
    const text = extractPage('https://x.test/', html).text;
    for (const b of extractBlocks(html)) expect(text).toContain(b.text);
    expect(text).toContain('Expand network participation now · Integrate with additional blockchains');
  });
});
