/**
 * Business Read contract — a FAITHFUL web-side mirror of the API types (S1-T4). The web cannot import
 * apps/api types, so this mirrors read-assembler.ts + receipts.ts EXACTLY. It stays in sync via
 * SUPPORTED_SCHEMA_VERSION: a fetched Read whose schemaVersion is not supported is failed closed, never
 * mis-rendered against a drifted contract. Presentation only — nothing here interprets or mutates.
 */

export type EpistemicKind = 'observed' | 'declared' | 'inferred';
export type SectionId = 'what_i_read' | 'what_i_observe' | 'gaps' | 'bets' | 'my_read' | 'cannot_see';

/** The one Read contract version this surface understands. A mismatch → fail closed (never mis-render). */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Receipts are PURE EVIDENCE: verbatim source text + source metadata. Never 'inferred'. */
export interface Receipt {
  fragmentId: string;
  epistemicKind: 'observed' | 'declared';
  sourceType: string;
  text: string;
  sourceLabel?: string;
  sourceUrl?: string;
  occurredAt?: string;
  capturedAt: string;
}

export interface Provenance {
  fragmentIds: string[];
  declaredFragmentIds?: string[];
  observedFragmentIds?: string[];
}

export interface ReadClaim {
  statement: string;
  epistemicKind: EpistemicKind;
  internalCategory?: string; // frozen engine enum — NEVER rendered to the founder
  provenance: Provenance;
  receipts?: Receipt[];
  declaredReceipts?: Receipt[]; // S3 only — the story (declared) side
  observedReceipts?: Receipt[]; // S3 only — the evidence (observed) side
}

export interface RecommendationClaim extends ReadClaim {
  disclosure: {
    assumptions: string[];
    confidence: string;
    truthStatus: 'inferred';
  };
}

export interface SourceManifestEntry {
  source: string;
  itemCount: number;
  earliest?: string;
  latest?: string;
}

export interface Limit {
  kind: 'absent_source' | 'engine_rejected' | 'ceiling';
  detail: string;
  source?: string;
}

export interface ReadSection {
  id: SectionId;
  title: string;
  empty: boolean;
  claims?: Array<ReadClaim | RecommendationClaim>;
  manifest?: SourceManifestEntry[];
  limits?: Limit[];
}

export interface BusinessRead {
  founderId: string;
  sections: ReadSection[];
  assembledAt: string;
}

/** GET /reads/:readId · /reads/latest response envelope. */
export interface StoredReadResponse {
  readId: string;
  createdAt: string;
  schemaVersion: number;
  read: BusinessRead;
}

/** GET /reads list item (metadata only — the full Read is fetched by id). */
export interface ReadListItem {
  readId: string;
  createdAt: string;
  schemaVersion: number;
}

export interface ReadListResponse {
  reads: ReadListItem[];
  nextOffset?: number;
}

/** A RecommendationClaim is the only claim carrying `disclosure`. */
export function isRecommendationClaim(c: ReadClaim | RecommendationClaim): c is RecommendationClaim {
  return 'disclosure' in c && c.disclosure != null;
}

/** The fixed 6-section order the document renders — never reordered, never ranked. */
export const SECTION_ORDER: SectionId[] = ['what_i_read', 'what_i_observe', 'gaps', 'bets', 'my_read', 'cannot_see'];
