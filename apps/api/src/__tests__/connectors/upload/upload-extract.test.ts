import { describe, it, expect } from 'vitest';
import { detectType, assertWithinBounds, UploadBoundsError, MAX_BYTES } from '../../../connectors/upload/detect';
import { extractPdf, extractDocx, extractText } from '../../../connectors/upload/extract';
import { makeMinimalPdf, makeMinimalDocx } from './fixtures';

describe('detection — by content (magic bytes), never extension (§5.5, §9)', () => {
  it('detects PDF, DOCX, and text by content', async () => {
    expect(detectType(makeMinimalPdf(['hello']))).toBe('pdf');
    expect(detectType(makeMinimalDocx([{ body: 'hello world here' }]))).toBe('docx');
    expect(detectType(Buffer.from('a genuine strategy memo, in plain text'))).toBe('text');
  });
  it('rejects a non-DOCX zip and binary as unsupported', () => {
    const plainZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]); // zip sig, no word/document.xml
    expect(detectType(plainZip)).toBe('unsupported');
    expect(detectType(Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]))).toBe('unsupported'); // NUL → binary
  });
  it('a .txt named file is still detected by content, not the name', () => {
    // content is a PDF; "extension" is irrelevant — detection reads bytes
    expect(detectType(makeMinimalPdf(['x']))).toBe('pdf');
  });
});

describe('security bounds (§9)', () => {
  it('rejects empty and oversized files before parsing', () => {
    expect(() => assertWithinBounds(Buffer.alloc(0))).toThrow(UploadBoundsError);
    expect(() => assertWithinBounds(Buffer.alloc(MAX_BYTES + 1))).toThrow(UploadBoundsError);
    expect(() => assertWithinBounds(Buffer.from('ok'))).not.toThrow();
  });
});

describe('extraction → units with location anchors (§7)', () => {
  it('PDF → page-anchored units, strong provenance', async () => {
    const doc = await extractPdf(makeMinimalPdf(['Our positioning is calm software', 'Pricing is flat and fair']), 'deck.pdf');
    expect(doc.type).toBe('pdf');
    expect(doc.provenanceStrength).toBe('strong');
    expect(doc.units.length).toBeGreaterThanOrEqual(1);
    expect(doc.units[0]!.anchor.kind).toBe('page');
    expect(doc.units.map((u) => u.text).join(' ')).toContain('positioning');
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('DOCX → section-anchored units by heading, strong provenance', async () => {
    const doc = await extractDocx(makeMinimalDocx([
      { heading: 'Positioning', body: 'We help founders show up with clarity every single day.' },
      { heading: 'Offer', body: 'A monthly content retainer for busy founders.' },
    ]), 'strategy.docx');
    expect(doc.type).toBe('docx');
    expect(doc.provenanceStrength).toBe('strong');
    const sections = doc.units.map((u) => u.anchor.section);
    expect(sections).toContain('Positioning');
    expect(sections).toContain('Offer');
  });

  it('markdown text → section anchors; flat text → weak whole-doc; both weak provenance (§4)', () => {
    const md = extractText(Buffer.from('# Positioning\nWe are calm software for teams.\n\n# Offer\nFlat pricing forever.'), 'memo.md');
    expect(md.provenanceStrength).toBe('weak');
    expect(md.units.map((u) => u.anchor.section)).toContain('Positioning');

    const flat = extractText(Buffer.from('just one flat blob of prose with no structure at all to anchor to here'), 'note.txt');
    expect(flat.provenanceStrength).toBe('weak');
    expect(flat.units[0]!.anchor.kind).toBe('document');
  });

  it('a readable-but-contentless file is honestly empty, not fabricated (§10 Empty)', () => {
    const doc = extractText(Buffer.from('   \n  \n'), 'blank.txt');
    expect(doc.empty).toBe(true);
  });
});
