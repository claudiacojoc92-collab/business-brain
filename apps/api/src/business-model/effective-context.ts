/**
 * Wave 4 — Strategic Learning Promotion Gate REMEDIATION (ADR-013 amendment; contract C-1…C-9).
 *
 * The CANONICAL effective-context composer: the single authoritative answer to "what is the founder's current effective
 * Business Understanding / Founder Strategic Context?". Effective BU/FSC = the NATIVE records + the effective promoted
 * learning revisions (each pinned to its EXACT immutable revision). This is NOT an alias for ledger listing — it composes
 * native + promoted, preserves provenance (never flattens a promoted learning into a native record), and mutates nothing.
 *
 * The effective promoted set is derived from the explicit promotion sequence/predecessor chain (never createdAt alone) —
 * see `deriveEffectivePromotion` in ./strategic-learning-promotion. This module is pure: callers hydrate the native data,
 * the effective promotion events, and the pinned learning revisions; it composes them deterministically.
 *
 * Reasoning (assembleStrategicContext) intentionally does NOT consume this — that is the deferred, separately-governed
 * Strategic Learning Consumption Gate (contract C-7).
 */
import type { Understanding } from './understanding';
import type { FounderStrategicContextItem } from './founder-strategic-context';
import type { StrategicLearningRecord } from './strategic-learning';
import { deriveLifecycleStatus } from './strategic-learning';
import type { PromotionEvent, PromotionTarget } from './strategic-learning-promotion';

export type EffectiveSourceType = 'NATIVE_BUSINESS_UNDERSTANDING' | 'NATIVE_FOUNDER_STRATEGIC_CONTEXT' | 'PROMOTED_LEARNING';

/** Provenance for a promoted-learning effective item (contract C-4). Never flattened away. */
export interface PromotedLearningProvenance {
  promotionEventId: string;
  target: PromotionTarget;
  logicalLearningId: string;
  learningRevisionId: string;
  learningRevisionNumber: number;
  promotionSequence: number;
  epistemicStatus: string;            // from the PINNED revision (confidence) — not lifecycle
  lifecycleStatusAtRead: string;      // the thread's lifecycle status of the pinned revision, separately labelled
  originalSourceLineage: { reviewRecordId: string; reviewRevision: number; recommendationSessionId: string | null };
}

/** A canonical effective-context item. Native items and promoted-learning items are distinguished by `sourceType`. */
export interface EffectiveContextItem {
  id: string;
  target: PromotionTarget;
  sourceType: EffectiveSourceType;
  content: string;
  scope: string;
  rationale: string | null;
  provenance: PromotedLearningProvenance | { sourceType: 'NATIVE'; note: string };
  effectiveFrom: string;
}

/** The composed canonical Effective Business Understanding: the native versioned aggregate + promoted learning items. */
export interface EffectiveBusinessUnderstanding {
  target: 'BUSINESS_UNDERSTANDING';
  nativeBusinessUnderstanding: {
    sourceType: 'NATIVE_BUSINESS_UNDERSTANDING';
    present: boolean;
    version: number | null;
    conclusions: Understanding['conclusions'];
    createdAt: string | null;
  };
  promotedLearningItems: EffectiveContextItem[];
}

/** The composed canonical Effective Founder Strategic Context: native effective items + promoted learning items. */
export interface EffectiveFounderStrategicContext {
  target: 'FOUNDER_STRATEGIC_CONTEXT';
  nativeItems: EffectiveContextItem[];
  promotedLearningItems: EffectiveContextItem[];
}

/**
 * Build one promoted-learning effective item from an effective PromotionEvent + its EXACT pinned learning revision.
 * Returns null if the pinned revision cannot be read (defensive — the item is simply omitted, never fabricated).
 */
export function toPromotedLearningItem(event: PromotionEvent, pinned: StrategicLearningRecord | null): EffectiveContextItem | null {
  if (!pinned) return null;
  const provenance: PromotedLearningProvenance = {
    promotionEventId: event.id,
    target: event.target,
    logicalLearningId: event.logicalLearningId,
    learningRevisionId: event.learningRevisionId,
    learningRevisionNumber: event.revisionNumber,
    promotionSequence: event.promotionSequence,
    epistemicStatus: pinned.confidence,
    lifecycleStatusAtRead: deriveLifecycleStatus(pinned.lifecycleAction),
    originalSourceLineage: { reviewRecordId: pinned.reviewRecordId, reviewRevision: pinned.reviewRevision, recommendationSessionId: pinned.recommendationSessionId },
  };
  return {
    id: event.id,
    target: event.target,
    sourceType: 'PROMOTED_LEARNING',
    content: pinned.revisedUnderstanding,     // the EXACT pinned revision's understanding — never "latest"
    scope: event.scope,
    rationale: event.rationale,
    provenance,
    effectiveFrom: event.createdAt,
  };
}

/** Compose the canonical Effective Business Understanding (contract C-2). Deterministic; no dedup, no conflict inference. */
export function composeEffectiveBusinessUnderstanding(native: Understanding | null, promotedItems: EffectiveContextItem[]): EffectiveBusinessUnderstanding {
  return {
    target: 'BUSINESS_UNDERSTANDING',
    nativeBusinessUnderstanding: {
      sourceType: 'NATIVE_BUSINESS_UNDERSTANDING',
      present: !!native && native.conclusions.length > 0,
      version: native ? native.version : null,
      conclusions: native ? native.conclusions : [],
      createdAt: native ? native.createdAt : null,
    },
    promotedLearningItems: orderPromoted(promotedItems),
  };
}

/** Compose the canonical Effective Founder Strategic Context (contract C-2). Native FSC items kept distinct from promoted. */
export function composeEffectiveFounderStrategicContext(nativeItems: FounderStrategicContextItem[], promotedItems: EffectiveContextItem[]): EffectiveFounderStrategicContext {
  const native: EffectiveContextItem[] = nativeItems.map((it) => ({
    id: it.logicalItemId,
    target: 'FOUNDER_STRATEGIC_CONTEXT',
    sourceType: 'NATIVE_FOUNDER_STRATEGIC_CONTEXT',
    content: it.statement,
    scope: it.scope,
    rationale: null,
    provenance: { sourceType: 'NATIVE', note: 'founder-declared strategic context' },
    effectiveFrom: it.effectiveFrom,
  }));
  return { target: 'FOUNDER_STRATEGIC_CONTEXT', nativeItems: native, promotedLearningItems: orderPromoted(promotedItems) };
}

/** Deterministic, stable ordering of promoted items — newest promotion first, id-tiebroken. No semantic dedup. */
function orderPromoted(items: EffectiveContextItem[]): EffectiveContextItem[] {
  return [...items].sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? (a.id < b.id ? 1 : -1) : a.effectiveFrom < b.effectiveFrom ? 1 : -1));
}
