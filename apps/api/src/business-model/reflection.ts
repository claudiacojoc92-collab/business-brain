/**
 * Reflection builder (M2.1) — TWO BEATS (spec correction, timing decision B):
 *
 *   Beat 1 (fast, ~fetch time): the grounded OBSERVED reflection — positioning, offer,
 *     themes — derived DETERMINISTICALLY from the DOM-extracted evidence. No 100s synthesis
 *     call. This carries the "how does it know" moment and is what the ~30s promise attaches
 *     to ("first grounded reflection"), not the complete model.
 *   Beat 2 (streams behind): the INFERRED insights, from the persisted synthesis fragments
 *     (each already carrying a resolved derived_from link).
 *
 * Fails closed both beats: an observed line renders only if it has a real source fragment;
 * an inferred line renders only if its persisted fragment carries derived_from. Empty/
 * partial/failed never fabricate a read.
 */
import type { EvidenceFragment } from '@bb/domain';
import type { ConnectionState } from '../connectors/website/website.connector';

export interface ReflectionLine {
  label: string;
  text: string;
  kind: 'observed' | 'inferred' | 'declared'; // declared = the founder told us (Capability B)
  fragmentIds: string[]; // provenance — always non-empty for a rendered line
}

export interface Reflection {
  state: ConnectionState;
  lead: string | null;
  lines: ReflectionLine[];
  handoff: string | null;
  message: string | null;
  gaps: string[];
}

const COPY = {
  lead: "Here's what I can already see:",
  handoff: "That's what I can see from the outside. Now tell me the part I can't see — what are you actually trying to build?",
  partial: "I read what I could, but a few pages didn't load cleanly. Here's what I've got so far — point me at anything I missed.",
  empty: "I reached your site but couldn't read much — it looks like the content loads in a way I can't see yet. Want to upload a page or doc instead so I can read your business properly?",
  failed: "I couldn't reach that URL. Want to check it and try again, or give me a different link?",
} as const;

function str(f: EvidenceFragment, key: string): string | null {
  const v = f.payload?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function og(f: EvidenceFragment, key: string): string | null {
  const o = f.payload?.['og'];
  if (o && typeof o === 'object') {
    const v = (o as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}
function pick(observed: EvidenceFragment[], type: string): EvidenceFragment | undefined {
  return observed.find((f) => String(f.payload?.['pageType']) === type);
}
function snippet(s: string, n = 220): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

/**
 * BEAT 1 — deterministic observed reflection from the extracted evidence. Fast, grounded,
 * traceable (each line links to the exact page it came from). No engine call.
 */
export function buildObservedReflection(args: {
  state: ConnectionState;
  observed: EvidenceFragment[];
  gaps: string[];
}): Reflection {
  const base = (over: Partial<Reflection>): Reflection =>
    ({ state: args.state, lead: null, lines: [], handoff: null, message: null, gaps: args.gaps, ...over });

  if (args.state === 'failed') return base({ message: COPY.failed });
  // Beat 1 reads PAGE fragments only; block fragments are resolution-only (Beat 2) and must
  // not be picked here.
  const observed = args.observed.filter((f) => f.payload?.['kind'] !== 'block');
  if (args.state === 'empty' || observed.length === 0) return base({ state: 'empty', message: COPY.empty });

  const lines: ReflectionLine[] = [];
  const home = pick(observed, 'home') ?? observed[0]!;

  const positioning = og(home, 'og:description') ?? str(home, 'description') ?? str(home, 'title');
  if (positioning) lines.push({ label: 'Positioning', text: `You position yourself as ${snippet(positioning)}`, kind: 'observed', fragmentIds: [home.id] });

  const offerPage = pick(observed, 'services') ?? pick(observed, 'pricing');
  const offer = offerPage ? (str(offerPage, 'description') ?? str(offerPage, 'title') ?? (str(offerPage, 'text') ? snippet(str(offerPage, 'text')!) : null)) : null;
  if (offerPage && offer) lines.push({ label: 'Offer', text: `Your offer looks like ${offer}`, kind: 'observed', fragmentIds: [offerPage.id] });

  const blog = observed.filter((f) => String(f.payload?.['pageType']) === 'blog_post');
  const titles = blog.map((f) => str(f, 'title')).filter((t): t is string => Boolean(t));
  if (titles.length) lines.push({ label: 'Themes', text: `Lately you've been writing about ${titles.slice(0, 4).join('; ')}`, kind: 'observed', fragmentIds: blog.map((f) => f.id) });

  if (lines.length === 0) return base({ state: 'empty', message: COPY.empty });

  return base({
    lead: COPY.lead,
    lines,
    handoff: COPY.handoff,
    message: args.state === 'partial' ? COPY.partial : null,
  });
}

/**
 * BEAT 2 — inferred lines from the persisted synthesis fragments. Each already carries a
 * resolved derived_from (fail-closed at persist), so these are traceable by construction.
 */
export function buildInferredLines(inferredPersisted: EvidenceFragment[]): ReflectionLine[] {
  const lines: ReflectionLine[] = [];
  for (const f of inferredPersisted) {
    const statement = str(f, 'statement');
    const ids = Array.isArray(f.derivedFrom) ? f.derivedFrom : [];
    if (statement && ids.length) lines.push({ label: String(f.payload?.['category'] ?? 'Pattern'), text: statement, kind: 'inferred', fragmentIds: [...ids] });
  }
  return lines;
}

/**
 * BEAT 1 (upload) — grounded observed lines from uploaded documents. Each line traces to its
 * upload unit fragment and names the document + location ("from slide 7 of Pitch-Deck.pdf"),
 * so provenance is the most trust-building in the product (§8). Reads unit fragments only
 * (blocks are resolution-only). Traceable by construction; nothing untraceable renders.
 */
export function buildUploadObservedLines(uploadObserved: EvidenceFragment[]): ReflectionLine[] {
  const units = uploadObserved.filter((f) => f.confidenceKind === 'observed' && f.source === 'upload' && f.payload?.['kind'] !== 'block');
  const lines: ReflectionLine[] = [];
  for (const f of units.slice(0, 6)) {
    const text = str(f, 'text');
    if (!text) continue;
    const doc = f.payload?.['sourceDocument'] as { filename?: string } | undefined;
    const anchor = f.payload?.['anchor'] as { label?: string } | undefined;
    const where = [doc?.filename, anchor?.label].filter(Boolean).join(' · ');
    lines.push({ label: where || 'From your document', text: `From your document: ${snippet(text)}`, kind: 'observed', fragmentIds: [f.id] });
  }
  return lines;
}

/**
 * BEAT 1 (Google) — grounded observed lines from granted Google files. Mirrors the upload builder;
 * each line traces to its google unit fragment and names the document + location ("from your
 * 'Q3 Strategy' doc"). Reads unit fragments only (blocks are resolution-only). Traceable by
 * construction; the doc identity is the founder's private working document (visibility:private).
 */
export function buildGoogleObservedLines(googleObserved: EvidenceFragment[]): ReflectionLine[] {
  const units = googleObserved.filter((f) => f.confidenceKind === 'observed' && f.source === 'google' && f.payload?.['kind'] !== 'block');
  const lines: ReflectionLine[] = [];
  for (const f of units.slice(0, 6)) {
    const text = str(f, 'text');
    if (!text) continue;
    const doc = f.payload?.['sourceDocument'] as { filename?: string } | undefined;
    const anchor = f.payload?.['anchor'] as { label?: string } | undefined;
    const where = [doc?.filename, anchor?.label].filter(Boolean).join(' · ');
    lines.push({ label: where || 'From your Google doc', text: `From your Google doc: ${snippet(text)}`, kind: 'observed', fragmentIds: [f.id] });
  }
  return lines;
}

/**
 * DECLARED (Capability B) — the founder's stated intent, attributed as DECLARED, never observed.
 * Reads declared unit fragments (source 'founder'); renders "You told me: …" with kind 'declared'
 * (the chip reads "you said", NOT "your website says" / "your business is"). This is the honesty
 * line of the moat: declared is what the founder asserted, kept distinct from what we perceived.
 */
export function buildDeclaredLines(declared: EvidenceFragment[]): ReflectionLine[] {
  const units = declared.filter((f) => f.confidenceKind === 'declared' && f.payload?.['kind'] !== 'block');
  const lines: ReflectionLine[] = [];
  for (const f of units.slice(0, 6)) {
    const text = str(f, 'text');
    if (!text) continue;
    const label = String(f.payload?.['label'] ?? 'You said');
    lines.push({ label, text: `You told me: ${snippet(text)}`, kind: 'declared', fragmentIds: [f.id] });
  }
  return lines;
}
