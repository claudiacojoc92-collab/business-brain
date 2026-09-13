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
}

export interface SourceRef {
  readonly label: string;
  readonly url: string;
}

export interface GovernedUnderstanding {
  readonly offer: { summary: string; explicit: string[]; unclear: string[]; sourceRefs: string[] };
  readonly positioning: { summary: string; evidenceBacked: string[]; implied: string[]; sourceRefs: string[] };
  readonly audience: { addressed: string[]; appearsTargeted: string[]; unknown: string[]; sourceRefs: string[] };
  readonly messaging: { recurringThemes: string[]; sourceRefs: string[] };
  readonly acquisition: { visiblePaths: string[]; sourceRefs: string[] };
  readonly contradictions: { statementA: string; statementB: string; tension: string; sourceRefs: string[] }[];
  readonly unknowns: string[];
}

export interface AhaFinding {
  readonly finding: string;
  readonly implication?: string;
  readonly sourceRefs: string[]; // page refs (validated → resolvable)
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
