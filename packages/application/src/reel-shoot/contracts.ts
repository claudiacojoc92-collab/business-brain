/**
 * Slice 7 — Vertical 2 ("Tell me what to film"). Contracts for the UPSTREAM shoot-planning layer.
 *
 * This layer decides WHAT reel to make and tells the founder exactly what to film, then — once real footage exists —
 * matches uploads to the plan and converges into the FROZEN Vertical-1 reel engine via a single optional `conceptSeed`.
 * It adds NO claim authority, NO timeline/EDL, NO renderer, NO rights system, NO second reel engine. Claim authority,
 * exact-range selection, editorial-fit, rights and safety all remain in frozen V1. Everything here is intent +
 * execution provenance. Nothing in Slice 6 / 6.1 or the frozen V1 reel contracts is modified.
 */
import type {
  SegmentRole, EditingEnergy, MotionIntensity, VideoSetUnderstanding, ClipObservation, ReelSourceRef,
  ConceptSeed, ConceptRoleHint, ReelSufficiency, ReelProposition, ReelContextView,
} from '../reel/contracts';

// ── ReelConcept — the immutable, FOOTAGE-FREE pre-production brief (design, not business truth). ──
export type ReelConceptOrigin = 'plan_action' | 'strategic_opportunity';
export interface ConceptBeat {
  readonly role: SegmentRole;                 // hook|build|proof|detail|close (shared with frozen V1)
  readonly job: string;                       // the narrative job of this beat (abstract, not clip-tied)
  readonly required: boolean;                 // load-bearing vs texture
}
export interface ReelConcept {
  readonly reelConceptId: string;
  readonly businessId: string;
  readonly origin: ReelConceptOrigin;
  readonly strategyVersionId: string;
  readonly planVersionId: string | null;
  readonly actionId: string | null;
  readonly communicationJob: string;          // the one job this reel does
  readonly strategicReason: string;           // why THIS, why NOW (founder-legible)
  readonly narrativeArc: string;              // beats as prose (hook→…→close)
  readonly beats: ConceptBeat[];              // structured beats (required/optional)
  readonly targetDurationMs: number;          // bounded to frozen V1 [MIN,MAX]
  readonly editingEnergy: EditingEnergy;      // treatment (reuses frozen enum); founder-invisible
  readonly authorizationBasis: ReelProposition[]; // the licensed propositions/proof the reel MAY rest on (mirror only)
  readonly speakingRole: string;
  readonly ctaDirection: string | null;       // only if earned
  readonly contentLanguage: string;           // BCP-47 (spoken/on-screen)
  readonly brandContextVersion: string;
  readonly sufficiencyAssumptions: string[];  // material the concept presumes is filmable
  readonly nonTransplantabilityTrace: string; // why this fits THIS business+strategy and no other
  readonly modelId: string | null;
  readonly producedAt: string;
  readonly contentHash: string;
}

// ── ShotRequest — a single bounded shot. Founder sees `founderProse`; the enums stay internal. ──
export type ShotFraming = 'wide' | 'medium' | 'close';
export type ShotCamera = 'static' | 'slow_move' | 'follow';
export type ShotAudioNeed = 'none' | 'ambient' | 'spoken_line';
export type ShotTextSafeSide = 'left' | 'right' | 'none';
export interface ShotRequest {
  readonly shotId: string;
  readonly sequenceRole: SegmentRole;         // shared beat vocabulary (feeds V1 roleHints)
  readonly storyJob: string;                  // what this shot must accomplish narratively (internal)
  readonly subject: string;                   // what to point at
  readonly visibleAction: string;             // what happens
  readonly framing: ShotFraming;
  readonly cameraBehavior: ShotCamera;
  readonly approxDurationMs: number;
  readonly orientation: 'vertical';
  readonly audioNeed: ShotAudioNeed;
  readonly exactSpokenLine: string | null;    // GOVERNED before filming (see spoken-line governance)
  readonly naturalVariationAllowed: boolean;  // may deliver naturally, but not a new claim
  readonly textSafeSide: ShotTextSafeSide;    // maps to frozen overlay safeRegion when useful
  readonly visualEnergyNeed: MotionIntensity | null; // from concept editingEnergy
  readonly required: boolean;                 // optional shots never block
  readonly founderFilms: boolean;             // true = the founder points a phone at something; false = an on-screen text card (no footage to match)
  readonly completionCriteria: string;        // the semantic bar an upload must clear (internal)
  readonly whyThisShot: string;               // founder-legible one-liner
  readonly alternativesAllowed: boolean;      // permits substitution
  readonly founderProse: string;              // the ONLY thing the founder sees (UI language)
  readonly matchTokens: string[];             // literal subject/action tokens for deterministic matching (internal)
}

// ── ShootingPlanVersion — immutable, append-only revision chain from ONE concept. ──
export interface ExecutionConstraint {
  readonly kind: 'no_talking_head' | 'no_clients' | 'location_only' | 'make_it_easier' | 'no_product_today' | 'other';
  readonly detail?: string;
}
export interface ShootingPlanVersion {
  readonly shootingPlanId: string;            // stable across versions
  readonly versionId: string;                 // this immutable version
  readonly versionNumber: number;
  readonly reelConceptId: string;
  readonly businessId: string;
  readonly supersedesVersionId: string | null;
  readonly shotRequests: ShotRequest[];       // ordered, usually 4–6
  readonly estimatedEffort: string;           // founder-legible ("about 3 minutes of filming")
  readonly generalGuidance: string[];         // 2–3 universal reminders (vertical, hold still, film the action)
  readonly constraintsApplied: ExecutionConstraint[];
  readonly uiLanguage: string;                // language of founderProse/effort/guidance
  readonly modelId: string | null;
  readonly producedAt: string;
  readonly contentHash: string;
}

// ── ShotFulfillment — the result of matching uploaded footage to a plan (immutable per plan-version × VSU). ──
export type ShotFulfillmentStatus = 'satisfied' | 'partial' | 'missing' | 'unusable';
export interface ShotFulfillment {
  readonly shotId: string;
  readonly status: ShotFulfillmentStatus;
  readonly matchedSourceRefId: string | null;
  readonly observationRef: string | null;
  readonly matchedRange: { readonly inMs: number; readonly outMs: number } | null; // a HINT window; V1 picks exact
  readonly matchReasons: string[];
  readonly missingReason: string | null;
  readonly substitutedFromShotId: string | null; // when a clip filmed for another shot serves this beat
  readonly producedAt: string;
}
export type ShootSufficiency = ReelSufficiency; // reuse: sufficient | sufficient_with_gap | insufficient
export interface FulfillmentReport {
  readonly shootingPlanVersionId: string;
  readonly videoSetUnderstandingId: string;
  readonly fulfillments: ShotFulfillment[];
  readonly sufficiency: ShootSufficiency;
  readonly smallestMissing: { readonly shotId: string; readonly founderAsk: string } | null; // the ONE thing to film
  readonly producedAt: string;
}

// ── ReelShootContext — the additive companion linking the plan lineage to the FROZEN V1 asset (no frozen change). ──
export interface ReelShootSubstitution { readonly shotId: string; readonly fromShotId: string; readonly sourceRefId: string }
export interface ReelShootContext {
  readonly reelShootContextId: string;
  readonly businessId: string;
  readonly reelConceptId: string;
  readonly shootingPlanVersionId: string;
  readonly videoSetUnderstandingId: string;
  readonly fulfillments: ShotFulfillment[];
  readonly substitutions: ReelShootSubstitution[];
  readonly conceptSeed: ConceptSeed;          // exactly what was handed to frozen recommend()
  readonly opportunityId: string;             // the frozen V1 opportunity produced from the seed
  readonly assetId: string;                   // the frozen V1 asset
  readonly producedAt: string;
}

// ── Ports ──
/** Strategy-conditioned "what to film next" model. Produces the concept + beats + shooting plan (founder prose). */
export interface ConceptPlanInput {
  readonly context: ReelContextView;          // reuse the frozen projected strategy/voice/brand context
  readonly businessName: string;
  readonly uiLanguage: string;                // founder prose language
  readonly editingEnergy: EditingEnergy;      // derived from strategy (or carried)
  readonly plan: { planVersionId: string; actionId: string | null } | null;
  readonly constraints?: ExecutionConstraint[]; // founder execution constraints to honor
  readonly avoidConcept?: string;             // "another angle" — steer away from the prior concept
}
export interface ConceptPlanDraft {
  readonly communicationJob: string;
  readonly strategicReason: string;
  readonly narrativeArc: string;
  readonly beats: ConceptBeat[];
  readonly targetDurationMs: number;
  readonly ctaDirection: string | null;
  readonly sufficiencyAssumptions: string[];
  readonly nonTransplantabilityTrace: string;
  readonly estimatedEffort: string;
  readonly generalGuidance: string[];
  readonly shots: Array<Omit<ShotRequest, 'shotId' | 'exactSpokenLine' | 'naturalVariationAllowed'> & { spokenLineIntent?: string | null }>;
}
export interface IConceptPlanModelPort {
  propose(input: ConceptPlanInput): Promise<ConceptPlanDraft>;
  descriptor?(): { modelId: string };
}

/** Repository for the V2 upstream objects (additive; never touches frozen reel_* tables). */
export interface IReelShootRepository {
  saveConcept(x: ReelConcept): Promise<void>;
  getConcept(businessId: string, id: string): Promise<ReelConcept | null>;
  savePlanVersion(x: ShootingPlanVersion): Promise<void>;
  getPlanVersion(businessId: string, versionId: string): Promise<ShootingPlanVersion | null>;
  getCurrentPlanVersion(businessId: string, shootingPlanId: string): Promise<ShootingPlanVersion | null>;
  saveFulfillmentReport(x: FulfillmentReport & { businessId: string }): Promise<void>;
  getFulfillmentReport(businessId: string, shootingPlanVersionId: string): Promise<FulfillmentReport | null>;
  saveShootContext(x: ReelShootContext): Promise<void>;
  getShootContextByAsset(businessId: string, assetId: string): Promise<ReelShootContext | null>;
  getShootContextByPlan(businessId: string, shootingPlanVersionId: string): Promise<ReelShootContext | null>;
}

export type { ConceptRoleHint, ConceptSeed, VideoSetUnderstanding, ClipObservation, ReelSourceRef };
