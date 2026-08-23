/**
 * Slice 6.1 — Photo-Led Carousel Creation. Contracts.
 *
 * A SECOND create entry path (Create from Photos) that converges on the FROZEN Slice-6 carousel engine. It adds
 * NO claim authority: image observation produces MEDIA understanding (literal observed pixel facts), never new
 * business truth. Claim authority stays exclusively in the frozen AssetAuthorizationSnapshot. The photo-led path
 * emits the existing normal CreateHandoff PLUS an immutable PhotoLedCarouselContext (media + provenance only),
 * resolved additively by the carousel service. Everything downstream (concept/closure feasibility, generation,
 * safety, canonical render, versioning, export) is reused unchanged.
 */
import type { MediaRole, NormBox } from '../carousel/contracts';

// ── Media observation — LITERAL, closed vocabulary. Prefer observed/uncertain/unusable over numeric confidence
//    as authority. NO inferred fields (calories, macros, health, weight loss, emotion, intent, quality, result,
//    benefit, inferred audience) — those cannot exist in the schema. ──
export type ObservationVerdict = 'observed' | 'uncertain' | 'unusable';
export type ObservedSetting = 'gym' | 'kitchen' | 'restaurant' | 'outdoor' | 'studio' | 'office' | 'retail' | 'home' | 'event' | 'unknown';
export type ObservedSubject = 'prepared_dish' | 'ingredient_or_grocery' | 'person' | 'product' | 'document_or_screen' | 'scene' | 'text_graphic' | 'unknown';
export type MediaUsability = 'hero' | 'supporting' | 'detail' | 'unusable';
export type MediaOrientation = 'portrait' | 'landscape' | 'square';

export interface MediaObservation {
  readonly observationId: string;          // STABLE; referenced by selectedMedia.observationRefs
  readonly sourceRefId: string;            // the founder media in the carousel_media pool
  readonly verdict: ObservationVerdict;
  readonly setting: ObservedSetting;
  readonly subject: ObservedSubject;
  readonly objects: string[];              // literal observed nouns (e.g. "plate", "dumbbell") — no inference
  readonly activity: string | null;        // literal observed activity or null
  readonly containsText: boolean;
  readonly orientation: MediaOrientation;
  readonly hasClearSubject: boolean;
  readonly usability: MediaUsability;       // OBSERVED usefulness as media (candidacy), not business value
  // Literal image geometry (Slice 6.1): WHERE the primary subject / faces are (normalized 0–1). NOT a design
  // recommendation, importance, emotion, or meaning — the deterministic layout layer decides where text goes.
  readonly focalSubjectBox?: NormBox | null;
  readonly faceBoxes?: NormBox[];
}

export interface PhotoSetUnderstanding {
  readonly photoSetUnderstandingId: string;
  readonly businessId: string;
  readonly observations: MediaObservation[];
  readonly setSignal: string;              // literal observed distribution (e.g. "3 prepared_dish, 1 gym scene")
  readonly modelId: string | null;
  readonly contentHash: string;
  readonly producedAt: string;
}

// ── Opportunity — the ONE strategy-specific, non-transplantable recommendation ──
export type SufficiencyVerdict = 'sufficient' | 'sufficient_with_gap' | 'insufficient';
export interface MissingMaterial { readonly what: string; readonly whyItHelps: string }
export type PhotoLedOrigin = 'plan_action' | 'strategic_opportunity';
export interface SelectedMediaItem { readonly sourceRefId: string; readonly role: MediaRole; readonly observationRefs: string[] }
export interface ExcludedMediaItem { readonly sourceRefId: string; readonly reason: string }

export interface CarouselOpportunity {
  readonly opportunityId: string;
  readonly businessId: string;
  readonly photoSetUnderstandingId: string;
  readonly origin: PhotoLedOrigin;
  readonly strategyVersionId: string;
  readonly planVersionId: string | null;
  readonly actionId: string | null;
  readonly communicationJob: string;             // strategy-aligned proposed job (feeds the frozen handoff)
  readonly ctaDirection: string | null;
  readonly whyPhotosSupport: string;
  readonly strategicConnection: string;
  readonly nonTransplantabilityTrace: string;    // why this is specific to THIS creator + strategy
  readonly proposedConceptFamily: string;
  readonly usableMediaSubset: SelectedMediaItem[];
  readonly excludedMedia: ExcludedMediaItem[];
  readonly sufficiency: SufficiencyVerdict;
  readonly missingMaterial: MissingMaterial[];
  readonly founderLegibleRecommendation: string; // the card headline/body ("I found a strong angle: …")
  readonly alternativeAvailable: boolean;
  readonly modelId: string | null;
  readonly producedAt: string;
}

// ── PhotoLedCarouselContext — immutable, hashed, MEDIA + PROVENANCE ONLY. NEVER claims/captions/copy. ──
export interface PhotoLedCarouselContext {
  readonly photoLedContextId: string;
  readonly businessId: string;
  readonly createHandoffId: string;        // 1:1 UNIQUE
  readonly opportunityId: string;
  readonly photoSetUnderstandingId: string;
  readonly origin: PhotoLedOrigin;
  readonly strategyTrace: { readonly strategyVersionId: string; readonly planVersionId: string | null; readonly actionId: string | null };
  readonly selectedMedia: SelectedMediaItem[];
  readonly excludedMedia: ExcludedMediaItem[];
  readonly producedAt: string;
  readonly contentHash: string;
}

// ── Ports ──
/** Vision observation port — LITERAL media facts only, NO claim authority (its output cannot license a claim). */
export interface IObservationModelPort {
  observe(images: { sourceRefId: string; bytes: Buffer; mime?: string }[]): Promise<Omit<MediaObservation, 'observationId'>[]>;
  descriptor?(): { modelId: string };
}
export interface OpportunityModelInput {
  readonly photoSet: PhotoSetUnderstanding;
  readonly goal: string;
  readonly coreBet: string;
  readonly audience: string;
  readonly positioning: string;
  readonly ctaDirection: string | null;
  readonly businessName: string;
  readonly voiceLines: string[];
  readonly language: string;
  readonly avoid?: string;                  // for "show me another angle": the prior angle to differ from
}
export interface OpportunityDraft {
  readonly communicationJob: string;
  readonly ctaDirection: string | null;
  readonly whyPhotosSupport: string;
  readonly strategicConnection: string;
  readonly nonTransplantabilityTrace: string;
  readonly proposedConceptFamily: string;
  readonly founderLegibleRecommendation: string;
  readonly selectedMedia: SelectedMediaItem[];
  readonly excludedMedia: ExcludedMediaItem[];
  readonly missingMaterial: MissingMaterial[];
}
export interface IOpportunityModelPort {
  recommend(input: OpportunityModelInput): Promise<OpportunityDraft>;
  descriptor?(): { modelId: string };
}
export interface IPhotoLedRepository {
  savePhotoSetUnderstanding(x: PhotoSetUnderstanding): Promise<void>;
  getPhotoSetUnderstanding(businessId: string, id: string): Promise<PhotoSetUnderstanding | null>;
  saveOpportunity(x: CarouselOpportunity): Promise<void>;
  getOpportunity(businessId: string, id: string): Promise<CarouselOpportunity | null>;
  /** MUST enforce 1:1 on createHandoffId (unique). */
  savePhotoLedContext(x: PhotoLedCarouselContext): Promise<void>;
  getPhotoLedContextByHandoff(businessId: string, createHandoffId: string): Promise<PhotoLedCarouselContext | null>;
}
