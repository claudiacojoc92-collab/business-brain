/**
 * Slice 6 — Carousel Asset Creation. Contracts.
 *
 * Turns a CreateHandoff (Slice 5) + Current Strategy + Evidence + Voice + brand + source material into a REAL
 * rendered image carousel (1080×1350 PNG per slide + ZIP) the founder can review, revise (scoped, non-
 * destructive), and export. Governance is REUSED from the frozen Voice/proposition system — the carousel
 * introduces no new claim authority. Content is immutable + versioned; slide/block/slot identities are stable;
 * every material revision mints a new AssetVersion. Media is Option A only (owned/uploaded/licensed) — no
 * generative imagery in this slice.
 */

// ── Source material + reuse rights (provenance ≠ media reuse right) ──
export type SourceType =
  | 'case_study' | 'founder_statement' | 'website' | 'strategy_proposition'
  | 'product_fact' | 'testimonial' | 'uploaded_image' | 'brand_asset';
/** owned/founder_uploaded/licensed may render as MEDIA; reference_only/unknown may inform claims only. */
export type ReuseRight = 'owned' | 'founder_uploaded' | 'licensed' | 'reference_only' | 'unknown';
export interface CarouselSourceRef {
  readonly sourceRefId: string;
  readonly sourceType: SourceType;
  readonly provenance: string;      // where it came from (founder-legible)
  readonly reuseRight: ReuseRight;
  readonly text?: string;           // for claim/proof sources
  readonly mediaRef?: string;       // blob key for image sources
}
export const canRenderAsMedia = (r: ReuseRight): boolean => r === 'owned' || r === 'founder_uploaded' || r === 'licensed';

// ── Slice 6.1 (additive) — a MEDIA PLAN the photo-led path may hand the frozen compose. It is ADVISORY over the
//    rights gate (canRenderAsMedia still disposes) and carries NO claims: it only proposes which founder image
//    fills which canonical media slot, by role. Under CanonicalCarouselTemplate v1 'detail' degrades to
//    'supporting' placement (v1 has no distinct detail slot). Absent ⇒ frozen Slice-6 media behavior. ──
export type MediaRole = 'hero' | 'supporting' | 'detail';
/** Literal normalized (0–1) image geometry — where a subject/face IS, never what it means (Slice 6.1). */
export interface NormBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly confidence?: number }
export interface MediaPlanItem { readonly sourceRefId: string; readonly role: MediaRole; readonly focalSubjectBox?: NormBox | null; readonly faceBoxes?: NormBox[] }

// ── Brand context — real constraints, or a BRAND-NEUTRAL restrained editorial default (never BB's identity) ──
export interface BrandConstraints {
  readonly logoRef?: string;
  readonly palette?: string[];       // hex; first = ink, rest optional
  readonly typePreference?: string;  // family name hint
  readonly imageryStyle?: string;
  readonly explicitDonts?: string[];
}
export interface BrandContext {
  readonly brandContextVersion: string;
  readonly mode: 'known' | 'restrained_default';
  readonly constraints?: BrandConstraints;
}

// ── Concept material-feasibility: a slide semantic beat may only exist if bound to authorized MEANING.
//    Strategy decisions are framing, NEVER a public-claim meaning unit (analog of Slice-5 action→trace). ──
export type MeaningUnitType = 'proof' | 'business_fact' | 'founder_insight' | 'audience_context' | 'cta_function';
export interface MeaningUnit { readonly type: MeaningUnitType; readonly ref: string; readonly text: string }
export interface FeasibilityResult {
  readonly feasible: boolean;
  readonly outline: SlideRole[];          // possibly CONTRACTED to the grounded beats (no orphan, no padding)
  readonly reasons: string[];             // why a beat was dropped / why infeasible
}

// ── Concept — strategy-derived communication structure (family is an internal HINT, never the quality basis) ──
// proof_statement = the smallest proof concept (documented result + context + CTA, NO decomposition of causes);
// the mandatory downgrade target when a decomposition concept (proof_breakdown/before_after/checklist/
// myth_correction) is chosen but the authorized material cannot support the breakdown it promises.
export type ConceptFamily = 'proof_breakdown' | 'proof_statement' | 'problem_reframe' | 'myth_correction' | 'before_after' | 'founder_insight' | 'checklist' | 'offer_explainer';
export type SlideRole = 'hook' | 'context' | 'proof' | 'insight' | 'step' | 'reframe' | 'cta';
export interface Concept {
  readonly conceptId: string;
  readonly rationale: string;               // founder-legible "why this shape"
  readonly communicationLogic: string;      // why this structure EXECUTES the strategy (quality basis)
  readonly slideOutline: SlideRole[];        // 3–8
  readonly materialFeasibility: string;     // which available material makes it renderable
  readonly internalFamily: ConceptFamily;   // internal hint only — NOT exposed to the founder
}

// ── Asset-level copy (ONE communication, not N independent slide messages) ──
export type TextBlockRole = 'headline' | 'body' | 'kicker' | 'caption' | 'cta';
export interface CopyBinding { readonly blockRef: string; readonly propositionRef: string | null; readonly sourceRefId: string | null; readonly ctaFunction: string | null }
export interface SlideCopy { readonly slideKey: string; readonly role: SlideRole; readonly headline?: string; readonly body?: string; readonly kicker?: string }
export interface CarouselCopyDraft {
  readonly communicationJob: string;
  readonly language: string;
  readonly hook: string;                    // slide-1 headline realization
  readonly orderedSlideCopy: SlideCopy[];
  readonly cta: string;
  readonly propositionBindings: CopyBinding[];  // block → licensed proposition / source / CTA function
}

// ── Structured, addressable slide composition (stable ids; index/order is NOT identity) ──
/** Bounded parametric renderer primitives (NOT content templates, NOT a founder-facing picker). */
export type LayoutFamily =
  | 'hero_hook' | 'editorial_text' | 'statement' | 'proof_stat'
  | 'split_media' | 'photo_led' | 'structured_list' | 'contrast_reframe' | 'cta_close';
/** Generic composition parameters the deterministic renderer reads (a family resolves to these). */
export type TextAnchor = 'top' | 'center' | 'bottom';
export type TextAlign = 'left' | 'center';
export type Emphasis = 'headline' | 'display' | 'stat';
export type MediaMode = 'none' | 'top' | 'split' | 'full_bleed' | 'framed' | 'inset' | 'background' | 'overlay';
export type SlideSurface = 'default' | 'filled' | 'panel';
export interface LayoutParams {
  anchor: TextAnchor; align: TextAlign; emphasis: Emphasis; mediaMode: MediaMode;
  density: 'airy' | 'medium' | 'dense';
  surface: SlideSurface;          // default ground / accent-or-ink fill / a tinted panel
  accentBar: boolean;             // a graphic rule/bar as a hierarchy marker
  bgStyle: BgStyle;               // the bounded background graphic move for this slide
  shape?: 'none' | 'rule' | 'pill';
}
export interface TextBlock {
  readonly blockId: string;                 // stable across surviving revisions
  readonly role: TextBlockRole;
  readonly text: string;
  readonly authorizedFrom: { propositionRef: string | null; sourceRefId: string | null; ctaFunction: string | null };
  readonly locked: boolean;
}
export interface MediaSlot {
  readonly slotId: string;
  readonly kind: 'image' | 'none';
  readonly sourceRefId: string | null;      // must be a canRenderAsMedia source when kind==='image'
  readonly fit: 'cover' | 'contain';
  readonly locked: boolean;
  // Slice 6.1 (additive): literal image geometry driving the deterministic legibility/placement layer. Absent on
  // the frozen plan path (graphic focal) ⇒ canonical R1 placement ⇒ byte-identical render.
  readonly placement?: { readonly focalSubjectBox?: NormBox | null; readonly faceBoxes?: NormBox[] };
}
export interface Slide {
  readonly slideId: string;                 // STABLE identity
  readonly order: number;
  readonly semanticRole: SlideRole;
  readonly textBlocks: TextBlock[];
  readonly mediaSlots: MediaSlot[];
  readonly layoutFamily: LayoutFamily;
  readonly layoutParams: Record<string, string | number>;
  readonly lockedFields: string[];          // e.g. "block:<id>", "slot:<id>", "slide" (whole)
  readonly sourceRefIds: string[];
}

// ── Immutable authorization snapshot for THIS asset-generation decision (reuses frozen typed semantics) ──
export interface CarouselProposition { readonly ref: string; readonly text: string; readonly source: 'business_evidence' | 'founder_owned' | 'behavior_result' | 'strategy_decision' }
export interface AssetAuthorizationSnapshot {
  readonly snapshotId: string;
  readonly businessId: string;
  readonly createHandoffId: string;
  readonly strategyVersionId: string;
  readonly language: string;
  readonly speakingRole: string;
  readonly audienceUseContext: string;
  readonly licensedPropositions: CarouselProposition[];
  readonly proofFacts: string[];            // documented, licensed proof (e.g. a case-study result)
  readonly ctaFunction: string;
  readonly ownedStances: string[];          // founder/brand owned stances
  readonly sourceRefs: CarouselSourceRef[];
  readonly modelId: string | null;
  readonly safetyContractHash: string | null;
  readonly producedAt: string;
}

// ── AssetDesignDirection: the ONE coherent design governing an AssetVersion — derived from BrandContext +
//    concept + job + available media + density. It expresses REAL graphic composition (palette, typography
//    hierarchy, shape language, image treatment, graphic emphasis), not just a color swap. Known brand →
//    real constraints; else a genuinely-designed brand-neutral fallback (NOT cream + top-left text, NOT BB
//    identity). Two materially different brands must NOT get the same template recolored. (Type kept named
//    VisualSystem for continuity; AssetDesignDirection is the alias used in the design layer.) ──
export interface TypeScale { readonly display: number; readonly headline: number; readonly body: number; readonly kicker: number; readonly cta: number }
export type ShapeLanguage = 'none' | 'rules' | 'panels';
export type GraphicEmphasis = 'restrained' | 'bold' | 'statement';
export type ImageTreatment = 'full_bleed' | 'split' | 'framed' | 'inset' | 'background' | 'overlay' | 'top';
export type HeadWeight = '600' | '700';
export type SurfaceMode = 'default' | 'filled' | 'panel';
/** How the asset uses the palette across the canvas. BB chooses (no founder picker). */
export type CompositionStyle = 'single_surface' | 'multi_surface' | 'typographic_minimal' | 'photo_led' | 'structured_graphic' | 'high_contrast_statement' | 'monochrome';
/** Semantic color roles — coordinated surfaces derived from the brand palette (or tonal variants of it). */
export interface ColorRoles {
  readonly base: string; readonly ink: string; readonly muted: string;
  readonly secondary: string;    // a coordinated second surface
  readonly contrast: string;     // a strong opposite surface (statement/CTA)
  readonly accent: string | null;
  readonly panel: string;        // content-panel tint
  readonly onSecondary: string; readonly onContrast: string; readonly onAccent: string;
}
/** A bounded, deterministic background graphic move for a slide (never a freeform canvas). */
export type BgStyle = 'solid' | 'split_h' | 'block_side' | 'arc' | 'frame' | 'contrast' | 'blocks' | 'panel';
export interface VisualSystem {
  readonly visualSystemRef: string;
  readonly mode: 'brand' | 'restrained_default';
  readonly bg: string; readonly ink: string; readonly muted: string; readonly accent: string | null;
  readonly panel: string;                       // surface color for panels/blocks (derived, never a fake brand hue)
  readonly onAccent?: string;                   // text color on an accent/ink fill
  readonly colorRoles: ColorRoles;              // coordinated semantic surfaces (brand-derived tonal variants)
  readonly compositionStyle: CompositionStyle;  // retained; MVP resolves to the single frozen base system
  readonly compositionVariant: 'a' | 'b';       // a materially different composition WITHIN the base family (visual-only)
  readonly irregular: boolean;                   // controlled deterministic imperfection (placed-by-eye, not mechanical)
  readonly headFamily: string; readonly bodyFamily: string;
  readonly typeScale: TypeScale;
  readonly headWeight: HeadWeight;
  readonly headCase: 'none' | 'upper';
  readonly tracking: number;                    // headline letter-spacing (em)
  readonly spacingUnit: number;
  readonly alignmentTendency: TextAlign;
  readonly mediaTreatment: 'rounded' | 'square';
  readonly radius: number;                       // shape/border radius
  readonly shapeTreatment: 'none' | 'rule' | 'pill';
  readonly shapeLanguage: ShapeLanguage;         // graphic treatment (hairline rules / filled panels / none)
  readonly graphicEmphasis: GraphicEmphasis;
  readonly imageTreatment: ImageTreatment;       // default treatment for eligible client media
  readonly emphasis: 'restrained' | 'bold';
  readonly pageIndex: boolean;                   // show a small "01 — 04" sequence marker
  readonly footer: string | null;                // a small consistent footer label (e.g. brand handle)
  readonly logoRef: string | null;               // eligible logo media ref (corner treatment)
  readonly donts: string[];                      // explicit visual don'ts
  readonly compatibleFamilies: LayoutFamily[];
}
/** The first-class asset-level design direction (an enriched, brand-aware VisualSystem). */
export type AssetDesignDirection = VisualSystem;

// ── Brief (enriched CreateHandoff, still fully traceable) ──
export interface CarouselBrief {
  readonly createHandoffId: string;
  readonly planVersionId: string;
  readonly strategyVersionId: string;
  readonly founderGoalTrace: string;
  readonly strategicBetTrace: string;
  readonly communicationJob: string;
  readonly audienceUseContext: string;
  readonly ctaDirection: string;
  readonly channel: string;
  readonly requestedAssetFormat: string;    // resolved (see channel/format resolution)
  readonly language: string;
}

// ── Render + gates ──
export interface CanvasSpec { readonly width: number; readonly height: number; readonly margin: number; readonly minFontPx: number }
export interface SlideImage { readonly slideId: string; readonly order: number; readonly blobKey: string; readonly widthPx: number; readonly heightPx: number }
export type GateSeverity = 'blocking' | 'advisory';
export interface GateFinding { readonly code: string; readonly severity: GateSeverity; readonly slideId: string | null; readonly detail: string }
export interface GateReport { readonly valid: boolean; readonly findings: GateFinding[] }
export interface RenderVersion {
  readonly renderId: string;
  readonly versionId: string;
  readonly rendererVersion: string;         // pinned renderer+font build id
  readonly canvasSpec: CanvasSpec;
  readonly slideImages: SlideImage[];
  readonly exportZipKey: string | null;
  readonly gateReport: GateReport;
  readonly producedAt: string;
}

// ── Immutable asset content + mutable pointer + append-only revision events ──
export interface CarouselAssetVersion {
  readonly versionId: string;
  readonly assetId: string;
  readonly versionNumber: number;
  readonly businessId: string;
  readonly brief: CarouselBrief;
  readonly concept: Concept;
  readonly slides: Slide[];
  readonly visualSystem: VisualSystem;
  readonly brandContextVersion: string;
  readonly languageContext: string;
  readonly authorizationSnapshotId: string;
  readonly sourceManifest: CarouselSourceRef[];
  readonly contentHash: string;
  readonly producedAt: string;
}
export interface CarouselAsset {
  readonly assetId: string;
  readonly businessId: string;
  readonly createHandoffId: string;
  readonly planVersionId: string;
  readonly strategyVersionId: string;
  readonly currentVersionId: string;
  readonly createdAt: string;
}
// ── Immutable claim-safety provenance (analogous to Voice SafetyDecision / Plan provenance) ──
/** The kernel-produced core of the safety decision (attribution + provenance hashes), before disposition. */
export interface CarouselSafetyTraceCore {
  readonly authorizationSnapshotId: string;
  readonly propositionContractHash: string;
  readonly judgeModelId: string | null;
  readonly judgePromptHash: string | null;
  readonly layer1Findings: { slideId: string; clause: string; propositionClass: string }[];
  readonly layer2Permitted: { slideId: string; clause: string; discourseCategory: string }[];
  readonly semanticBlockFindings: { slideId: string; clause: string; proposition: string }[];
  readonly fullAssetFindings: { clause: string; proposition: string }[];
}
export type CarouselSafetyDisposition = 'persisted' | 'repaired_persisted' | 'fail_closed';
export type GenerationMode = 'normal' | 'constrained_fallback';
/** The persisted, immutable per-attempt safety trace. version_id is null when the attempt failed closed. */
export interface CarouselSafetyTrace extends CarouselSafetyTraceCore {
  readonly traceId: string;
  readonly businessId: string;
  readonly assetId: string;
  readonly versionId: string | null;
  readonly attempt: number;
  readonly repairReasons: string[];
  readonly disposition: CarouselSafetyDisposition;
  readonly generationMode: GenerationMode;        // normal draft, or the constrained realization fallback
  readonly fallbackBindingsHash: string | null;   // hash of the fixed beat→meaning skeleton (fallback only)
  readonly targetedRepair: TargetedRepairTrace | null;  // the one bounded block-scoped repair phase, if any
  readonly producedAt: string;
}

export type RevisionScopeKind = 'copy_only' | 'slide' | 'visual_only' | 'cta' | 'source_swap' | 'concept';
export interface RevisionScope { readonly kind: RevisionScopeKind; readonly slideId?: string; readonly request: string }
export interface CarouselRevisionEvent {
  readonly id: string; readonly assetId: string; readonly fromVersionId: string; readonly toVersionId: string;
  readonly scope: RevisionScope; readonly at: string;
}

// ── Ports ──
export interface CarouselModelInput {
  readonly brief: CarouselBrief;
  readonly snapshot: AssetAuthorizationSnapshot;
  readonly voiceLines: string[];            // Voice projection (rhythm/register), not proposition authority
  readonly concept: Concept;
  readonly repairReasons?: string[];
  readonly priorDraft?: CarouselCopyDraft;
}
export interface AntiTemplateVerdict { readonly generic: boolean; readonly reason: string }
export interface ClosureVerdict { readonly closed: boolean; readonly reason: string }
/** Per-beat binding: the authorized meaning unit(s) a slide beat must faithfully realize (no orphan content).
 *  Extractive constrained mode requires the model to cite these refs per substantive block (§3). */
export interface BeatBinding { readonly role: SlideRole; readonly units: { readonly ref: string; readonly text: string; readonly type: MeaningUnitType }[] }
export interface ConstrainedRealizationInput {
  readonly brief: CarouselBrief;
  readonly snapshot: AssetAuthorizationSnapshot;
  readonly voiceLines: string[];
  readonly concept: Concept;
  readonly beats: BeatBinding[];         // fixed semantic skeleton (role → bound authorized meaning)
  readonly ctaFunction: string;
}
// ── Targeted constrained repair (§2–§8): ONE bounded, block-scoped repair after the constrained fallback fails
//    a LOCAL gate. Rewrite only the failing block(s); everything unaffected stays byte-identical. ──
export type TargetedRepairClass = 'safety' | 'overflow' | 'closure' | 'anti_template_filler';
/** A single block the repair must fix (located deterministically from the failing gate finding). */
export interface RepairTarget {
  readonly slideId: string; readonly blockId: string; readonly blockRole: TextBlockRole;
  readonly gateClass: TargetedRepairClass; readonly detail: string;
  readonly meaningUnitRefs: string[];          // the immutable bindings the rewrite MUST preserve
  readonly currentText: string;
}
export interface RepairedBlock { readonly slideId: string; readonly blockId: string; readonly newText: string }
export type AntiTemplateClass = 'A_unsupported_concept' | 'B_simple_not_defect' | 'C_substantive_filler';
export interface AntiTemplateClassification { readonly klass: AntiTemplateClass; readonly blockRef: string | null; readonly reason: string }
/** Immutable record of the one targeted-repair phase (extends the existing trace; no new audit system). */
export interface TargetedRepairTrace {
  readonly triggered: boolean;
  readonly repairs: { gateClass: TargetedRepairClass; slideId: string; blockId: string; beforeHash: string; afterHash: string; meaningUnitRefs: string[] }[];
  readonly result: 'persisted' | 'fail_closed' | 'not_repairable';
}

export interface ICarouselModelPort {
  chooseConcept(input: { brief: CarouselBrief; snapshot: AssetAuthorizationSnapshot; repairReasons?: string[] }): Promise<Concept>;
  draftCopy(input: CarouselModelInput): Promise<CarouselCopyDraft>;
  /** Optional causal anti-template review (shared mechanic OK when strategy/material entails it). Mode-aware:
   * in constrained_fallback mode simplicity/closeness-to-material is NOT genericity (§6/§7). */
  reviewAntiTemplate?(input: { assetView: unknown; brief: CarouselBrief; mode?: GenerationMode }): Promise<AntiTemplateVerdict>;
  /** Optional communication-closure QUALITY judge (safe-but-unearned CTA fails): body → CTA function → closure. */
  reviewClosure?(input: { bodyBeats: string[]; cta: string; ctaFunction: string; offerMaterial: string[] }): Promise<ClosureVerdict>;
  /** Reliability fallback: realize the ALREADY-BOUND meaning faithfully (semantic skeleton fixed; Voice varies
   * only surface). NOT founder-visible, NOT the default. Runs the full safety stack afterward like any draft. */
  realizeConstrained?(input: ConstrainedRealizationInput): Promise<CarouselCopyDraft>;
  /** Targeted repair (§2–§8): rewrite ONLY the given failing blocks, preserving each block's meaningUnitRefs and
   * its actor/time/polarity/quantifier/modality; add no predicate. Returns one RepairedBlock per target it fixed. */
  repairConstrained?(input: { targets: RepairTarget[]; snapshot: AssetAuthorizationSnapshot; concept: Concept; brief: CarouselBrief; voiceLines: string[]; ctaFunction: string }): Promise<RepairedBlock[]>;
  /** Classify an anti-template failure BEFORE any prose rewrite (§7): unsupported concept (A) / simple-but-fine
   * in constrained mode (B) / genuine substantive filler in one block (C, with blockRef). */
  classifyAntiTemplate?(input: { assetView: unknown; brief: CarouselBrief }): Promise<AntiTemplateClassification>;
  descriptor?(): { modelId: string; copyContractHash: string };
}

export interface RenderComposition {
  readonly canvasSpec: CanvasSpec;
  readonly visualSystem: VisualSystem;
  readonly slides: Slide[];
  readonly media: Record<string, Buffer>;   // sourceRefId → image bytes (only canRenderAsMedia)
}
export interface RenderedSlide { readonly slideId: string; readonly order: number; readonly png: Buffer; readonly widthPx: number; readonly heightPx: number; readonly measure: SlideMeasure }
/** Deterministic measurement the structural gates consume (computed by the renderer, no guessing). */
export interface SlideMeasure { readonly overflow: boolean; readonly minFontPx: number; readonly withinMargins: boolean; readonly clipped: boolean; readonly minContrast: number; readonly missingGlyphs: boolean; readonly mediaPresent: boolean }
export interface IRenderPort {
  rendererVersion(): string;
  render(comp: RenderComposition): Promise<RenderedSlide[]>;
}

export interface IBlobStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  putZip(key: string, files: Array<{ name: string; bytes: Buffer }>): Promise<void>;
}

export interface ICarouselRepository {
  saveVersion(v: CarouselAssetVersion): Promise<void>;
  getVersion(businessId: string, versionId: string): Promise<CarouselAssetVersion | null>;
  saveAsset(a: CarouselAsset): Promise<void>;
  getAsset(businessId: string, assetId: string): Promise<CarouselAsset | null>;
  setCurrentVersion(assetId: string, versionId: string): Promise<void>;
  saveAuthorizationSnapshot(s: AssetAuthorizationSnapshot): Promise<void>;
  /** Load the immutable snapshot — the authority for revision/revalidation (never recompute from live strategy). */
  getAuthorizationSnapshot(businessId: string, snapshotId: string): Promise<AssetAuthorizationSnapshot | null>;
  saveRender(r: RenderVersion): Promise<void>;
  getRender(versionId: string): Promise<RenderVersion | null>;
  recordRevision(e: Omit<CarouselRevisionEvent, 'id'>): Promise<void>;
  getAssetByHandoff(businessId: string, createHandoffId: string): Promise<CarouselAsset | null>;
  /** Append-only immutable claim-safety trace (one row per generation/revision attempt). */
  saveSafetyTrace(t: CarouselSafetyTrace): Promise<void>;
  /** Founder media pool: eligible uploaded source material BB may choose from. */
  saveMedia(businessId: string, media: CarouselSourceRef & { filename?: string }): Promise<void>;
  listMedia(businessId: string): Promise<CarouselSourceRef[]>;
  /** Grounded per-business brand tokens (tint the FROZEN canonical geometry). Null → neutral fallback. */
  saveBrand(businessId: string, brand: BrandConstraints & { source: string }): Promise<void>;
  getBrand(businessId: string): Promise<BrandConstraints | null>;
}

// The strategy/evidence/brand context the carousel builder reads (projected, like PlanStrategyView).
export interface CarouselContextView {
  readonly strategyVersionId: string;
  readonly language: string;
  readonly goal: string;
  readonly coreBet: string;
  readonly audience: string;
  readonly ctaDirection: string;
  readonly licensedPropositions: CarouselProposition[];
  readonly proofFacts: string[];
  readonly ownedStances?: string[];        // founder/brand owned stances the copy may express
  readonly sourceRefs: CarouselSourceRef[];
  readonly brand: BrandContext;
  readonly voiceLines: string[];
  readonly speakingRole: string;
}
