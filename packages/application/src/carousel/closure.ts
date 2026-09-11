/**
 * Slice 6 — Communication CLOSURE / CTA continuity. A QUALITY check (not claim safety): a CTA can be fully
 * authorized yet still fail because it is unexplained, disconnected from the developed communication, or
 * redundant. Rule: carousel body → CTA function → communication closure. Deterministic core (action present,
 * no redundant CTA lines) + an optional semantic closure judge (purpose, causal connection to the
 * problem/insight/offer, no new unexplained object, adds clarity).
 */
import type { Slide, AssetAuthorizationSnapshot, GateFinding, ClosureVerdict } from './contracts';

type ClosureJudge = (input: { bodyBeats: string[]; cta: string; ctaFunction: string; offerMaterial: string[] }) => Promise<ClosureVerdict>;

// Concrete actions a CTA may name. M5.7: added the common TRANSACTIONAL/visit verbs (shop, buy, browse, order,
// purchase, reserve, visit, stop by, pick up, find) — for a commerce/physical offer these ARE the concrete
// next step, and their earlier omission made an otherwise-valid transactional CTA fail cta_no_action. This is a
// QUALITY-gate vocabulary fix, not a claim-safety change (safety still governs every word of the CTA).
const ACTION = /\b(book|schedule|get|start|join|reply|message|dm|download|see|try|talk|call|register|apply|claim|grab|reach|request|subscribe|save|explore|learn|watch|read|follow|sign up|set up|shop|buy|browse|order|purchase|reserve|visit|stop by|pick up|find)\b/i;
const STOP = new Set(['the', 'and', 'your', 'with', 'this', 'that', 'for', 'from', 'about', 'into', 'their', 'they', 'them', 'will', 'have', 'what', 'when', 'where', 'which', 'more', 'over', 'next', 'make', 'call', 'book', 'link', 'bio']);
const nouns = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
function jaccard(a: Set<string>, b: Set<string>): number { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i += 1; return i / (a.size + b.size - i); }

/** The slide that carries the CTA (last cta-role slide, else the last slide). */
export function ctaSlideOf(slides: Slide[]): Slide | undefined {
  return [...slides].reverse().find((s) => s.semanticRole === 'cta') ?? slides[slides.length - 1];
}

export async function validateClosure(slides: Slide[], snapshot: AssetAuthorizationSnapshot, judge?: ClosureJudge): Promise<GateFinding[]> {
  const findings: GateFinding[] = [];
  const cta = ctaSlideOf(slides);
  if (!cta) return findings;
  const ctaText = cta.textBlocks.find((b) => b.role === 'cta')?.text ?? '';
  const ctaHead = cta.textBlocks.find((b) => b.role === 'headline')?.text ?? '';

  // (1) the CTA must name a concrete proposed action
  if (ctaText && !ACTION.test(ctaText)) findings.push({ code: 'cta_no_action', severity: 'blocking', slideId: cta.slideId, detail: `CTA does not name a concrete action: "${ctaText.slice(0, 60)}"` });
  // (5)/(dup) the CTA slide's headline must not merely restate the CTA line without adding a distinct function
  if (ctaHead && ctaText && jaccard(nouns(ctaHead), nouns(ctaText)) > 0.6) findings.push({ code: 'cta_redundant', severity: 'blocking', slideId: cta.slideId, detail: `CTA slide repeats itself without added clarity: "${ctaHead}" / "${ctaText}"` });

  // (2)(3)(4) semantic closure — earned by the body, causally connected, no new unexplained object
  if (judge) {
    const bodyBeats = slides.filter((s) => s.slideId !== cta.slideId).flatMap((s) => s.textBlocks.filter((b) => b.role !== 'cta').map((b) => b.text)).filter(Boolean);
    const offerMaterial = [...snapshot.licensedPropositions.map((p) => p.text), ...snapshot.proofFacts];
    const ctaFull = [ctaHead, ctaText].filter(Boolean).join(' — ');
    try {
      const v = await judge({ bodyBeats, cta: ctaFull, ctaFunction: snapshot.ctaFunction, offerMaterial });
      if (!v.closed) findings.push({ code: 'cta_not_closed', severity: 'blocking', slideId: cta.slideId, detail: `CTA does not close the loop the carousel opened: ${v.reason}` });
    } catch { /* judge best-effort */ }
  }
  return findings;
}
