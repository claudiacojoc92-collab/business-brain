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
