/**
 * Slice 2 "BB understood me" — contracts.
 *
 * Founder-OWNED state (goal/horizon/constraint/preference/decision/intention/challenge_permission/
 * resource/business_correction) is authoritative and kept structurally separate from OBSERVED
 * founder patterns (candidate→supported→confirmed, evidence-backed, correctable/deletable). Aha 2
 * is a cross-source synthesis (business × founder) governed by the same claim-type discipline as
 * Slice 1, plus a psychology guard.
 */

export type ConversationStatus = 'active' | 'paused' | 'ready_for_aha2';

export type FounderStateKind =
  | 'goal'
  | 'horizon'
  | 'constraint'
  | 'preference'
  | 'decision'
  | 'intention'
  | 'challenge_permission'
  | 'resource'
  | 'business_correction';

export interface ConversationTurn {
  readonly id: string;
  readonly role: 'founder' | 'bb';
  readonly content: string;
  readonly language: string;
  readonly seq: number;
  readonly createdAt: string;
}

export interface ConversationSession {
  readonly id: string;
  readonly businessId: string;
  readonly conversationLanguage: string;
  readonly status: ConversationStatus;
  readonly currentFocus: string | null;
}

export interface FounderStateItem {
  readonly id: string;
  readonly kind: FounderStateKind;
  readonly statement: string;
  readonly scope: string | null;
  readonly temporary: boolean;
  readonly status: 'active' | 'superseded' | 'deleted';
}

export interface FounderObservation {
  readonly id: string;
  readonly behavior: string;
  readonly status: 'candidate' | 'supported' | 'confirmed' | 'rejected' | 'deleted';
  readonly turnRefs: string[];
}

export interface InformationNeed {
  readonly id: string;
  readonly key: string;
  readonly whatMissing: string;
  readonly whyMatters: string;
  readonly status: 'open' | 'answered' | 'no_longer_needed' | 'deferred';
}

// ── conversation model (LLM) ──

export interface RoutedDeclaration {
  readonly kind: FounderStateKind;
  readonly statement: string;
  readonly scope?: string;
}
export interface ObservationCandidate {
  readonly behavior: string;
}

export interface ConversationStepOutput {
  readonly interpretation: string; // brief BB reflection of what the answer changed ('' on opener)
  readonly nextQuestion: string | null; // next pivotal question; null when nothing pivotal remains
  readonly readyForAha2: boolean;
  readonly declarations: RoutedDeclaration[];
  readonly businessCorrections: string[];
  readonly observationCandidates: ObservationCandidate[];
  readonly answeredNeedKeys: string[];
  readonly newNeeds: { key: string; whatMissing: string; whyMatters: string }[];
}

export interface ConversationStepInput {
  readonly businessName: string;
  readonly interfaceLanguage: string;
  readonly understandingSummary: string;
  readonly aha1: { finding: string }[];
  readonly openNeeds: { key: string; whatMissing: string; whyMatters: string }[];
  readonly knownState: { kind: string; statement: string }[];
  readonly transcript: { role: 'founder' | 'bb'; content: string }[];
  readonly latestFounderMessage: string | null; // null → generate the opener from Aha 1
}

export interface IConversationModelPort {
  step(input: ConversationStepInput): Promise<ConversationStepOutput>;
}

// ── Aha 2 model (LLM) ──

export interface Aha2Finding {
  readonly implication: string;
  readonly businessRefs: string[];
  readonly founderRefs: string[];
  readonly observationRefs: string[];
}
export interface Aha2Output {
  readonly findings: Aha2Finding[];
}
export interface Aha2Input {
  readonly businessName: string;
  readonly interfaceLanguage: string;
  readonly businessElements: { ref: string; text: string }[];
  readonly founderState: { ref: string; kind: string; statement: string }[];
  readonly observations: { ref: string; behavior: string }[];
}
/**
 * Scoped repair of ONE invalid implication. The candidate broke a boundary gate (strategy selection,
 * unsupported outcome, or founder-state upgrade); we ask the model to reformulate it as a
 * tension/dependency/constraint using the SAME supporting refs, preserving the cross-source
 * connection and specificity. Repair never regenerates the conversation and never invents new refs.
 */
export interface Aha2RepairInput {
  readonly businessName: string;
  readonly interfaceLanguage: string;
  readonly invalidImplication: string;
  readonly failureReason: string; // human-readable why the candidate failed
  readonly businessElements: { ref: string; text: string }[]; // the cited business support
  readonly founderState: { ref: string; kind: string; statement: string }[]; // the cited founder support
  readonly observations: { ref: string; behavior: string }[]; // the cited observed support
}
export interface IAha2ModelPort {
  synthesize(input: Aha2Input): Promise<Aha2Output>;
  repair(input: Aha2RepairInput): Promise<Aha2Output>;
}

// ── persistence ports ──

export interface IConversationRepository {
  getByBusiness(businessId: string): Promise<ConversationSession | null>;
  create(input: { id: string; businessId: string; founderId: string; conversationLanguage: string }): Promise<ConversationSession>;
  setStatus(sessionId: string, status: ConversationStatus, currentFocus: string | null): Promise<void>;
  setLanguage(sessionId: string, language: string): Promise<void>;
  appendTurn(input: { id: string; sessionId: string; businessId: string; role: 'founder' | 'bb'; content: string; language: string; infoNeedKey: string | null }): Promise<ConversationTurn>;
  listTurns(sessionId: string): Promise<ConversationTurn[]>;
}

export interface IInformationNeedRepository {
  seed(sessionId: string, businessId: string, needs: { key: string; whatMissing: string; whyMatters: string }[]): Promise<void>;
  listOpen(sessionId: string): Promise<InformationNeed[]>;
  markAnswered(sessionId: string, keys: string[]): Promise<void>;
}

export interface IFounderStateRepository {
  append(input: { id: string; businessId: string; founderId: string; kind: FounderStateKind; statement: string; scope: string | null; language: string; sourceTurnId: string | null }): Promise<FounderStateItem>;
  listActive(businessId: string): Promise<FounderStateItem[]>;
  setStatus(businessId: string, id: string, status: 'superseded' | 'deleted'): Promise<FounderStateItem | null>;
  setTemporary(businessId: string, id: string, temporary: boolean): Promise<void>;
}

export interface IFounderObservationRepository {
  listActive(businessId: string): Promise<FounderObservation[]>; // candidate|supported|confirmed
  /** Insert a candidate, or promote an existing candidate with matching behavior to 'supported'. */
  observe(businessId: string, behavior: string, turnId: string): Promise<FounderObservation>;
  setStatus(businessId: string, id: string, status: 'confirmed' | 'rejected' | 'deleted'): Promise<FounderObservation | null>;
}

/** Founder-facing finding: the implication plus resolved support text ("Your site shows / You told me"). */
export interface Aha2FindingResolved {
  readonly implication: string;
  readonly business: string[];
  readonly founder: string[];
  readonly observations: string[];
}
export interface Aha2Record {
  readonly id: string;
  readonly businessId: string;
  readonly language: string;
  readonly status: 'produced' | 'insufficient';
  readonly findings: Aha2FindingResolved[];
  readonly createdAt: string;
}
export interface IAha2Repository {
  save(input: { id: string; businessId: string; sessionId: string | null; understandingSnapshotId: string | null; language: string; contentHash: string; modelId: string; status: 'produced' | 'insufficient'; findings: Aha2FindingResolved[] }): Promise<Aha2Record>;
  latest(businessId: string): Promise<Aha2Record | null>;
}
