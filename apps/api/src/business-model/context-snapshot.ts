/**
 * Wave 4 — Strategic Learning Consumption Gate (ADR-014). An immutable, append-only ContextSnapshot is the ONLY reasoning
 * input the Recommendation Engine may consume: a frozen capture of the canonical Effective Business Understanding +
 * Effective Founder Strategic Context (native records AND promoted learning revisions, with provenance). A recommendation
 * reasons over the FROZEN snapshot — never live context — and records the exact snapshot id it consumed. Consumption is
 * explicit; promotion never implies consumption; nothing is consumed automatically; the model has no authority here.
 *
 * Governed by docs/governance/strategic-learning-consumption-contract.md (L1–L12).
 */
import type { StrategicContext } from './strategic-context.assembler';

/** A promoted-learning item as it enters the frozen Founder Strategic Context (additive; kept distinct from native). */
export interface FrozenPromotedLearning {
  promotionEventId: string; logicalLearningId: string; learningRevisionId: string; learningRevisionNumber: number;
  statement: string; scope: string; rationale: string | null; epistemicStatus: string; lifecycleStatusAtSnapshot: string;
}

/** The frozen Effective Business Understanding — the assembler-shaped BU, with promoted-learning conclusions merged in. */
export type FrozenBusinessUnderstanding = StrategicContext['businessUnderstanding'];
/** The frozen Effective Founder Strategic Context — the assembler-shaped founderContext + promoted learnings. */
export type FrozenFounderContext = StrategicContext['founderContext'] & { promotedLearnings: FrozenPromotedLearning[] };

/** Per-item provenance recorded alongside the frozen payload (native vs promoted; exact revision). */
export interface SnapshotProvenance {
  businessUnderstanding: Array<{ conclusionId: string; sourceType: 'NATIVE_BUSINESS_UNDERSTANDING' | 'PROMOTED_LEARNING'; learningRevisionId?: string; learningRevisionNumber?: number; promotionEventId?: string }>;
  founderStrategicContext: Array<{ itemId: string; sourceType: 'NATIVE_FOUNDER_STRATEGIC_CONTEXT' | 'PROMOTED_LEARNING'; learningRevisionId?: string; learningRevisionNumber?: number; promotionEventId?: string }>;
}

export interface ContextSnapshot {
  id: string; founderId: string;
  businessUnderstanding: FrozenBusinessUnderstanding;
  founderStrategicContext: FrozenFounderContext;
  provenance: SnapshotProvenance;
  contentHash: string;
  createdAt: string;
}

/** The immutable input a recommendation consumes (ADR-014 Part 5). References the exact snapshot forever. */
export interface RecommendationInput {
  snapshotId: string;
  businessUnderstanding: FrozenBusinessUnderstanding;
  founderStrategicContext: FrozenFounderContext;
  provenance: SnapshotProvenance;
  snapshotTimestamp: string;
}

/** Deterministic canonical stringify (stable key order) — the hash must not depend on property insertion order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
/** Pure FNV-1a 32-bit over the canonical payload — deterministic, dependency-free (not a security hash). */
export function hashSnapshotPayload(bu: FrozenBusinessUnderstanding, fsc: FrozenFounderContext, prov: SnapshotProvenance): string {
  const s = canonical({ bu, fsc, prov });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`;
}

/** Build the immutable snapshot fields from the frozen Effective BU/FSC + provenance. Pure; no DB, no model. */
export function buildContextSnapshot(bu: FrozenBusinessUnderstanding, fsc: FrozenFounderContext, provenance: SnapshotProvenance): Omit<ContextSnapshot, 'id' | 'founderId' | 'createdAt'> {
  return { businessUnderstanding: bu, founderStrategicContext: fsc, provenance, contentHash: hashSnapshotPayload(bu, fsc, provenance) };
}

/** Project a snapshot into the assembler's frozen override (the two dimensions this gate freezes). */
export function snapshotToFrozenContext(snapshot: ContextSnapshot): { businessUnderstanding: FrozenBusinessUnderstanding; founderContext: FrozenFounderContext } {
  return { businessUnderstanding: snapshot.businessUnderstanding, founderContext: snapshot.founderStrategicContext };
}

/** Project a snapshot into the immutable RecommendationInput a recommendation consumes (L7). */
export function toRecommendationInput(snapshot: ContextSnapshot): RecommendationInput {
  return { snapshotId: snapshot.id, businessUnderstanding: snapshot.businessUnderstanding, founderStrategicContext: snapshot.founderStrategicContext, provenance: snapshot.provenance, snapshotTimestamp: snapshot.createdAt };
}

/** Founder-safe view — counts + provenance + hash + timestamp; the snapshot changes nothing and regenerates nothing. */
export function toSnapshotView(s: ContextSnapshot) {
  const bu = s.businessUnderstanding; const fsc = s.founderStrategicContext;
  return {
    snapshotId: s.id, createdAt: s.createdAt, contentHash: s.contentHash,
    businessUnderstanding: {
      version: bu.version,
      conclusions: bu.conclusions.map((c) => ({ id: c.id, type: c.type, statement: c.statement, epistemicStatus: c.epistemicStatus })),
      promotedCount: s.provenance.businessUnderstanding.filter((p) => p.sourceType === 'PROMOTED_LEARNING').length,
    },
    founderStrategicContext: {
      nativeCounts: { goals: fsc.goals.length, constraints: fsc.constraints.length, resources: fsc.resources.length, strategicPreferences: fsc.strategicPreferences.length, decisionHorizons: fsc.decisionHorizons.length },
      promotedLearnings: fsc.promotedLearnings.map((p) => ({ statement: p.statement, revision: p.learningRevisionNumber, scope: p.scope, rationale: p.rationale, epistemicStatus: p.epistemicStatus })),
    },
    provenance: s.provenance,
    // reminders — a snapshot mutates nothing and regenerates nothing (L3, L5, L9)
    doesNotModifyContext: true, doesNotModifyLearning: true, doesNotRegenerate: true,
  };
}
