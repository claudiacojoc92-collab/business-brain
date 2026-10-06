import type { AtomClass } from '../atoms/contracts';

/**
 * The safety decision stored on every MoveDraft — drafted OR blocked — so the outcome is QUERYABLE, not just
 * logged. With no alerting in the product, a guard that silently blocks most drafts would be invisible; this
 * row makes the drafted/blocked ratio and the failing layer answerable with a query over plan_move_draft.
 */
export interface MoveSafetyDecision {
  readonly layersRun: readonly ('medical' | 'kernel' | 'backstop' | 'people_fidelity' | 'judge')[];
  readonly failingLayer: 'medical' | 'kernel' | 'backstop' | 'people_fidelity' | 'judge' | null; // null ⇒ passed every layer
  readonly failures: readonly { section: string; layer: string; rule: string }[];
  readonly repairAttempts: number;
  readonly disposition: 'drafted' | 'blocked';
}

/**
 * MoveDraft — a produced artifact that arrives ATTACHED to a plan move, so a `leadsToCreate` move shows up
 * already done/drafted rather than assigned (the product thesis: production, not advice). Stored beside the
 * immutable move (its own table), never on the move. Landing-page copy is the first `kind`; message and
 * carousel moves reuse this same spine (snapshot + gate + storage + status), only their per-kind generator
 * and prose→SampleContent mapping differ. See intent/2026-10-05-landing-move.
 */
export type MoveDraftKind = 'landing'; // extensible: | 'message' | 'carousel' | 'reel'

// ── the landing-page draft content (kind: 'landing') ──
// 'how_it_works' is the home for operational POLICY rules (capacity, cancellation window, arrival/lead time,
// membership terms). Without it those atoms had nowhere to go and the generator dropped them.
export type LandingSectionRole = 'hero_headline' | 'hero_subhead' | 'what' | 'who' | 'proof' | 'how_it_works' | 'cta';
export interface LandingSection {
  readonly role: LandingSectionRole;
  readonly heading?: string;
  readonly body: string;
}
/** A structured landing page — a sequence of prose sections + one CTA. The structure is what makes a good
 *  page AND what lets the safety gate attribute a violation to a section (the carousel per-slide split). */
export interface LandingDraft {
  readonly sections: LandingSection[];
  readonly cta: string;
}

// ── the authorization snapshot (mirrors carousel's AssetAuthorizationSnapshot; keyed to the MOVE) ──
export type LandingPropositionSource = 'business_evidence' | 'founder_owned' | 'behavior_result' | 'strategy_decision';
/** `atomClass` (when present) is the anchored-atom class this proposition came from; it ROUTES the proposition
 *  to a section (service→what, people→proof, contact_booking→cta, policy→how-it-works). Absent ⇒ synthesized /
 *  founder prose, available to hero / subhead / who. Routing is a generation concern; the safety spec stays flat. */
export interface LandingProposition { readonly ref: string; readonly text: string; readonly source: LandingPropositionSource; readonly atomClass?: AtomClass }

/** Immutable record of exactly what BB was authorized to claim when this draft was produced — stored so a
 *  later audit replays from this, never from mutable strategy. */
export interface LandingAuthorizationSnapshot {
  readonly snapshotId: string;
  readonly businessId: string;
  readonly actionId: string;                 // the move this draft fulfils
  readonly createHandoffId: string | null;   // the create seam, when the draft came through one
  readonly strategyVersionId: string;
  readonly language: string;
  readonly speakingRole: string;
  readonly audienceUseContext: string;
  readonly licensedPropositions: LandingProposition[];
  readonly proofFacts: string[];             // documented, licensed proof
  readonly proofKinds?: string[];            // claim-KIND per proofFact (index-aligned)
  readonly ctaFunction: string;
  readonly ownedStances: string[];
  readonly safetyContractHash: string | null;
  readonly producedAt: string;
  // Persisted so a single section can be re-gated on rewrite without re-running the context provider (JSON on
  // the snapshot — no migration). The communication job + voice are what the generator/gate need beyond facts.
  readonly communicationJob?: string;
  readonly voiceLines?: string[];
}

export type MoveDraftStatus =
  | 'drafted'    // BB produced it and it passed the gate
  | 'edited'     // the founder changed a section (their words — not re-gated)
  | 'accepted'   // the founder accepted it; the move's produced artifact
  | 'blocked';   // the gate could not produce safe copy — fail-closed; the move shows its plain instruction

export interface MoveDraft {
  readonly moveDraftId: string;
  readonly businessId: string;
  readonly actionId: string;
  readonly planVersionId: string;
  readonly kind: MoveDraftKind;
  readonly language: string;
  // null only when status === 'blocked' (fail-closed: nothing unsafe is ever stored as a shown draft).
  // Becomes a per-kind union when a second kind lands; landing-only today.
  readonly draft: LandingDraft | null;
  readonly snapshot: LandingAuthorizationSnapshot;
  readonly safetyDecision: MoveSafetyDecision;
  readonly status: MoveDraftStatus;
  readonly version: number;                  // append-only; an edit or regeneration writes a new version row
  readonly producedAt: string;
}

/** Append-only persistence — a new version is a new row; the latest wins. */
export interface IMoveDraftRepository {
  save(draft: MoveDraft): Promise<void>;
  latestForAction(businessId: string, actionId: string): Promise<MoveDraft | null>;
  get(businessId: string, moveDraftId: string): Promise<MoveDraft | null>;
}

// ── the landing prose generator port (model adapter implemented in infrastructure) ──
export interface LandingGenInput {
  readonly snapshot: LandingAuthorizationSnapshot;
  readonly communicationJob: string;
  readonly voiceLines: string[];   // accepted voice examples — HOW to say it, never new WHAT
  readonly language: string;       // 'ro' | 'en' (guard-enabled only; 'it' is disabled)
}
/** A repair is TARGETED: the model is told exactly which section failed and on what rule, never just "try again". */
export interface LandingRepairInput extends LandingGenInput {
  readonly previous: LandingDraft;
  readonly failures: readonly { section: string; rule: string }[];
}
/** A section rewrite regenerates ONE section (its facts, routed) and keeps the others verbatim. */
export interface LandingRewriteSectionInput extends LandingGenInput {
  readonly previous: LandingDraft;
  readonly role: LandingSectionRole;
}
export interface ILandingModelPort {
  draft(input: LandingGenInput): Promise<LandingDraft>;
  repair(input: LandingRepairInput): Promise<LandingDraft>;
  rewriteSection(input: LandingRewriteSectionInput): Promise<LandingDraft>;
}
