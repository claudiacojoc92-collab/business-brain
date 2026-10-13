import { locate, normRef } from '../atoms/atom-extraction.service';
import type { ClaimEvidence, GovernedUnderstanding, PageObservation } from './contracts';

/**
 * Per-claim evidence, verified (BUS-73). The model proposes, for every tension and the capability check, the exact
 * sentence(s) from a cited source; only a quote that is a VERBATIM span of that source's stored text survives (the
 * same anchoring the licensed atoms use: diacritic- and whitespace-folded to LOCATE, stored exactly as written).
 * Never repaired or fuzzy-matched: a quote that does not anchor is dropped, and a claim left with none is not shown.
 */
const MAX_PER_CLAIM = 3;

/** The page's name for the founder: the title's own part (no " · Site name" tail), cut at a word, never mid-word. */
export function pageName(o: PageObservation, max = 60): string {
  // The ref is the title cut at 40 characters (bridge.ts labelFor) when it came from the title; else a label.
  const title = (o.title ?? '').trim();
  const ref = o.ref.replace(/\s*\(\d+\)$/, '');
  const fromTitle = Boolean(title) && ref === title.slice(0, 40);
  const base = fromTitle ? (title.split(/\s+[·|–—-]\s+/)[0]!.trim() || title) : ref;
  if (base.length <= max) return base;
  const cut = base.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:·|–—-]+$/, '')}...`;
}

function resolve(ref: string, obs: readonly PageObservation[]): PageObservation | null {
  const r = (ref ?? '').trim();
  if (!r) return null;
  return obs.find((o) => o.ref === r) ?? obs.find((o) => normRef(o.ref) === normRef(r)) ?? null;
}

export function anchorClaimEvidence(proposed: unknown, obs: readonly PageObservation[]): ClaimEvidence[] {
  if (!Array.isArray(proposed)) return [];
  const out: ClaimEvidence[] = [];
  for (const e of proposed as { ref?: unknown; quote?: unknown }[]) {
    if (!e || typeof e.ref !== 'string' || typeof e.quote !== 'string') continue;
    const quote = e.quote.trim().replace(/^["“„«']+|["”»']+$/g, '').trim();
    if (quote.split(/\s+/).length < 3 || /\.\.\.|…/.test(quote)) continue; // a sentence, never a stitched excerpt
    const o = resolve(e.ref, obs);
    const span = o ? locate(o.text, quote) : null;
    if (!o || !span) continue;
    // Whole words only: a span that starts or ends inside a word on the page ("…join the n" of "network", where the
    // model's view of the page was cut) is a broken quote, not evidence.
    const letter = /[\p{L}\p{N}]/u;
    if (letter.test(o.text[span.start - 1] ?? '') && letter.test(o.text[span.start] ?? '')) continue;
    if (letter.test(o.text[span.end - 1] ?? '') && letter.test(o.text[span.end] ?? '')) continue;
    const asWritten = o.text.slice(span.start, span.end).replace(/\s+/g, ' ').trim();
    if (out.some((x) => x.quote === asWritten)) continue;
    out.push({ ref: o.ref, page: pageName(o), quote: asWritten });
    if (out.length >= MAX_PER_CLAIM) break;
  }
  return out;
}

/** Synthesis output → the stored understanding, with every claim's evidence verified against the sources. */
export function anchorUnderstandingEvidence(u: GovernedUnderstanding, obs: readonly PageObservation[]): GovernedUnderstanding {
  if (!u) return u;
  return {
    ...u,
    contradictions: (u.contradictions ?? []).map((c) => ({ ...c, evidence: anchorClaimEvidence(c.evidence, obs) })),
    ...(u.capabilityCheck ? { capabilityCheck: { ...u.capabilityCheck, evidence: anchorClaimEvidence(u.capabilityCheck.evidence, obs) } } : {}),
  };
}

/**
 * A quote for the card, at most `max` characters: whole sentences when they fit; else cut at the last sentence end,
 * then the last comma, then the last space before the limit, and only as a last resort mid-word. The cut ends in "...".
 */
export function clipQuote(q: string, max = 200): string {
  const t = (q ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const room = t.slice(0, max - 3);
  const at = (re: RegExp): number => { let i = -1; for (const m of room.matchAll(re)) i = m.index!; return i; };
  const sentence = at(/[.!?](?=\s)/g);
  if (sentence > 0) return `${room.slice(0, sentence)}...`;
  const comma = at(/,(?=\s)/g);
  if (comma > 0) return `${room.slice(0, comma)}...`;
  const space = room.lastIndexOf(' ');
  if (space > 0) return `${room.slice(0, space).replace(/[\s,;:]+$/, '')}...`;
  return `${room}...`;
}
