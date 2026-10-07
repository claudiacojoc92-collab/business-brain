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
  readonly atoms: readonly { readonly value: string; readonly atomClass: AtomClass; readonly sourceUrl: string }[]; // anchored, classed, provenanced
  readonly synthesizedFacts: readonly string[];  // allowedBusinessFacts(understanding) — synthesized, general
  readonly founderOwned: readonly string[];       // active founder statements
  readonly proofFacts: readonly string[];
  readonly voiceLines: readonly string[];
  readonly regulatedGuard: boolean;   // opt-in medical/regulated-claim tier (default false; see composition's REGULATED_BUSINESS_IDS)
}

export interface LandingMoveIds { readonly businessId: string; readonly actionId: string; readonly planVersionId: string }

export type LandingMoveResult =
  | { readonly status: 'ready'; readonly snapshot: LandingAuthorizationSnapshot; readonly communicationJob: string; readonly voiceLines: string[] }
  | { readonly status: 'blocked'; readonly reason: 'no_adopted_strategy'; readonly message: string };

/** The legible reason a surface can show instead of an empty state — a silent empty state is the failure mode
 *  we have been hunting all day. */
export const NO_ADOPTED_STRATEGY_MESSAGE =
  'There is no adopted strategy yet. The page is built around the direction you adopt; until then there is nothing to write it on.';

export function assembleLandingMove(ctx: LandingContextView | null, ids: LandingMoveIds, now: () => string, genId: () => string): LandingMoveResult {
  // ADOPTION GATE — fail closed, legibly. Never draft without an adopted strategy.
  if (!ctx) return { status: 'blocked', reason: 'no_adopted_strategy', message: NO_ADOPTED_STRATEGY_MESSAGE };

  const licensedPropositions: LandingProposition[] = [
    ...ctx.atoms.map((a, i): LandingProposition => ({ ref: `A${i + 1}`, text: a.value, source: 'business_evidence', atomClass: a.atomClass, sourceUrl: a.sourceUrl })),
    ...ctx.synthesizedFacts.map((t, i): LandingProposition => ({ ref: `B${i + 1}`, text: t, source: 'business_evidence' })),
    ...ctx.founderOwned.map((t, i): LandingProposition => ({ ref: `F${i + 1}`, text: t, source: 'founder_owned' })),
  ];
  // STRATEGY CONDITIONING — the job is the adopted strategy's direction, not a generic studio landing.
  // An instruction to the model (not founder-facing): neutral English; the generator writes in snapshot.language.
  const communicationJob = `A landing page that serves the adopted strategy. Goal: ${ctx.goal}. Target reader: ${ctx.audience}. Express this direction using only the licensed facts.`;
  const voiceLines = [...ctx.voiceLines];
  const snapshot: LandingAuthorizationSnapshot = {
    snapshotId: genId(), businessId: ids.businessId, actionId: ids.actionId, createHandoffId: null,
    strategyVersionId: ctx.strategyVersionId, language: ctx.language, speakingRole: 'brand',
    audienceUseContext: ctx.audience, licensedPropositions, proofFacts: [...ctx.proofFacts],
    ctaFunction: ctx.ctaDirection, ownedStances: [...ctx.founderOwned], safetyContractHash: null, producedAt: now(),
    communicationJob, voiceLines, // persisted so a single-section rewrite can re-gate without the provider
    regulatedGuard: ctx.regulatedGuard, // opt-in — only flagged regulated businesses run the medical tier
  };
  return { status: 'ready', snapshot, communicationJob, voiceLines };
}
