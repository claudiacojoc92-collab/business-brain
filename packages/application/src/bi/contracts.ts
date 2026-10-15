import { isHousekeeping, restatesNotShown, sameInsight } from './insight-text';
import type { Calculation, NumberClaim } from './numeric-grounding';

/**
 * Slice 1 "BB learned my business" — contracts.
 *
 * Governed understanding + Aha are SYNTHESIS (inference over observed evidence), kept separate
 * from the observed evidence.fragments. Every synthesis field cites page refs that must resolve
 * to a real linked page (deterministic grounding), and the immutable fragments are never mutated.
 */

/**
 * A grounded source observation the synthesis reads. Historically projected only from a linked website
 * PAGE fragment (`provenance:'observed'`); now also carries founder-SUPPLIED material
 * (`provenance:'declared'`) through the SAME synthesis path. `provenance` preserves the frozen epistemic
 * lane end-to-end: OBSERVED = BB fetched it from an external source; DECLARED = the founder supplied text/
 * material for BB to inspect (NOT authoritative business truth). `url` is a real page URL for observed
 * material and a stable `founder://supplied/...` URI for declared material (used only for ref-dedup/grounding,
 * never presented as a fetched page). The name stays `PageObservation` for call-site stability.
 */
export type ObservationProvenance = 'observed' | 'declared';
export interface PageObservation {
  readonly ref: string; // stable founder-readable label: "Homepage", "Services", or "What you told me"
  readonly url: string;
  readonly pageType: string;
  readonly title: string | null;
  readonly text: string;
  readonly lang: string | null;
  readonly provenance?: ObservationProvenance; // default 'observed' (back-compat); 'declared' = founder-supplied
  /**
   * Which pour-in source this came from, so synthesis can budget by kind (website pages are capped; every
   * non-website source is always included). Absent on legacy single-source paths: then a declared observation
   * counts as non-website and an observed one as a website page.
   */
  readonly sourceKind?: ObservationSourceKind;
  /**
   * How a website page was found (2026-10-15): the entry page itself, a link on it, ONLY a sitemap entry (nothing on
   * the homepage links to it: possibly stale or orphaned), or a guessed common path. Absent on older fragments.
   */
  readonly discoveredVia?: PageDiscovery;
  /** When the page was read (ISO). */
  readonly capturedAt?: string;
}
export type PageDiscovery = 'entry' | 'link' | 'sitemap' | 'common';
export type ObservationSourceKind = 'website' | 'supplied' | 'instagram';
export type ContradictionKind = 'capability_gap' | 'customer_proof' | 'channel_mismatch' | 'commercial_path' | 'priority_vs_effort' | 'story_vs_reality' | 'audience_mismatch' | 'other';

export interface SourceRef {
  readonly label: string;
  readonly url: string;
}

/**
 * The exact source sentence behind a claim (BUS-73, operator 2026-10-13: "Why I'm saying this" shows WHAT BB read,
 * not WHERE). The model proposes {ref, quote}; synthesis keeps only quotes that anchor verbatim in that ref's stored
 * text, stores the span AS WRITTEN on the page, and adds the page's display name. A claim with none is never shown.
 */
export interface ClaimEvidence { readonly ref: string; readonly quote: string; readonly page?: string }

export interface GovernedUnderstanding {
  readonly offer: { summary: string; explicit: string[]; unclear: string[]; sourceRefs: string[] };
  readonly positioning: { summary: string; evidenceBacked: string[]; implied: string[]; sourceRefs: string[] };
  /** `summary` (composed, content language) is who the business serves, as a label; `addressed` is the LIFTED source
   *  wording (source language). Understandings stored before `summary` existed have only `addressed`. */
  readonly audience: { summary?: string; addressed: string[]; appearsTargeted: string[]; unknown: string[]; sourceRefs: string[] };
  readonly messaging: { recurringThemes: string[]; sourceRefs: string[] };
  readonly acquisition: { visiblePaths: string[]; sourceRefs: string[] };
  /**
   * `kind` is the model's classification of the tension (see the understanding prompt's STRATEGIC LENS). The arc
   * projection uses it deterministically: a `capability_gap` (sells X, never shows X) is always shown first.
   * Optional: snapshots written before it existed have none.
   */
  readonly contradictions: {
    statementA: string; statementB: string; tension: string; sourceRefs: string[]; kind?: ContradictionKind; soWhat?: string; evidence?: ClaimEvidence[];
    /** Epistemic basis (2026-10-15). `absence` = it is about something NOT visible in the sources read: an observation
     *  about the sources ("I could not see X"), never a fact about the business ("X does not exist"). */
    basis?: EvidenceBasis; absence?: boolean;
  }[];
  readonly unknowns: string[];
  /**
   * The model's answer to the CAPABILITY CHECK: what the business sells and whether its own sources ever show it.
   * When `shown` is false, the arc projection makes `insight` the primary "What stood out" item (decided in code,
   * not left to the model's ordering). Optional: older snapshots have none.
   */
  readonly capabilityCheck?: { sells: string; shown: boolean; insight: string; soWhat: string; sourceRefs: string[]; evidence?: ClaimEvidence[] };
  /**
   * Strategic Depth W1: the ONE constraint behind the contradictions (they are its symptoms). `decided: false` = the
   * model could not name one honestly (the card then says so). Optional: older snapshots have none.
   */
  readonly constraint?: {
    decided: boolean; statement: string; why: string; sourceRefs: string[];
    /** The root-cause level the model stopped at, and its own yes/no answer per level (users → target → offer). */
    level?: ConstraintLevel;
    levelCheck?: Partial<Record<'users' | 'target' | 'offer', { passed: boolean; evidence: string }>>;
    /** set when the first one was re-asked (restated a tension, visibility framing, or an inconsistent level) */
    retried?: boolean;
  };
  /** Strategic Depth W1: the business's stage, from cited evidence only. Optional: older snapshots have none. */
  readonly stage?: {
    stage: BusinessStage; evidence: string[]; sourceRefs: string[];
    /** One named part at a different stage than the core (e.g. a new channel still validating). Optional. */
    secondary?: { stage: BusinessStage; area: string; evidence: string[]; numbers?: NumberClaim[]; calculations?: Calculation[] } | null;
    /** Grounding for any number in the stage evidence (numeric grounding applies to stage lines too). */
    numbers?: NumberClaim[]; calculations?: Calculation[];
  };
  /** v2 (2026-10-15): the business-model read, epistemics and earned diagnosis. Absent on older snapshots. */
  readonly read?: UnderstandingRead;
}
export type BusinessStage = 'validating' | 'growth' | 'plateau' | 'undetermined';

// ── Understanding read v2 (2026-10-15): a business-model representation BEFORE any diagnosis ──

/**
 * Where an assertion comes from (the provenance lanes of ConfidenceKind, plus contradiction): observed = in what BB read
 * (the site, Instagram); declared = the founder said or supplied it; inferred = BB's reading of a pattern;
 * contradicted = the sources disagree. Unknowns are kept apart, as unknowns.
 */
export type EvidenceBasis = 'observed' | 'declared' | 'inferred' | 'contradicted';
/** The business model BB reasons over, dimension by dimension. Not every dimension has to be known. */
export type ModelDimension = 'offer' | 'customer' | 'acquisition' | 'conversion' | 'retention' | 'capacity' | 'economics' | 'performance' | 'intent';
export const MODEL_DIMENSIONS: readonly ModelDimension[] = ['offer', 'customer', 'acquisition', 'conversion', 'retention', 'capacity', 'economics', 'performance', 'intent'];
/** The strategic decisions an answer can change: what makes a question worth one of the few slots. */
export type StrategicDecision = 'segment' | 'bet' | 'channel' | 'offer' | 'capacity' | 'retention' | 'resources' | 'sequencing';
export const STRATEGIC_DECISIONS: readonly StrategicDecision[] = ['segment', 'bet', 'channel', 'offer', 'capacity', 'retention', 'resources', 'sequencing'];
export interface ModelClaim { readonly text: string; readonly basis: EvidenceBasis; readonly sourceRefs: string[]; readonly numbers?: NumberClaim[]; readonly calculations?: Calculation[] }
/** The five things a constraint must establish before BB may call it one. */
export type DiagnosisCheck = 'exists' | 'causal' | 'blocks' | 'alternativesWeaker' | 'evidenceSufficient';
export const DIAGNOSIS_CHECKS: readonly DiagnosisCheck[] = ['exists', 'causal', 'blocks', 'alternativesWeaker', 'evidenceSufficient'];

/** Why code did not trust a finding (rendered in the business's content language; `why` then stays empty). */
export type UntrustedReason = 'sitemap' | 'technical' | 'sitemap_only' | 'unread';
/** Why code lowered a proposed constraint to a hypothesis. */
export type NotConcludingReason = 'no_goal' | 'not_established' | 'unsupported';

export interface UnderstandingRead {
  /** What BB knows and does not know, per dimension. */
  readonly model: { readonly dimension: ModelDimension; readonly known: ModelClaim[]; readonly unknown: string[] }[];
  /** Conclusions BB deliberately did NOT draw, and why (e.g. "which segment drives revenue: the site cannot say"). */
  readonly notConcluding: { readonly claim: string; readonly why: string; readonly reason?: NotConcludingReason }[];
  /** Findings BB saw but does not trust as business facts (sitemap-only pages, maintenance/test content, stale or
   *  contradictory material), with why. Never used as strategic evidence. */
  readonly untrusted: { readonly finding: string; readonly refs: string[]; readonly why: string; readonly reason?: UntrustedReason }[];
  /** Website hygiene (counters, indexing, broken pages): kept, but never a tension or a question unless material. */
  readonly websiteNotes: string[];
  /** Candidate questions, each with the strategic decisions its answer could change. Ranked in code. */
  /** `parts`: answers that must stay separate inside one question (e.g. clients vs revenue, which can diverge).
   *  `fills`: the business-model dimensions the answer would fill (how strategy-critical unknowns get covered). */
  readonly questions: { readonly question: string; readonly dimension: ModelDimension; readonly changes: StrategicDecision[]; readonly why: string; readonly parts?: string[]; readonly fills?: ModelDimension[] }[];
  /** Facts the model offered as insights that change no decision yet (demoted from Aha): kept, never called an insight. */
  readonly observations?: { readonly text: string; readonly sourceRefs: string[]; readonly reason?: string }[];
  /**
   * Is there enough to make the NEXT strategic decision responsibly? `missing` = strategy-critical dimensions still
   * unknown (they reserve the first question slots). Not every dimension has to be known. Complements the diagnosis.
   */
  readonly strategyReadiness?: { readonly state: 'not_ready' | 'ready_enough_for_strategy'; readonly missing: ModelDimension[] };
  /**
   * The diagnosis, EARNED: `constraint` only when every check passes (in code, not on the model's word); else a
   * `hypothesis` worth testing, or `not_ready`. `demotedBecause` says why code lowered what the model proposed.
   */
  readonly diagnosis: {
    readonly state: 'not_ready' | 'hypothesis' | 'constraint';
    readonly statement: string;
    readonly checks: Partial<Record<DiagnosisCheck, { readonly pass: boolean; readonly note: string }>>;
    readonly sourceRefs: string[];
    readonly demotedBecause?: string;
    readonly demotion?: NotConcludingReason;
  };
}
export type ConstraintLevel = 'users' | 'target' | 'offer' | 'time';

// Narrow on purpose: "what is your priority: users, validation or a paid launch?" is a goal question and stays.
const COMMERCIAL_TOPIC = /\b(pric\w*|cost\w*|charg\w*|monetis\w*|monetiz\w*|subscription\w*|paid (model|plan|tier|version)|(move|path|transition) to paid)\b/i;
const CHANNEL_TOPIC = /(@\w+|\binstagram\b)/i;

/** The (≤3) things BB could NOT learn from the site — the SINGLE source for both the understanding "What I'll ask
 * you about" card AND the conversation's opening agenda (seeded as needs). Using one derivation guarantees what BB
 * shows equals what it asks. Deterministic, order-preserving, deduped. A question about the site's wording
 * (housekeeping) or one that restates an observation already shown in "What stood out" is not asked. */
export function agendaUnknowns(u: GovernedUnderstanding | null): string[] {
  if (!u) return [];
  const shown = [u.capabilityCheck?.shown === false ? u.capabilityCheck.insight : '', ...(u.contradictions ?? []).map((c) => c.tension)]
    .map((x) => (x ?? '').trim()).filter(Boolean);
  // Once an observation names a gap, the questions don't re-open it under another wording ("what will you charge"
  // next to a commercial-path observation, "is this account yours" next to a channel observation).
  const kinds = new Set((u.contradictions ?? []).map((c) => c.kind));
  const reopens = (q: string): boolean => (kinds.has('commercial_path') && COMMERCIAL_TOPIC.test(q)) || (kinds.has('channel_mismatch') && CHANNEL_TOPIC.test(q))
    || (u.capabilityCheck?.shown === false && restatesNotShown(q));
  const seen = new Set<string>();
  const out: string[] = [];
  // A v2 read: `unknowns` IS the ranked question list (governance ranks by the decisions an answer changes), so the
  // offer/audience "unclear" lists (often website details) never take a question slot.
  const pool = u.read ? (u.unknowns ?? []) : [...(u.unknowns ?? []), ...(u.offer?.unclear ?? []), ...(u.audience?.unknown ?? [])];
  for (const x of pool) {
    const v = (x ?? '').trim();
    const k = v.toLowerCase();
    if (!v || seen.has(k) || isHousekeeping(v) || reopens(v) || shown.some((t) => sameInsight(v, t, 0.4))) continue;
    if (out.some((q) => sameInsight(v, q, 0.6))) continue; // the same question twice, worded differently
    seen.add(k); out.push(v);
  }
  return out.slice(0, 3);
}

export interface AhaFinding {
  readonly finding: string;
  readonly implication?: string;
  readonly sourceRefs: string[]; // page refs (validated → resolvable)
  /** 2026-10-15 — a fact is not an insight: why it matters, and which strategic decisions it could change. A finding
   *  without both is an observation, not an Aha (governance demotes it). */
  readonly matters?: string;
  readonly changes?: StrategicDecision[];
  /** Verbatim source sentences, every source number tied to its entity/qualifier, and every derived number's calculation
   *  (numeric grounding: a number not grounded this way is never shown). */
  readonly evidence?: { readonly ref: string; readonly quote: string }[];
  readonly numbers?: NumberClaim[];
  readonly calculations?: Calculation[];
}

export interface AhaResult {
  readonly status: 'produced' | 'insufficient';
  readonly findings: AhaFinding[];
}

/** Raw model output (unvalidated) — the propose-only synthesis. */
export interface SynthesisOutput {
  readonly understanding: GovernedUnderstanding;
  readonly aha: AhaResult;
  readonly sourceLanguage?: string;
  readonly modelId?: string;
}

// ── ports implemented outside the application layer (apps/api adapters) ──

export interface WebsiteIngestionResult {
  readonly state: 'synced' | 'partial' | 'empty' | 'failed';
  readonly url: string | null;
  readonly pagesRead: number;
  readonly fragmentsStored: number;
  readonly gaps: string[];
  readonly error?: string;
}

export interface IWebsiteIngestionPort {
  /** Reads the real website into the founder-scoped immutable evidence store. */
  ingest(founderId: string, url: string): Promise<WebsiteIngestionResult>;
}

export interface DiscoveredProfileInput {
  readonly platform: string;
  readonly url: string;
  readonly discoveredFromUrl: string;
}

export interface ISocialDiscoveryPort {
  /** Best-effort: find obvious outbound public business profiles linked from the site. No scraping. */
  discover(url: string): Promise<DiscoveredProfileInput[]>;
}

export interface UnderstandingModelInput {
  readonly businessName: string;
  readonly observations: PageObservation[];
  readonly interfaceLanguage: string; // Aha projection language (ro|en|it)
}

export interface IUnderstandingModelPort {
  /** Propose-only synthesis; the application layer validates + grounds the result deterministically. */
  synthesize(input: UnderstandingModelInput): Promise<SynthesisOutput>;
}

// ── persistence ports (infrastructure adapters) ──

export interface IBusinessEvidenceLinkRepository {
  /** Idempotently bind immutable fragments to a business (no copy, no re-key). */
  bind(businessId: string, links: { fragmentId: string; source: string }[]): Promise<{ linked: number }>;
  listFragmentIds(businessId: string): Promise<string[]>;
  /** Remove business links (the fragments themselves stay in the append-only ledger). */
  unbind(businessId: string, fragmentIds: readonly string[]): Promise<{ unlinked: number }>;
}

export interface DiscoveredProfile {
  readonly id: string;
  readonly platform: string;
  readonly url: string;
  readonly status: 'discovered' | 'confirmed' | 'rejected';
}

export interface IDiscoveredProfileRepository {
  upsertMany(businessId: string, profiles: DiscoveredProfileInput[]): Promise<void>;
  list(businessId: string): Promise<DiscoveredProfile[]>;
  setStatus(businessId: string, id: string, status: 'confirmed' | 'rejected'): Promise<DiscoveredProfile | null>;
}

export interface UnderstandingSnapshotRecord {
  readonly id: string;
  readonly businessId: string;
  readonly profileVersion: string;
  readonly contentHash: string;
  readonly sourceRefCount: number;
  readonly sourceLanguage: string | null;
  readonly understanding: GovernedUnderstanding;
  readonly modelId: string;
  readonly createdAt: string;
}

export interface SaveUnderstandingInput {
  readonly id: string;
  readonly businessId: string;
  readonly profileVersion: string;
  readonly contentHash: string;
  readonly sourceRefCount: number;
  readonly sourceLanguage: string | null;
  readonly understanding: GovernedUnderstanding;
  readonly modelId: string;
}

export interface IUnderstandingSnapshotRepository {
  save(input: SaveUnderstandingInput): Promise<UnderstandingSnapshotRecord>;
  latest(businessId: string): Promise<UnderstandingSnapshotRecord | null>;
}

export interface AhaRecord {
  readonly id: string;
  readonly businessId: string;
  readonly understandingSnapshotId: string;
  readonly language: string;
  readonly status: 'produced' | 'insufficient';
  readonly findings: { finding: string; implication?: string; sourceRefs: SourceRef[] }[];
  readonly modelId: string;
  readonly createdAt: string;
}

export interface SaveAhaInput {
  readonly id: string;
  readonly businessId: string;
  readonly understandingSnapshotId: string;
  readonly language: string;
  readonly contentHash: string;
  readonly status: 'produced' | 'insufficient';
  readonly findings: { finding: string; implication?: string; sourceRefs: SourceRef[] }[];
  readonly modelId: string;
}

export interface IAhaRepository {
  save(input: SaveAhaInput): Promise<AhaRecord>;
  latest(businessId: string): Promise<AhaRecord | null>;
}

export interface IBusinessWebsiteRepository {
  setWebsite(businessId: string, url: string, state: string): Promise<void>;
  setIngestion(businessId: string, state: string, ingested: boolean): Promise<void>;
}

export const UNDERSTANDING_PROFILE_VERSION = 'website.offer_positioning_audience.v1';
/**
 * Source-neutral profile version for understanding built (wholly or partly) from founder-SUPPLIED material,
 * kept distinct from the website-only version so lineage stays legible and old website snapshots are never
 * silently reinterpreted. Same understanding SHAPE (offer/positioning/audience/…); only the source lane and
 * provenance labelling differ. Additive — existing `website.*` snapshots keep their version.
 */
export const SUPPLIED_UNDERSTANDING_PROFILE_VERSION = 'sources.offer_positioning_audience.v1';

/** Founder-supplied material learn — one text block the founder pasted for BB to inspect (DECLARED evidence). */
export interface LearnFromMaterialParams {
  readonly businessId: string;
  readonly founderId: string;
  readonly businessName: string;
  readonly material: string;
  readonly interfaceLanguage: string;
}
