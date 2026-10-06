import type { AtomClass } from '../atoms/contracts';
import type { LandingAuthorizationSnapshot, LandingProposition } from './contracts';

/**
 * Assemble a landing MOVE from the SAME substrate carousel and reel draw from — no hand-built snapshot in the
 * production path. The caller adapts the shared carouselContext into this view (anchored atoms carry their
 * class so the generator can route them; synthesized understanding facts and founder statements are the
 * general / founder lanes). Two hard rules live here:
 *   • ADOPTION GATE — a landing move is conditioned on the business's ADOPTED strategy. No adopted strategy ⇒
 *     carouselContext returns null ⇒ we FAIL CLOSED with a legible reason. No fallback that drafts anyway.
 *   • STRATEGY CONDITIONING — the communication job is the adopted strategy's direction (goal + audience), not
 *     a generic studio page, so the draft answers the question the strategy actually asks.
 */
export interface LandingContextView {
  readonly strategyVersionId: string;
  readonly language: string;
  readonly goal: string;
  readonly audience: string;
  readonly ctaDirection: string;
  readonly atoms: readonly { readonly value: string; readonly atomClass: AtomClass }[]; // anchored, classed
  readonly synthesizedFacts: readonly string[];  // allowedBusinessFacts(understanding) — synthesized, general
  readonly founderOwned: readonly string[];       // active founder statements
  readonly proofFacts: readonly string[];
  readonly voiceLines: readonly string[];
}

export interface LandingMoveIds { readonly businessId: string; readonly actionId: string; readonly planVersionId: string }

export type LandingMoveResult =
  | { readonly status: 'ready'; readonly snapshot: LandingAuthorizationSnapshot; readonly communicationJob: string; readonly voiceLines: string[] }
  | { readonly status: 'blocked'; readonly reason: 'no_adopted_strategy'; readonly message: string };

/** The legible reason a surface can show instead of an empty state — a silent empty state is the failure mode
 *  we have been hunting all day. */
export const NO_ADOPTED_STRATEGY_MESSAGE =
  'Nu există încă o strategie adoptată. Pagina de prezentare se construiește în jurul direcției pe care o adopți — până atunci, nu avem pe ce să scriem o pagină.';

export function assembleLandingMove(ctx: LandingContextView | null, ids: LandingMoveIds, now: () => string, genId: () => string): LandingMoveResult {
  // ADOPTION GATE — fail closed, legibly. Never draft without an adopted strategy.
  if (!ctx) return { status: 'blocked', reason: 'no_adopted_strategy', message: NO_ADOPTED_STRATEGY_MESSAGE };

  const licensedPropositions: LandingProposition[] = [
    ...ctx.atoms.map((a, i): LandingProposition => ({ ref: `A${i + 1}`, text: a.value, source: 'business_evidence', atomClass: a.atomClass })),
    ...ctx.synthesizedFacts.map((t, i): LandingProposition => ({ ref: `B${i + 1}`, text: t, source: 'business_evidence' })),
    ...ctx.founderOwned.map((t, i): LandingProposition => ({ ref: `F${i + 1}`, text: t, source: 'founder_owned' })),
  ];
  // STRATEGY CONDITIONING — the job is the adopted strategy's direction, not a generic studio landing.
  const communicationJob = `Pagina de prezentare care servește strategia adoptată — obiectiv: ${ctx.goal}; pentru: ${ctx.audience}. Exprimă această direcție folosind doar faptele licențiate.`;
  const voiceLines = [...ctx.voiceLines];
  const snapshot: LandingAuthorizationSnapshot = {
    snapshotId: genId(), businessId: ids.businessId, actionId: ids.actionId, createHandoffId: null,
    strategyVersionId: ctx.strategyVersionId, language: ctx.language, speakingRole: 'brand',
    audienceUseContext: ctx.audience, licensedPropositions, proofFacts: [...ctx.proofFacts],
    ctaFunction: ctx.ctaDirection, ownedStances: [...ctx.founderOwned], safetyContractHash: null, producedAt: now(),
    communicationJob, voiceLines, // persisted so a single-section rewrite can re-gate without the provider
  };
  return { status: 'ready', snapshot, communicationJob, voiceLines };
}
