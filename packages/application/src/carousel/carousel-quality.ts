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
