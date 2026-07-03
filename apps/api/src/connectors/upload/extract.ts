/**
 * Per-type extraction → structured units with LOCATION ANCHORS (spec §7). Extraction is
 * text-only and SAFE (§9): pdf-parse/mammoth extract text and do NOT execute embedded content
 * (PDF JavaScript, DOCX macros are never run). Page/complexity caps bound the work.
 */
import pdf from 'pdf-parse/lib/pdf-parse.js'; // entry directly — avoids index.js's debug block (reads a bundled test PDF at import)
import { convertToHtml } from 'mammoth';
import { parse } from 'node-html-parser';
import { MAX_PAGES, MIN_MEANINGFUL_CHARS, contentHash } from './detect';
import type { ExtractedDoc, ExtractedUnit, SupportedType } from './types';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const BLOCK_MIN_CHARS = 24;

/** Split a unit's text into finer resolution blocks (sentence/line level), reusing M2.1's floor. */
function blocksOf(text: string): Array<{ text: string; blockType: string }> {
  const out: Array<{ text: string; blockType: string }> = [];
  const seen = new Set<string>();
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const t = clean(raw);
    if (t.length >= BLOCK_MIN_CHARS && !seen.has(t)) { seen.add(t); out.push({ text: t, blockType: 'sentence' }); }
  }
  return out;
}

function finish(type: SupportedType, filename: string, hash: string, units: ExtractedUnit[], strong: boolean): ExtractedDoc {
  const total = units.reduce((n, u) => n + u.text.length, 0);
  return {
    type, filename, contentHash: hash, units,
    provenanceStrength: strong ? 'strong' : 'weak',
    pageCount: units.length,
    empty: total < MIN_MEANINGFUL_CHARS,
  };
}

/** PDF → one unit per page; anchor = page number. Strong provenance. Never executes PDF JS. */
export async function extractPdf(bytes: Buffer, filename: string): Promise<ExtractedDoc> {
  const pages: string[] = [];
  await pdf(bytes, {
    max: MAX_PAGES,
    pagerender: async (page) => {
      const tc = await page.getTextContent();
      const text = clean(tc.items.map((i) => i.str).join(' '));
      pages.push(text);
      return text;
    },
  });
  const units: ExtractedUnit[] = pages
    .map((text, i) => ({ text, i }))
    .filter((p) => p.text.length > 0)
    .map((p) => ({ text: p.text, anchor: { kind: 'page' as const, page: p.i + 1, label: `page ${p.i + 1}` }, blocks: blocksOf(p.text) }));
  return finish('pdf', filename, contentHash(bytes), units, true);
}

/** DOCX → one unit per heading-delimited section; anchor = heading path. Strong provenance. */
export async function extractDocx(bytes: Buffer, filename: string): Promise<ExtractedDoc> {
  const { value: html } = await convertToHtml({ buffer: bytes });
  const root = parse(html, { comment: false });
  const units: ExtractedUnit[] = [];
  let current: { heading: string; parts: string[] } = { heading: 'Document', parts: [] };
  const flush = () => {
    const text = clean(current.parts.join('\n'));
    if (text.length > 0) units.push({ text, anchor: { kind: 'section', section: current.heading, label: current.heading }, blocks: blocksOf(text) });
  };
  for (const el of (root.querySelector('body') ?? root).childNodes) {
    const tag = (el as { rawTagName?: string }).rawTagName?.toLowerCase();
    const text = clean((el as { text?: string }).text ?? '');
    if (!text) continue;
    if (tag && /^h[1-6]$/.test(tag)) { flush(); current = { heading: text, parts: [] }; }
    else current.parts.push(text);
  }
  flush();
  // Fallback: no structure at all → single document unit (still strong-typed, coarser anchor).
  if (units.length === 0) {
    const text = clean((root.querySelector('body') ?? root).text);
    if (text) units.push({ text, anchor: { kind: 'document', label: filename }, blocks: blocksOf(text) });
  }
  return finish('docx', filename, contentHash(bytes), units, true);
}

/** Text/Markdown → paragraph/section units where structure exists; whole-doc when flat. Weak (§4). */
export function extractText(bytes: Buffer, filename: string): ExtractedDoc {
  const raw = bytes.toString('utf8');
  const hasHeadings = /^#{1,6}\s+\S/m.test(raw);
  const units: ExtractedUnit[] = [];
  if (hasHeadings) {
    // markdown: split on headings
    const sections = raw.split(/^(#{1,6}\s+.*)$/m);
    let heading = filename;
    for (const seg of sections) {
      if (/^#{1,6}\s+/.test(seg)) { heading = clean(seg.replace(/^#{1,6}\s+/, '')); continue; }
      const text = clean(seg);
      if (text.length > 0) units.push({ text, anchor: { kind: 'section', section: heading, label: heading }, blocks: blocksOf(text) });
    }
  } else {
    // flat: paragraph anchors where blank-line separated, else one document unit
    const paras = raw.split(/\n\s*\n/).map(clean).filter((p) => p.length > 0);
    if (paras.length > 1) {
      paras.forEach((text, i) => units.push({ text, anchor: { kind: 'paragraph', paragraph: i + 1, label: `paragraph ${i + 1}` }, blocks: blocksOf(text) }));
    } else if (paras.length === 1) {
      units.push({ text: paras[0]!, anchor: { kind: 'document', label: filename }, blocks: blocksOf(paras[0]!) });
    }
  }
  return finish('text', filename, contentHash(bytes), units, false); // text/markdown = weak provenance
}
