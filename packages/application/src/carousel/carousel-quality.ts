/**
 * Slice 6 — Carousel Quality Contract, DETERMINISTIC STRUCTURAL part only.
 *
 * Claim safety is NOT here: it is enforced by the frozen shared proposition-safety kernel via
 * ./carousel-safety (Layer 1/2/3, block + full-asset, one authority). This module keeps only the
 * deterministic structural/traceability gates (lineage, no padding, hook-first, proof grounded) and a
 * cheap business-specificity backstop; the causal anti-template judge remains the real genericity gate.
 */
import type { CarouselAssetVersion, AssetAuthorizationSnapshot, CarouselBrief, GateReport, GateFinding, Slide } from './contracts';

export interface CopyValidationInput {
  readonly slides: Slide[];
  readonly snapshot: AssetAuthorizationSnapshot;
  readonly brief: CarouselBrief;
  readonly conceptOutlineLength: number;
}

// Unfilled template tokens a copy layer can leave behind. Deterministic; if any match survives to persist, the copy
// would reach a client with "[Name]" in it. Bracket/brace tokens + common textual placeholders (word-bounded so a
// real "TK"-free clause is untouched; a bare "$" price is NOT a placeholder and is not matched).
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\[[^\]]+\]/,                       // [Name], [Number]
  /\{[^}]*\}/,                        // {name}, {{number}}
  /<[^>]+>/,                          // <name>, <insert here>
  /\bX{3,}\b/i,                       // XXX, XXXX
  /\bTBD\b/i,
  /\bTK\b/,                           // journalism placeholder (uppercase only, to avoid matching names)
  /\byour\s+\w+\s+here\b/i,           // "your name here"
  /\binsert\s+\w+/i,                  // "insert name"
  /\bplaceholder\b/i,
  /\blorem ipsum\b/i,
];
function firstPlaceholder(text: string): string | null {
  for (const re of PLACEHOLDER_PATTERNS) { const m = re.exec(text); if (m) return m[0].slice(0, 40); }
  return null;
}

const STOP = new Set(['the', 'and', 'your', 'with', 'this', 'that', 'for', 'from', 'about', 'into', 'their', 'they', 'them', 'will', 'have', 'what', 'when', 'where', 'which', 'more', 'over', 'next', 'make', 'business', 'founder', 'strategy', 'content', 'offer', 'carousel', 'slide', 'post']);
const words = (s: string): string[] => (s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w));
const assertiveText = (s: Slide): string => s.textBlocks.filter((b) => b.role !== 'cta').map((b) => b.text).filter(Boolean).join('. ');

/** Deterministic STRUCTURAL gate. Claim safety is validated separately by validateCarouselClaimSafety. */
export function validateCarouselCopy(input: CopyValidationInput): GateReport {
  const f: GateFinding[] = [];
  const push = (code: string, slideId: string | null, detail: string): void => { f.push({ code, severity: 'blocking', slideId, detail }); };
  const { slides, snapshot, brief } = input;

  // ── traceability / structure ──
  if (!brief.createHandoffId || !brief.strategyVersionId) push('untraceable_asset', null, 'missing createHandoff/strategy lineage');
  if (slides.length < 1) push('empty_asset', null, 'no slides');
  if (slides.length !== input.conceptOutlineLength) push('slide_count_mismatch_concept', null, `slides ${slides.length} ≠ concept outline ${input.conceptOutlineLength} (padding?)`);
  if (slides.some((s) => s.textBlocks.every((b) => !b.text.trim()))) push('empty_slide', null, 'a slide has no text (padding)');
  if (slides[0]?.semanticRole !== 'hook') push('no_hook_first', null, 'first slide is not a hook');

  // ── source grounding: a proof slide must bind to a proof/source ──
  for (const s of slides) {
    if (s.semanticRole === 'proof') {
      const bound = s.textBlocks.some((b) => b.authorizedFrom.propositionRef || b.authorizedFrom.sourceRefId) || s.sourceRefIds.length > 0;
      if (!bound) push('ungrounded_proof', s.slideId, 'proof slide is not bound to a licensed proposition/source');
    }
  }

  // ── UNFILLED PLACEHOLDER gate (deterministic; code only). A carousel that fails closed costs nothing; one that
  //    reaches a client with "[Name]" in it costs credibility. Reject any template token the copy layer left
  //    unfilled — square-bracket / curly-brace tokens, XXX, TBD, "your … here", "insert …", placeholder, lorem
  //    ipsum, TK. Any match blocks the asset (→ insufficient), on every path (normal / strip / constrained / revise).
  for (const s of slides) {
    for (const b of s.textBlocks) {
      const hit = firstPlaceholder(b.text);
      if (hit) { push('unfilled_placeholder', s.slideId, `unfilled placeholder in ${b.role}: "${hit}"`); break; }
    }
  }

  // ── business-specificity backstop (cheap; the causal anti-template judge is the real gate) ──
  const whole = slides.map(assertiveText).join('. ');
  const strategyTokens = new Set(words([snapshot.audienceUseContext, brief.communicationJob, brief.strategicBetTrace, brief.founderGoalTrace].join(' ')));
  const assetTokens = words(whole);
  if (assetTokens.length && !assetTokens.some((w) => strategyTokens.has(w))) push('generic_carousel', null, 'no strategy/context-specific token survives — likely generic');

  return { valid: f.length === 0, findings: f };
}

/** Anti-template deterministic backstop probe (strip proper nouns → does strategy substance survive?). */
export function isCarouselTransplantable(version: CarouselAssetVersion, businessName: string): boolean {
  const strip = (s: string): string => s.replace(new RegExp(businessName, 'gi'), ' ').replace(/\b[A-Z][a-z]+\b/g, ' ');
  const stripped = version.slides.flatMap((s) => s.textBlocks.map((b) => strip(b.text))).join(' ');
  const strategyTokens = new Set(words([version.brief.communicationJob, version.brief.strategicBetTrace, version.brief.founderGoalTrace, version.concept.communicationLogic].join(' ')));
  return !words(stripped).some((w) => strategyTokens.has(w));
}
