/**
 * Slice 7 — Reel Creation (Vertical 1: "Use my clips"). Contracts.
 *
 * A NEW additive create path that turns founder-owned phone CLIPS into a REAL 1080×1920 MP4. It adds NO claim
 * authority: video observation produces MEDIA understanding (literal observed facts), never business truth.
 * Claim authority stays in the frozen proposition-safety kernel, projected here from a reel-local
 * ReelAuthorizationSnapshot (mirrors the carousel AssetAuthorizationSnapshot pattern). Rights are REUSED from the
 * frozen carousel model. Nothing in Slice 6 / 6.1 is modified.
 */
import type { ReuseRight, NormBox } from '../carousel/contracts';
import { canRenderAsMedia } from '../carousel/contracts';


// ── Source clips + rights (reused: owned/founder_uploaded/licensed render; reference_only/unknown never) ──
export interface ReelSourceRef {
  readonly sourceRefId: string;
  readonly objectKey: string;                 // durable IObjectStore key (video bytes never in JSON)
  readonly reuseRight: ReuseRight;
  readonly filename?: string;
  readonly bytes?: number;
  readonly sha256?: string;
  readonly container?: string | null;         // OBSERVED (ffprobe), not the untrusted client MIME
  readonly audioRightsStatus?: 'owned' | 'licensed' | 'unknown';
}
/** A clip may render only when its reuse right permits it (frozen rights logic). */
export const canRenderClip = (r: ReuseRight): boolean => canRenderAsMedia(r);

// ── ClipObservation — LITERAL media facts only. NO emotion/health/nutrition/result/benefit/causality/intent. ──
export type ClipShot = 'talking_head' | 'b_roll';
export type ClipAudioKind = 'speech' | 'ambient' | 'music' | 'silence' | 'noisy';
export type ClipMotion = 'static' | 'slow' | 'shaky';
/** LITERAL visual energy of a clip — the observable amount/speed of subject motion, camera motion, and
 *  cut/action density. A bounded MEDIA fact (battle-ropes/sprint = high; walking/plating/talking = low/medium).
 *  It NEVER encodes emotion, aggression, motivation, audience reaction, or any psychological state. */
export type MotionIntensity = 'low' | 'medium' | 'high';
export type ClipOrientation = 'portrait' | 'landscape' | 'square';
export type ClipVerdict = 'observed' | 'uncertain' | 'unusable';
export interface UsableSpan { readonly startMs: number; readonly endMs: number; readonly reason: string }
export interface RejectedSpan { readonly startMs: number; readonly endMs: number; readonly reason: string }
export interface ClipObservation {
  readonly observationId: string;             // STABLE
  readonly sourceRefId: string;
  // deterministic (ffprobe)
  readonly durationMs: number;
  readonly width: number; readonly height: number;
  readonly orientation: ClipOrientation;
  readonly fps: number;
  readonly codec: string; readonly container: string;
  readonly rotationDegrees: number;
  readonly hasAudio: boolean;
  readonly audioCodec: string | null;
  // observed media facts (vision on sampled frames)
  readonly setting: string;                   // e.g. gym|kitchen|studio|event|unknown
  readonly subject: string;                   // observed subject noun
  readonly objects: string[];
  readonly activity: string | null;
  readonly shot: ClipShot;
  readonly shotScale: 'wide' | 'medium' | 'close' | 'unknown';
  readonly motion: ClipMotion;                // camera stability (static|slow|shaky)
  readonly motionIntensity: MotionIntensity;  // literal visual energy (low|medium|high) — see MotionIntensity; NO psychological inference
  readonly faceBoxes: NormBox[];
  readonly focalSubjectBox: NormBox | null;
  readonly usableSpans: UsableSpan[];
  readonly rejectedSpans: RejectedSpan[];
  readonly speechPresent: boolean;
  readonly audioKind: ClipAudioKind;
  readonly transcriptRef: string | null;      // → ClipTranscript.transcriptId, when transcribed
  readonly verdict: ClipVerdict;
}
export interface VideoSetUnderstanding {
  readonly videoSetUnderstandingId: string;
  readonly businessId: string;
  readonly uploadSetId: string;               // the upload set these clips belong to (source resolution)
  readonly observations: ClipObservation[];
  readonly setSignal: string;                 // literal observed distribution
  readonly modelId: string | null;
  readonly contentHash: string;
  readonly producedAt: string;
}

// ── Transcript — OBSERVED content, NOT claim authority. speech → transcript → safety disposition. ──
export type TranscriptStatus = 'transcribed' | 'uncertain_language' | 'unsupported_language' | 'no_intelligible_speech' | 'unavailable';
export interface TranscriptSegment {
  readonly startMs: number; readonly endMs: number;
  readonly text: string;
  readonly spokenLanguage: string;            // BCP-47 (per segment)
  readonly confidence?: number;
  readonly uncertain?: boolean;
}
export interface ClipTranscript {
  readonly transcriptId: string;
  readonly sourceRefId: string;
  readonly detectedLanguage: string;          // BCP-47
  readonly languageConfidence?: number;
  readonly segments: TranscriptSegment[];
  readonly status: TranscriptStatus;
  readonly providerId: string | null;
  readonly modelId: string | null;
}
/** Disposition of a spoken claim BB might amplify (hook/subtitle/spine). Using a clip ≠ broadcasting its claim. */
export type SpokenClaimDisposition = 'authorized_may_feature' | 'incidental_use_muted' | 'load_bearing_blocked' | 'no_substantive_claim';

// ── Exact-range selection (the creative-editor cut) ──
export type SegmentRole = 'hook' | 'build' | 'proof' | 'detail' | 'close';
export type AudioUse = 'original' | 'muted' | 'ducked';
export interface SelectedClipRange {
  readonly sourceRefId: string;
  readonly observationRef: string;            // → ClipObservation.observationId
  readonly inMs: number; readonly outMs: number;
  readonly role: SegmentRole;
  readonly audioUse: AudioUse;
}
export interface ExcludedClip { readonly sourceRefId: string; readonly reason: string }

// ── Four INDEPENDENT language axes (BCP-47; NO language enums) ──
export interface ReelLanguageConfig {
  readonly uiLanguage: string;
  readonly contentLanguage: string;           // hook/on-screen/CTA language
  readonly captionLanguage: string | null;    // subtitle language (V1: usually null — captions not load-bearing)
}

// ── ReelOpportunity — ONE strategy-specific, non-transplantable recommendation ──
export type ReelOrigin = 'plan_action' | 'strategic_opportunity';
export type ReelSufficiency = 'sufficient' | 'sufficient_with_gap' | 'insufficient';
/** Execution treatment intent derived from strategy + concept (NOT business truth, NOT observed media). It says how
 *  the reel should FEEL to edit — calm vs energetic — so the visual energy of the opener matches the message.
 *  Founder-invisible; never exposed in any founder-facing view. */
export type EditingEnergy = 'calm' | 'balanced' | 'energetic';
export interface MissingShot { readonly what: string; readonly whyItHelps: string }
export interface ReelOpportunity {
  readonly opportunityId: string;
  readonly businessId: string;
  readonly videoSetUnderstandingId: string;
  readonly origin: ReelOrigin;
  readonly strategyVersionId: string;
  readonly planVersionId: string | null;
  readonly actionId: string | null;
  readonly communicationJob: string;
  readonly narrativeArc: string;              // hook→build→payoff→close (beats, not copy)
  readonly ctaDirection: string | null;
  readonly whyFootageSupports: string;
  readonly strategicConnection: string;
  readonly nonTransplantabilityTrace: string;
  readonly selectedRanges: SelectedClipRange[];
  readonly excludedClips: ExcludedClip[];
  readonly targetDurationMs: number;
  readonly sufficiency: ReelSufficiency;
  readonly missingMaterial: MissingShot[];
  readonly founderLegibleRecommendation: string;
  readonly alternativeAvailable: boolean;
  readonly language: string;                  // contentLanguage
  readonly editingEnergy: EditingEnergy;      // treatment intent (founder-invisible) — matched against clip visual energy
  readonly proposedHook: string;              // candidate on-screen hook copy (GOVERNED at accept, not before)
  readonly proposedCta: string | null;        // candidate CTA copy (governed at accept)
  readonly modelId: string | null;
  readonly producedAt: string;
}

// ── Governed on-screen copy ──
export interface ReelTextBlock {
  readonly blockId: string;
  readonly role: 'hook' | 'overlay' | 'cta';
  readonly text: string;
  readonly language: string;                  // BCP-47
  readonly authorizedFrom: { propositionRef: string | null; sourceRefId: string | null; ctaFunction: string | null };
}

// ── Immutable timeline / EDL (V1: hard cuts, 1080×1920, 30fps) ──
export type Transition = 'cut';
export interface CropBox { readonly x: number; readonly y: number; readonly w: number; readonly h: number } // normalized within the source frame
export interface TextOverlay { readonly blockId: string; readonly startMs: number; readonly endMs: number; readonly safeRegion: 'bottom' | 'top' }
export interface TimelineSegment {
  readonly segmentId: string;                 // STABLE
  readonly order: number;
  readonly sourceRefId: string;
  readonly inMs: number; readonly outMs: number;
  readonly role: SegmentRole;
  readonly reframe: CropBox | null;           // null ⇒ deterministic center-crop to 9:16
  readonly audioUse: AudioUse;
  readonly transitionIn: Transition;
  readonly overlays: TextOverlay[];
  readonly locked: boolean;
}
export interface ReelTimeline {
  readonly canvas: { readonly width: number; readonly height: number; readonly fps: number };
  readonly segments: TimelineSegment[];
  readonly totalDurationMs: number;
}

// ── Reel-local authorization snapshot (projected into the FROZEN AuthorizedMessageSpec) ──
export type ReelPropositionSource = 'business_evidence' | 'founder_owned' | 'behavior_result' | 'strategy_decision';
export interface ReelProposition { readonly ref: string; readonly text: string; readonly source: ReelPropositionSource }
export interface ReelAuthorizationSnapshot {
  readonly snapshotId: string;
  readonly businessId: string;
  readonly createHandoffId: string | null;
  readonly strategyVersionId: string;
  readonly language: string;
  readonly speakingRole: string;
  readonly audienceUseContext: string;
  readonly licensedPropositions: ReelProposition[];
  readonly proofFacts: string[];
  readonly ctaFunction: string;
  readonly ownedStances: string[];
  readonly sourceRefIds: string[];
  readonly modelId: string | null;
  readonly safetyContractHash: string | null;
  readonly producedAt: string;
}

// ── Immutable asset + version + render + lineage ──
export interface ReelAssetVersion {
  readonly versionId: string;
  readonly assetId: string;
  readonly versionNumber: number;
  readonly businessId: string;
  readonly opportunityId: string;
  readonly videoSetUnderstandingId: string;
  readonly authorizationSnapshotId: string;
  readonly strategyVersionId: string;
  readonly planVersionId: string | null;
  readonly createHandoffId: string | null;
  readonly language: ReelLanguageConfig;
  readonly voiceContextHash: string | null;
  readonly brandContextVersion: string;
  readonly timeline: ReelTimeline;
  readonly textBlocks: ReelTextBlock[];
  readonly sourceManifest: ReelSourceRef[];
  readonly transcriptRefs: string[];          // transcript ids that governed/were used
  readonly edlHash: string;                   // DETERMINISTIC lineage anchor (NOT MP4 byte-equality)
  readonly contentHash: string;
  readonly producedAt: string;
}
export interface ReelAsset {
  readonly assetId: string;
  readonly businessId: string;
  readonly createHandoffId: string | null;
  readonly strategyVersionId: string;
  readonly currentVersionId: string;
  readonly createdAt: string;
}
export interface ReelRenderVersion {
  readonly renderId: string;
  readonly versionId: string;
  readonly rendererVersion: string;           // ffmpeg build + skia + edl
  readonly ffmpegBuild: string;
  readonly edlHash: string;
  readonly renderParams: Record<string, string | number>;
  readonly mp4Key: string;
  readonly posterKey: string;
  readonly widthPx: number; readonly heightPx: number; readonly durationMs: number;
  readonly gateValid: boolean;
  readonly producedAt: string;
}

// ── Async job (BullMQ-backed) ──
export type ReelJobStage =
  | 'uploaded' | 'probing' | 'observing' | 'transcribing' | 'understanding_ready'
  | 'opportunity_ready' | 'render_queued' | 'rendering' | 'ready' | 'failed' | 'canceled';
export interface ReelJob {
  readonly jobId: string;
  readonly businessId: string;
  readonly uploadSetId: string;
  readonly stage: ReelJobStage;
  readonly assetId: string | null;
  readonly videoSetUnderstandingId: string | null;
  readonly opportunityId: string | null;
  readonly failureReason: string | null;
  readonly updatedAt: string;
}

// ── Immutable safety trace (append-only; mirrors carousel) ──
export type ReelSafetyDisposition = 'persisted' | 'fail_closed';
export interface ReelSpokenClaimTrace { readonly sourceRefId: string; readonly clause: string; readonly disposition: SpokenClaimDisposition }
export interface ReelSafetyTrace {
  readonly traceId: string;
  readonly businessId: string;
  readonly assetId: string;
  readonly versionId: string | null;
  readonly authorizationSnapshotId: string;
  readonly propositionContractHash: string | null;
  readonly copyFindings: { blockId: string; clause: string }[];
  readonly spokenClaimTraces: ReelSpokenClaimTrace[];
  readonly disposition: ReelSafetyDisposition;
  readonly producedAt: string;
}

// ── The context the reel builder reads (projected, like CarouselContextView) ──
export interface ReelContextView {
  readonly strategyVersionId: string;
  readonly language: string;
  readonly goal: string;
  readonly coreBet: string;
  readonly audience: string;
  readonly positioning: string;
  readonly ctaDirection: string;
  readonly licensedPropositions: ReelProposition[];
  readonly proofFacts: string[];
  readonly ownedStances: string[];
  readonly sourceRefs: ReelSourceRef[];        // eligible uploaded clips
  readonly voiceLines: string[];
  readonly speakingRole: string;
  readonly brandContextVersion: string;
}

// ══════════════════════════ PORTS ══════════════════════════

/** Object storage for large video bytes (presigned direct upload in prod). Additive; NOT the carousel IBlobStore. */
export interface PresignedUpload { readonly url: string; readonly method: 'PUT'; readonly objectKey: string; readonly headers?: Record<string, string> }
export interface IObjectStore {
  presignPut(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload>;
  head(key: string): Promise<{ exists: boolean; bytes?: number } | null>;
  getStream(key: string): Promise<NodeJS.ReadableStream | null>;
  getToFile(key: string, destPath: string): Promise<boolean>;
  getToBuffer(key: string): Promise<Buffer | null>;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;   // dev / server-side writes (posters, small)
  delete(key: string): Promise<void>;
}

/** ffprobe metadata (deterministic). */
export interface ProbeResult {
  readonly durationMs: number; readonly width: number; readonly height: number;
  readonly fps: number; readonly codec: string; readonly container: string;
  readonly rotationDegrees: number; readonly hasAudio: boolean; readonly audioCodec: string | null;
}
export interface SampledFrame { readonly atMs: number; readonly png: Buffer }

/** Video render port — normalize-then-compose to a REAL MP4 + poster. Deterministic filtergraph; NO byte-equality. */
export interface ReelRenderInput {
  readonly timeline: ReelTimeline;
  readonly textBlocks: ReelTextBlock[];
  readonly sourceFiles: Record<string, string>;   // sourceRefId → local file path (downloaded from object store)
}
export interface ReelRenderOutput {
  readonly mp4: Buffer; readonly poster: Buffer;
  readonly widthPx: number; readonly heightPx: number; readonly durationMs: number;
  readonly edlHash: string; readonly ffmpegBuild: string; readonly rendererVersion: string;
  readonly renderParams: Record<string, string | number>;
}
export interface IReelRenderPort {
  rendererVersion(): string;
  ffmpegBuild(): Promise<string>;
  probe(filePath: string): Promise<ProbeResult>;
  sampleFrames(filePath: string, atMsList: number[]): Promise<SampledFrame[]>;
  render(input: ReelRenderInput): Promise<ReelRenderOutput>;
}

/** Video observation model — LITERAL media facts (no claim authority). */
export interface VideoObservationInput { readonly sourceRefId: string; readonly probe: ProbeResult; readonly frames: SampledFrame[] }
export interface IVideoObservationModelPort {
  observe(clips: VideoObservationInput[]): Promise<Omit<ClipObservation, 'observationId' | 'transcriptRef'>[]>;
  descriptor?(): { modelId: string };
}

// ── conceptSeed (Slice 7 V2 "Tell me what to film") — the ONE sanctioned optional seam into frozen V1. ──
// INTENT + EXECUTION PROVENANCE ONLY. It may guide WHICH concept V1 realizes; it may NEVER assert WHAT is true.
// It carries NO licensed propositions, proof, claims, safety decisions, authorization, or fixed EDL ranges — claim
// authority stays entirely in the frozen authorization/safety path. roleHints are GUIDANCE (candidate clip + a
// usable window per beat); V1 still decides exact in/out, the strongest subset, exclusions, ordering, editorial-fit,
// rights, safety, sufficiency, and the final timeline. Absent ⇒ frozen "Use my clips" behavior is unchanged.
export interface ConceptRoleHint {
  readonly sequenceRole: SegmentRole;
  readonly sourceRefId: string;                 // a matched clip for this beat (guidance, not a lock)
  readonly usableWindow?: { readonly inMs: number; readonly outMs: number };  // a hint window; V1 picks the exact range
}
export interface ConceptSeed {
  readonly communicationJob: string;            // the agreed angle (intent) — the reel the founder filmed for
  readonly narrativeArc: string;                // beat intent (hook→…→close), not clip-tied
  readonly editingEnergy: EditingEnergy;        // the concept's treatment (drives the frozen editorial-fit gate)
  readonly targetDurationMs: number;            // proposed length (still bounded/never padded by V1)
  readonly ctaDirection?: string | null;        // only if earned by strategy
  readonly roleHints?: ConceptRoleHint[];       // per-beat candidate clip + usable window (guidance only)
}

/** Reel opportunity model — strategy-conditioned creative-director recommendation + exact ranges. */
export interface ReelOpportunityInput {
  readonly videoSet: VideoSetUnderstanding;
  readonly goal: string; readonly coreBet: string; readonly audience: string; readonly positioning: string;
  readonly ctaDirection: string | null; readonly businessName: string; readonly voiceLines: string[]; readonly language: string;
  readonly avoid?: string;
  readonly editingEnergy?: EditingEnergy;     // treatment intent for this strategy — the opener's visual energy must match it
  readonly conceptSeed?: ConceptSeed;         // V2 seam — realize THIS agreed concept using these clips (intent only)
}
export interface ReelOpportunityDraft {
  readonly communicationJob: string; readonly narrativeArc: string; readonly ctaDirection: string | null;
  readonly whyFootageSupports: string; readonly strategicConnection: string; readonly nonTransplantabilityTrace: string;
  readonly selectedRanges: SelectedClipRange[]; readonly excludedClips: ExcludedClip[];
  readonly targetDurationMs: number; readonly missingMaterial: MissingShot[]; readonly founderLegibleRecommendation: string;
  readonly hookText: string; readonly ctaText: string | null;
}
export interface IReelOpportunityModelPort {
  recommend(input: ReelOpportunityInput): Promise<ReelOpportunityDraft>;
  descriptor?(): { modelId: string };
}

/** Transcription — provider-agnostic, capability-driven, broad-multilingual. */
export interface TranscriptionInput { readonly sourceRefId: string; readonly audioPath: string; readonly hintLanguage?: string }
export interface ITranscriptionPort {
  capabilities(): { languages: string[] | 'auto'; wordTimestamps: boolean; confidence: boolean };
  supports(languageTag: string): 'yes' | 'no' | 'unknown';
  transcribe(input: TranscriptionInput): Promise<ClipTranscript>;
  descriptor(): { providerId: string; modelId: string };
}

export interface IReelRepository {
  saveVideoSetUnderstanding(x: VideoSetUnderstanding): Promise<void>;
  getVideoSetUnderstanding(businessId: string, id: string): Promise<VideoSetUnderstanding | null>;
  saveTranscript(x: ClipTranscript): Promise<void>;
  getTranscript(id: string): Promise<ClipTranscript | null>;
  saveOpportunity(x: ReelOpportunity): Promise<void>;
  getOpportunity(businessId: string, id: string): Promise<ReelOpportunity | null>;
  saveAuthorizationSnapshot(x: ReelAuthorizationSnapshot): Promise<void>;
  getAuthorizationSnapshot(businessId: string, id: string): Promise<ReelAuthorizationSnapshot | null>;
  saveAsset(x: ReelAsset): Promise<void>;
  getAsset(businessId: string, id: string): Promise<ReelAsset | null>;
  setCurrentVersion(assetId: string, versionId: string): Promise<void>;
  saveVersion(x: ReelAssetVersion): Promise<void>;
  getVersion(businessId: string, id: string): Promise<ReelAssetVersion | null>;
  saveRender(x: ReelRenderVersion): Promise<void>;
  getRender(versionId: string): Promise<ReelRenderVersion | null>;
  recordRevision(e: { assetId: string; fromVersionId: string; toVersionId: string; scope: string; at: string }): Promise<void>;
  saveSafetyTrace(x: ReelSafetyTrace): Promise<void>;
  saveSource(businessId: string, s: ReelSourceRef & { uploadSetId: string }): Promise<void>;
  listSources(businessId: string, uploadSetId: string): Promise<ReelSourceRef[]>;
  saveJob(x: ReelJob): Promise<void>;
  getJob(businessId: string, jobId: string): Promise<ReelJob | null>;
}
