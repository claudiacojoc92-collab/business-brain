/**
 * Per-page extraction via a light DOM parse (node-html-parser). Cleaner than regex on
 * real, testimonial-heavy pages — which directly improves BOTH the observed-reflection
 * quality (garbage-in → garbage-out) and the engine's quote/resolution hit-rate.
 * Server-rendered HTML only (SPA shells resolve to honest empty).
 */
import { parse, type HTMLElement } from 'node-html-parser';

export type PageType = 'home' | 'about' | 'services' | 'pricing' | 'blog_post' | 'contact' | 'other';

export interface Extracted {
  title: string | null;
  description: string | null;
  og: Record<string, string>;
  jsonld: unknown[];
  text: string;
  lang: string | null;
  pageType: PageType;
  empty: boolean;
}

const MIN_MEANINGFUL_CHARS = 200;
const BOILERPLATE = 'script,style,noscript,template,svg,nav,footer,header,aside,form,iframe';

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function clean(s: string): string {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

export function extractReadableText(html: string): string {
  const root = parse(html, { comment: false });
  root.querySelectorAll(BOILERPLATE).forEach((el) => el.remove());
  const body = root.querySelector('body') ?? root;
  return clean(body.text);
}

export interface Block { text: string; blockType: string }

// Block-level elements we treat as atomic, resolvable text units. Leaf-only w.r.t. this set
// (a <p> with inline <span> children is still one block; a <div> wrapping <p>s is not — its
// children are captured instead), so each block's text is exactly the run the engine sees.
const BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dd,dt,th,td,div,section,article,summary,caption';
const BLOCK_TAGS = new Set(BLOCK_SEL.split(','));
// A block shorter than the resolution segment char-floor can never contain a valid segment,
// so storing it would be dead weight — align the two.
const BLOCK_MIN_CHARS = 24;
// Bounded "group" block: covers spans that cross several small sibling blocks. Capped so it can
// never become a whole-page block, and emitted ONE LEVEL ONLY (a direct parent of block children).
// 1200 (measured): recovers the cap-bound coverage residual (cohort 85%→90%) at ~3pt leaf→group
// provenance cost; the second grouping level was measured to add 0, so it stays forbidden.
const GROUP_MAX_CHARS = 1200;
const MAX_BLOCKS_PER_PAGE = 500;

/** True iff el has a DIRECT child that is a block element (→ el is a one-level grouping parent). */
function hasDirectBlockChild(el: HTMLElement): boolean {
  return el.childNodes.some((c) => (c as { nodeType?: number }).nodeType === 1 && BLOCK_TAGS.has(((c as { rawTagName?: string }).rawTagName ?? '').toLowerCase()));
}

/**
 * Extract per-block text from the SAME readable region as extractReadableText (boilerplate
 * removed), so blocks ⊆ what the engine is fed. These become additional REAL observed
 * fragments used ONLY for finer resolution — engine input stays the page-level text.
 *   - LEAF blocks (h/p/li/…): fine-grained, sentence-level provenance.
 *   - GROUP blocks: a bounded (≤GROUP_MAX_CHARS), one-level parent of block children — so a
 *     quote spanning several small sibling blocks still maps to a real, specific block (never
 *     the page). The resolver prefers the most specific block; a group is credited only where
 *     no leaf covers the span.
 */
export function extractBlocks(html: string): Block[] {
  const root = parse(html, { comment: false });
  root.querySelectorAll(BOILERPLATE).forEach((el) => el.remove());
  const body = root.querySelector('body') ?? root;
  const out: Block[] = [];
  const seen = new Set<string>();
  const push = (text: string, blockType: string) => {
    if (text.length < BLOCK_MIN_CHARS || seen.has(text)) return; // content-addressing dedupes anyway
    seen.add(text);
    out.push({ text, blockType });
  };
  for (const el of body.querySelectorAll(BLOCK_SEL)) {
    if (out.length >= MAX_BLOCKS_PER_PAGE) break;
    const t = clean(el.text);
    if (!el.querySelector(BLOCK_SEL)) {
      push(t, (el.rawTagName ?? 'block').toLowerCase()); // leaf
    } else if (hasDirectBlockChild(el) && t.length <= GROUP_MAX_CHARS) {
      push(t, 'group'); // one-level bounded group
    }
  }
  return out;
}

function extractMeta(root: HTMLElement): { title: string | null; description: string | null; og: Record<string, string>; lang: string | null } {
  const title = root.querySelector('title')?.text ? clean(root.querySelector('title')!.text) : null;
  const og: Record<string, string> = {};
  let description: string | null = null;
  for (const m of root.querySelectorAll('meta')) {
    const content = m.getAttribute('content');
    if (!content) continue;
    const name = m.getAttribute('name');
    const prop = m.getAttribute('property');
    if (name && name.toLowerCase() === 'description') description = clean(content);
    if (prop && /^og:/i.test(prop)) og[prop.toLowerCase()] = clean(content);
  }
  const lang = root.querySelector('html')?.getAttribute('lang') ?? null;
  return { title, description, og, lang: lang ? lang.trim() : null };
}

function extractJsonLd(root: HTMLElement): unknown[] {
  const blocks: unknown[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = s.text?.trim();
    if (!raw) continue;
    try { blocks.push(JSON.parse(raw)); } catch { /* skip malformed JSON-LD */ }
  }
  return blocks;
}

export function classifyPageType(url: string, title: string | null): PageType {
  let path = '/';
  try { path = new URL(url).pathname.toLowerCase(); } catch { /* keep default */ }
  const t = (title ?? '').toLowerCase();
  if (path === '/' || path === '' || path === '/index.html') return 'home';
  if (/(^|\/)about/.test(path) || /\babout\b/.test(t)) return 'about';
  if (/(^|\/)(pricing|plans)/.test(path) || /\bpricing\b/.test(t)) return 'pricing';
  if (/(^|\/)(services|products|solutions|offer)/.test(path)) return 'services';
  if (/(^|\/)(blog|articles?|posts?|insights|news)\//.test(path)) return 'blog_post';
  if (/(^|\/)contact/.test(path)) return 'contact';
  return 'other';
}

export function extractPage(url: string, html: string): Extracted {
  const root = parse(html, { comment: false });
  const { title, description, og, lang } = extractMeta(root);
  const jsonld = extractJsonLd(root);
  root.querySelectorAll(BOILERPLATE).forEach((el) => el.remove());
  const body = root.querySelector('body') ?? root;
  const text = clean(body.text);
  const empty = text.length < MIN_MEANINGFUL_CHARS && !description && Object.keys(og).length === 0;
  return { title, description, og, jsonld, text, lang, pageType: classifyPageType(url, title), empty };
}
