/**
 * Wave 4 — Strategic Learning Consumption Gate (ADR-014 + remediation). An immutable, append-only ContextSnapshot is the
 * ONLY reasoning input the Recommendation Engine may consume: a frozen capture of the ENTIRE governed reasoning input —
 * Effective Business Understanding (native + promoted), Effective Founder Strategic Context (native + promoted), AND
 * public-positioning/market context — with provenance. A recommendation reasons over the FROZEN snapshot, never live
 * context; every new generation is snapshot-bound (mandatory). The authoritative integrity hash is SHA-256 over a
 * canonical serialization, computed server-side. Consumption is explicit; nothing is consumed automatically; no model
 * authority.
 *
 * Governed by docs/governance/strategic-learning-consumption-contract.md (L1–L12, R1–R9).
 */
import { createHash } from 'node:crypto';
import type { StrategicContext } from './strategic-context.assembler';

/** The frozen payload schema + hash algorithm identifiers (recorded on every snapshot). */
export const SNAPSHOT_PAYLOAD_SCHEMA_VERSION = 'context-snapshot-2';
export const SNAPSHOT_HASH_ALGORITHM = 'sha256';

/** A promoted-learning item as it enters the frozen Founder Strategic Context (additive; kept distinct from native). */
export interface FrozenPromotedLearning {
  promotionEventId: string; logicalLearningId: string; learningRevisionId: string; learningRevisionNumber: number;
  statement: string; scope: string; rationale: string | null; epistemicStatus: string; lifecycleStatusAtSnapshot: string;
}

export type FrozenBusinessUnderstanding = StrategicContext['businessUnderstanding'];
export type FrozenFounderContext = StrategicContext['founderContext'] & { promotedLearnings: FrozenPromotedLearning[] };
/** Public-positioning/market context, frozen verbatim so the strategist never reads it live (R4). */
export type FrozenPublicPositioning = StrategicContext['publicPositioningContext'];

/** Per-item provenance recorded alongside the frozen payload (native vs promoted; exact revision). */
export interface SnapshotProvenance {
  businessUnderstanding: Array<{ conclusionId: string; sourceType: 'NATIVE_BUSINESS_UNDERSTANDING' | 'PROMOTED_LEARNING'; learningRevisionId?: string; learningRevisionNumber?: number; promotionEventId?: string }>;
  founderStrategicContext: Array<{ itemId: string; sourceType: 'NATIVE_FOUNDER_STRATEGIC_CONTEXT' | 'PROMOTED_LEARNING'; learningRevisionId?: string; learningRevisionNumber?: number; promotionEventId?: string }>;
  publicPositioning: Array<{ findingId: string; reviewId: string | null; adapter: string; model: string | null; promptVersion: string | null }>;
}

export interface ContextSnapshot {
  id: string; founderId: string;
  businessUnderstanding: FrozenBusinessUnderstanding;
  founderStrategicContext: FrozenFounderContext;
  publicPositioningContext: FrozenPublicPositioning;
  provenance: SnapshotProvenance;
  payloadSchemaVersion: string;
  hashAlgorithm: string;
  contentHash: string;
  createdAt: string;
}

/** The immutable input a recommendation consumes (ADR-014 Part 5). References the exact snapshot forever. */
export interface RecommendationInput {
  snapshotId: string;
  businessUnderstanding: FrozenBusinessUnderstanding;
  founderStrategicContext: FrozenFounderContext;
  publicPositioningContext: FrozenPublicPositioning;
  provenance: SnapshotProvenance;
  snapshotTimestamp: string;
}

/** Provenance recorded on every governed generation (R5). Server-resolved — the client cannot supply any of these. */
export interface GenerationProvenance {
  contextSnapshotId: string;
  contextSnapshotHash: string;
  contextSnapshotSchemaVersion: string;
  strategistVersion: string;      // prompt/strategist version
  promptTemplateHash: string;     // SHA-256 of the SYSTEM prompt template
  modelId: string;
  modelConfiguration: Record<string, unknown>;
  objectiveHash: string;          // SHA-256 of the frozen objective/question
  generatedAt: string;
}

/**
 * Canonical, deterministic serialization (R6): recursively sort object keys, preserve array order, distinguish
 * null/boolean/number/string, and REJECT unsupported values (undefined, functions, symbols, NaN, ±Infinity). No
 * environment-dependent formatting.
 */
export function canonicalSerialize(value: unknown): string {
  const enc = (v: unknown): string => {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'number') { if (!Number.isFinite(v as number)) throw new Error('canonicalSerialize: non-finite number'); return JSON.stringify(v); }
    if (t === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(enc).join(',')}]`;
    if (t === 'object') { const o = v as Record<string, unknown>; return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${enc(o[k])}`).join(',')}}`; }
    throw new Error(`canonicalSerialize: unsupported value of type ${t}`);
  };
  return enc(value);
}

/** The authoritative snapshot-integrity hash: SHA-256 of the canonical payload, lowercase hex (R6). Server-side only. */
export function computeContextSnapshotHash(payload: { businessUnderstanding: FrozenBusinessUnderstanding; founderStrategicContext: FrozenFounderContext; publicPositioningContext: FrozenPublicPositioning; provenance: SnapshotProvenance; payloadSchemaVersion: string }): string {
  return createHash('sha256').update(canonicalSerialize(payload), 'utf8').digest('hex');
}

/** SHA-256 hex of any string (prompt template, objective) — server-side provenance helper. */
export function sha256Hex(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex'); }

/** Build the immutable snapshot fields from the frozen governed reasoning input + provenance. Pure; no DB, no model. */
export function buildContextSnapshot(bu: FrozenBusinessUnderstanding, fsc: FrozenFounderContext, ppc: FrozenPublicPositioning, provenance: SnapshotProvenance): Omit<ContextSnapshot, 'id' | 'founderId' | 'createdAt'> {
  const payloadSchemaVersion = SNAPSHOT_PAYLOAD_SCHEMA_VERSION;
  return {
    businessUnderstanding: bu, founderStrategicContext: fsc, publicPositioningContext: ppc, provenance,
    payloadSchemaVersion, hashAlgorithm: SNAPSHOT_HASH_ALGORITHM,
    contentHash: computeContextSnapshotHash({ businessUnderstanding: bu, founderStrategicContext: fsc, publicPositioningContext: ppc, provenance, payloadSchemaVersion }),
  };
}

/** Recompute a snapshot's SHA-256 and compare — integrity verification (R6/Scenario H). */
export function verifyContextSnapshotIntegrity(s: ContextSnapshot): boolean {
  return s.hashAlgorithm === SNAPSHOT_HASH_ALGORITHM
    && s.contentHash === computeContextSnapshotHash({ businessUnderstanding: s.businessUnderstanding, founderStrategicContext: s.founderStrategicContext, publicPositioningContext: s.publicPositioningContext, provenance: s.provenance, payloadSchemaVersion: s.payloadSchemaVersion });
}

/** Project a snapshot into the assembler's frozen override (ALL governed dimensions this gate freezes — no live reads). */
export function snapshotToFrozenContext(snapshot: ContextSnapshot): { businessUnderstanding: FrozenBusinessUnderstanding; founderContext: FrozenFounderContext; publicPositioningContext: FrozenPublicPositioning } {
  return { businessUnderstanding: snapshot.businessUnderstanding, founderContext: snapshot.founderStrategicContext, publicPositioningContext: snapshot.publicPositioningContext };
}

/** Project a snapshot into the immutable RecommendationInput a recommendation consumes (L7). */
export function toRecommendationInput(snapshot: ContextSnapshot): RecommendationInput {
  return { snapshotId: snapshot.id, businessUnderstanding: snapshot.businessUnderstanding, founderStrategicContext: snapshot.founderStrategicContext, publicPositioningContext: snapshot.publicPositioningContext, provenance: snapshot.provenance, snapshotTimestamp: snapshot.createdAt };
}

/** Founder-safe view — counts + provenance + hash + timestamp; the snapshot changes nothing and regenerates nothing. */
export function toSnapshotView(s: ContextSnapshot) {
  const bu = s.businessUnderstanding; const fsc = s.founderStrategicContext; const ppc = s.publicPositioningContext;
  return {
    snapshotId: s.id, createdAt: s.createdAt, contentHash: s.contentHash, hashAlgorithm: s.hashAlgorithm, payloadSchemaVersion: s.payloadSchemaVersion,
    businessUnderstanding: {
      version: bu.version,
      conclusions: bu.conclusions.map((c) => ({ id: c.id, type: c.type, statement: c.statement, epistemicStatus: c.epistemicStatus })),
      promotedCount: s.provenance.businessUnderstanding.filter((p) => p.sourceType === 'PROMOTED_LEARNING').length,
    },
    founderStrategicContext: {
      nativeCounts: { goals: fsc.goals.length, constraints: fsc.constraints.length, resources: fsc.resources.length, strategicPreferences: fsc.strategicPreferences.length, decisionHorizons: fsc.decisionHorizons.length },
      promotedLearnings: fsc.promotedLearnings.map((p) => ({ statement: p.statement, revision: p.learningRevisionNumber, scope: p.scope, rationale: p.rationale, epistemicStatus: p.epistemicStatus })),
    },
    publicPositioning: { entities: ppc.entities.length, observations: ppc.observations.length, inferences: ppc.inferences.length },
    provenance: s.provenance,
    // reminders — a snapshot mutates nothing and regenerates nothing (L3, L5, L9)
    doesNotModifyContext: true, doesNotModifyLearning: true, doesNotRegenerate: true,
  };
}
