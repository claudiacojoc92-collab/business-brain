/**
 * Slice 4 "BB learned my voice" — contracts.
 *
 * The Voice Model is grounded in real EXAMPLES + explicit BOUNDARIES + NEGATIVE SPACE (canonical);
 * derived descriptors are secondary/disposable. Voice SUBJECTS are separated (founder_public vs
 * brand); the founder's conversational voice with BB is quarantined and never becomes brand output.
 * Voice is calibrated PER CONTENT LANGUAGE and scoped by language × market × channel × speaking-role
 * (inheritance, store deltas). Evidence determines WHAT may be claimed (frozen Evidence Engine); voice
 * determines only HOW an allowable claim is expressed.
 */

import type { AuthorizationSnapshot, SafetyDecision } from './authorization-snapshot';

export type VoiceSubject = 'founder_public' | 'brand';
export type ExampleSubject = VoiceSubject | 'founder_conversational';
export type SpeakingRole = 'founder_self' | 'founder_for_brand' | 'brand_institutional' | 'founder_led_brand';
export type SampleChannel = 'reel' | 'carousel' | 'caption';

export type VoiceExampleKind =
  | 'seed' | 'founder_written' | 'accepted' | 'strongly_accepted' | 'rejected'
  | 'edited_before' | 'edited_after' | 'claim_boundary';
export type VoiceSource = 'website' | 'founder_public' | 'founder_upload' | 'brand_copy' | 'generated' | 'conversation';

export interface VoiceExample {
  readonly id: string;
  readonly subject: ExampleSubject;
  readonly kind: VoiceExampleKind;
  readonly text: string;
  readonly language: string;
  readonly market: string | null;
  readonly channel: string | null;
  readonly speakingRole: SpeakingRole | null;
  readonly source: VoiceSource;
  readonly status: 'active' | 'superseded' | 'removed';
  readonly editGroupId: string | null;
  readonly createdAt: string;
}

export type BoundaryType = 'voice' | 'evidence' | 'legal' | 'strategic';
export interface VoiceBoundary {
  readonly id: string;
  readonly subject: string;
  readonly type: BoundaryType;
  readonly statement: string;
  readonly language: string | null;
  readonly status: 'active' | 'removed';
}

export type NegativeSpaceCategory = 'banned_word' | 'cliche' | 'hook' | 'manipulation' | 'directness' | 'founder_exposure' | 'format' | 'polish' | 'other';
export interface VoiceNegativeSpace {
  readonly id: string;
  readonly subject: string;
  readonly category: NegativeSpaceCategory;
  readonly value: string;
  readonly language: string | null;
  readonly status: 'active' | 'removed';
}

export type PatternStatus = 'candidate' | 'tentative' | 'established' | 'superseded';
export interface VoicePattern {
  readonly id: string;
  readonly subject: string;
  readonly language: string;
  readonly dimension: string;
  readonly statement: string;
  readonly status: PatternStatus;
  readonly observations: number;
  readonly exampleRefs: string[];
}

export interface SampleContent {
  readonly hook?: string;
  readonly beats?: string[];
  readonly caption?: string;
  readonly cta?: string;
}
export interface VoiceSample {
  readonly id: string;
  readonly sessionId: string | null;
  readonly subject: VoiceSubject;
  readonly language: string;
  readonly market: string | null;
  readonly channel: SampleChannel;
  readonly speakingRole: SpeakingRole;
  readonly objective: string;
  readonly content: SampleContent;
  readonly status: 'pending' | 'reacted' | 'superseded';
  readonly createdAt: string;
  // Immutable safety provenance — mandatory for every persisted sample (see authorization-snapshot.ts).
  readonly authorizationSnapshot: AuthorizationSnapshot;
  readonly safetyDecision: SafetyDecision;
}

export type FeedbackTarget = 'idea' | 'wording' | 'both' | 'unclear';
export type FeedbackSignal = 'strongly_accept' | 'accept_weak' | 'reject' | 'edit' | 'founder_written';

export interface CalibrationSession {
  readonly id: string;
  readonly subject: VoiceSubject;
  readonly language: string;
  readonly market: string | null;
  readonly status: 'active' | 'sufficient' | 'paused';
}

/** The small, relevance-selected set handed to generation for a target scope. */
export interface VoiceWorkingSet {
  readonly subject: VoiceSubject;
  readonly language: string;
  readonly market: string | null;
  readonly channel: SampleChannel | null;
  readonly speakingRole: SpeakingRole;
  readonly acceptedExamples: string[];       // FOUNDER-VERIFIED: strongly-accepted / founder-written / edited-after
  readonly seedExamples: string[];           // UNVERIFIED discovered copy (website/brand) — loose reference only, outranked
  readonly rejectedExamples: string[];       // to avoid resembling
  readonly edits: { before: string; after: string }[];
  readonly negativeSpace: string[];          // active negative-space values
  readonly boundaries: string[];             // active voice/legal/strategic boundary statements
  readonly establishedPatterns: string[];    // established + tentative derived patterns
  readonly calibrated: boolean;              // false → language not yet tuned
}

// ── model I/O (LLM adapters, implemented in apps/api) ──

export interface VoiceSeedInput {
  readonly businessName: string;
  readonly websiteCopy: string[];       // brand copy → seeds BrandVoice
  readonly founderPublic: string[];     // founder-attributed public writing → seeds FounderPublicVoice
}
export interface VoiceSeedExample { readonly subject: VoiceSubject; readonly text: string; readonly source: VoiceSource; }
export interface VoiceSeedOutput { readonly examples: VoiceSeedExample[]; readonly sufficient: boolean; }

/**
 * The bounded semantic contract between Evidence/Strategy and Voice. Evidence governs WHAT may be
 * claimed and Strategy WHAT the communication must accomplish; this spec is the AUTHORIZED MESSAGE.
 * Voice realizes it (HOW) and may NOT introduce any new externally-truth-conditional proposition.
 */
export type PropositionSource = 'business_evidence' | 'founder_owned' | 'strategy_decision' | 'market_evidence' | 'behavior_result' | 'brand_stance';
export interface LicensedProposition { readonly text: string; readonly source: PropositionSource }
/** What a communication job needs, and whether the authorized material can actually do it. */
// EXTERNAL jobs produce publishable marketing content. 'positioning_decision' is INTERNAL — it articulates
// the strategy itself and is never a standalone external calibration job.
export type CommunicationJobKind = 'proof' | 'offer' | 'mechanism' | 'positioning' | 'cta' | 'positioning_decision';
export type MaterialType =
  | 'result_evidence' | 'case_evidence' | 'work_artifact' | 'testimonial' | 'before_after' | 'demonstrable_output' // proof-bearing
  | 'offer_fact' | 'mechanism_process' | 'cta_direction' | 'strategy_decision';
export type JobFeasibility = 'feasible' | 'blocked_missing_material';

export interface AuthorizedMessageSpec {
  readonly communicationJob: string;
  readonly communicationJobKind: CommunicationJobKind;   // what KIND of job this is
  readonly requiredMaterialTypes: MaterialType[];        // any ONE of these can execute the job
  readonly availableMaterialRefs: string[];              // authorized material that can perform it (empty ⇒ nothing)
  readonly feasibility: JobFeasibility;                  // feasible only if required ∩ available ≠ ∅
  readonly speakingRole: SpeakingRole;
  readonly audience: string;
  readonly requiredMeaning: string;
  readonly licensedPropositions: LicensedProposition[]; // the ONLY substantive propositions the copy may assert
  readonly internalDecisions: string[];                 // strategy decisions that SHAPE sequencing/emphasis but must NOT be stated as content
  readonly stanceStatements: string[];                  // owned brand/founder stances the copy may express
  readonly ctaFunction: string;                         // the required next action
  readonly unknowns: string[];                          // e.g. "no licensed historical client-result proof exists"
  readonly forbiddenClasses: string[];                  // claim classes Voice must never introduce
}

export interface SampleGenInput {
  readonly businessName: string;
  readonly language: string;
  readonly market: string | null;
  readonly channel: SampleChannel;
  readonly speakingRole: SpeakingRole;
  readonly objective: string;                 // strategy-derived
  readonly strategy: { diagnosis: string; coreBet: string; messagingDirection: string; contentRole: string; audience: string; ctaDirection: string };
  readonly workingSet: VoiceWorkingSet;
  readonly claimBoundaries: string[];         // evidence/legal limits — HOW not WHAT
  readonly spec: AuthorizedMessageSpec;       // Voice realizes ONLY this; it does not author new propositions
  // Retained for the deterministic backstop gate (defense-in-depth), not the primary factuality mechanism.
  readonly allowedFacts: { business: string[]; founderOwned: string[]; strategyDecisions: string[] };
}
export interface SampleGenOutput { readonly content: SampleContent }

export interface FeedbackClassifyInput {
  readonly reactionText: string;
  readonly sample: SampleContent;
  readonly channel: SampleChannel;
}
export interface InferredVoiceSignal {
  readonly dimension: string;                 // e.g. directness|hook|claim_style|emotional_register|cta
  readonly statement: string;                 // candidate derived pattern in BB's words
}
export interface FeedbackClassifyOutput {
  readonly target: FeedbackTarget;            // idea vs wording vs both vs unclear
  readonly signal: FeedbackSignal;
  readonly negativeSpace: { category: NegativeSpaceCategory; value: string }[];
  readonly explicitBoundary: string | null;   // "I will never say X" → immediate boundary
  readonly inferred: InferredVoiceSignal[];   // candidate patterns (voice, only when target≠idea)
}

export interface VoiceProjectionInput {
  readonly subject: VoiceSubject;
  readonly language: string;
  readonly workingSet: VoiceWorkingSet;
}
export interface VoiceProjectionOutput { readonly lines: string[] } // natural-language, no schemas/scores

/** Judged semantic claim audit — classifies each material assertion and checks ENTAILMENT (not token
 * overlap) against the source-typed allowed material. Catches paraphrased capability/quality/outcome/
 * market claims the deterministic gate cannot. Returns only unauthorized assertions, for repair. */
export interface ClaimAuditInput {
  readonly content: SampleContent;
  readonly channel: SampleChannel;
  readonly allowed: { business: string[]; founderOwned: string[]; strategyDecisions: string[] };
}
export interface ClaimAuditOutput { readonly violations: { clause: string; claimClass: string; reason: string }[] }

/** PRIMARY factuality mechanism: extract the substantive propositions a candidate expresses and return
 * only those that are NEW — i.e. not entailed by the AuthorizedMessageSpec. Voice = HOW, not WHAT. */
export interface PropositionCheckInput { readonly content: SampleContent; readonly channel: SampleChannel; readonly spec: AuthorizedMessageSpec }
export interface PropositionCheckOutput { readonly newPropositions: { clause: string; proposition: string; reason: string }[] }

export interface IVoiceModelPort {
  seedDiscover(input: VoiceSeedInput): Promise<VoiceSeedOutput>;
  generateSample(input: SampleGenInput): Promise<SampleGenOutput>;
  repairSample(input: SampleGenInput & { rejected: SampleContent; reason: string }): Promise<SampleGenOutput>;
  classifyFeedback(input: FeedbackClassifyInput): Promise<FeedbackClassifyOutput>;
  projectVoice(input: VoiceProjectionInput): Promise<VoiceProjectionOutput>;
  /** Optional judged entailment layer (present in the real adapter; fakes may omit it). */
  auditClaims?(input: ClaimAuditInput): Promise<ClaimAuditOutput>;
  /** PRIMARY: proposition-preservation — does the candidate add any proposition beyond the spec? */
  checkPropositions?(input: PropositionCheckInput): Promise<PropositionCheckOutput>;
  /** Resolved judge identity for the immutable authorization snapshot (model id + prompt hash). */
  judgeContract?(): { modelId: string; promptHash: string };
}

// ── persistence ports ──

export interface IVoiceRepository {
  getOrCreateProfile(businessId: string, subject: VoiceSubject): Promise<{ id: string; subject: VoiceSubject }>;
  addExample(input: { businessId: string; subject: ExampleSubject; kind: VoiceExampleKind; text: string; language: string; market: string | null; channel: string | null; speakingRole: SpeakingRole | null; source: VoiceSource; editGroupId?: string | null; provenance?: Record<string, unknown> }): Promise<VoiceExample>;
  listExamples(businessId: string, subject: ExampleSubject, language?: string): Promise<VoiceExample[]>;
  addBoundary(input: { businessId: string; subject: string; type: BoundaryType; statement: string; language: string | null }): Promise<VoiceBoundary>;
  listBoundaries(businessId: string, subject: string): Promise<VoiceBoundary[]>;
  setBoundaryStatus(businessId: string, id: string, status: 'removed'): Promise<void>;
  addNegativeSpace(input: { businessId: string; subject: string; category: NegativeSpaceCategory; value: string; language: string | null }): Promise<VoiceNegativeSpace>;
  listNegativeSpace(businessId: string, subject: string): Promise<VoiceNegativeSpace[]>;
  setNegativeSpaceStatus(businessId: string, id: string, status: 'removed'): Promise<void>;
  listPatterns(businessId: string, subject: string, language: string): Promise<VoicePattern[]>;
  upsertPattern(input: { businessId: string; subject: string; language: string; dimension: string; statement: string; exampleRef: string | null }): Promise<VoicePattern>;
  promotePattern(businessId: string, id: string, status: PatternStatus): Promise<void>;
  createSession(input: { businessId: string; subject: VoiceSubject; language: string; market: string | null }): Promise<CalibrationSession>;
  getSession(businessId: string, subject: VoiceSubject, language: string, market: string | null): Promise<CalibrationSession | null>;
  setSessionStatus(id: string, status: 'active' | 'sufficient' | 'paused'): Promise<void>;
  addSample(input: { businessId: string; sessionId: string | null; subject: VoiceSubject; language: string; market: string | null; channel: SampleChannel; speakingRole: SpeakingRole; objective: string; content: SampleContent; authorizationSnapshot: AuthorizationSnapshot; safetyDecision: SafetyDecision }): Promise<VoiceSample>;
  getSample(businessId: string, id: string): Promise<VoiceSample | null>;
  listSamples(businessId: string, sessionId: string): Promise<VoiceSample[]>;
  setSampleStatus(businessId: string, id: string, status: 'reacted' | 'superseded'): Promise<void>;
  addFeedback(input: { businessId: string; sessionId: string | null; sampleId: string | null; target: FeedbackTarget; signal: FeedbackSignal; reactionText: string | null }): Promise<void>;
  nextVoiceVersion(businessId: string, subject: VoiceSubject, language: string, market: string | null): Promise<number>;
  saveVoiceVersion(input: { businessId: string; subject: VoiceSubject; language: string; market: string | null; version: number; contentHash: string; resolved: VoiceWorkingSet }): Promise<{ version: number }>;
}
