/**
 * Wave 4 — Strategic Learning Promotion Gate (ADR-013). The ONLY explicit path by which a founder promotes an EXACT
 * learning revision into Business Understanding (BU) or Founder Strategic Context (FSC). A SEPARATE append-only ledger:
 * it writes to NEITHER business.understanding NOR founder_strategic_context_item, edits no chain record, and regenerates
 * nothing. The effective promoted set is DERIVED from events (latest event per thread per target wins), never from the
 * latest learning revision. Promotion is governance, not evidence; explicit founder judgment only; no model authority.
 *
 * Governed by docs/governance/strategic-learning-promotion-contract.md (22 laws).
 */
import type { StrategicLearningRecord } from './strategic-learning';

export type PromotionTarget = 'BUSINESS_UNDERSTANDING' | 'FOUNDER_STRATEGIC_CONTEXT';
export const PROMOTION_TARGETS: ReadonlySet<string> = new Set(['BUSINESS_UNDERSTANDING', 'FOUNDER_STRATEGIC_CONTEXT']);
export type PromotionAction = 'PROMOTE' | 'REPLACE' | 'REMOVE';
export const PROMOTION_ACTIONS: ReadonlySet<string> = new Set(['PROMOTE', 'REPLACE', 'REMOVE']);
export type PromotionScope = 'OFFER' | 'CUSTOMER' | 'PRICING' | 'POSITIONING' | 'MESSAGING' | 'ACQUISITION' | 'RETENTION' | 'BUSINESS' | 'FOUNDER' | 'OTHER';
export const PROMOTION_SCOPES: ReadonlySet<string> = new Set(['OFFER', 'CUSTOMER', 'PRICING', 'POSITIONING', 'MESSAGING', 'ACQUISITION', 'RETENTION', 'BUSINESS', 'FOUNDER', 'OTHER']);

export interface PromotionEvent {
  id: string; founderId: string; target: PromotionTarget;
  logicalLearningId: string; learningRevisionId: string; revisionNumber: number;
  promotionAction: PromotionAction; rationale: string; scope: PromotionScope;
  idempotencyKey: string; createdAt: string;
}

export interface PromotionInput { target: PromotionTarget; scope: PromotionScope; rationale: string; idempotencyKey: string; }

export type PromotionRejection =
  | 'REVISION_NOT_READABLE' | 'INVALID_TARGET' | 'SCOPE_REQUIRED' | 'RATIONALE_REQUIRED' | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'ALREADY_PROMOTED' | 'NOT_PROMOTED';
export class PromotionValidationError extends Error {
  constructor(public readonly reason: PromotionRejection, message: string) { super(message); this.name = 'PromotionValidationError'; }
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Deterministically assert a promotion action is admissible. `revision` is the EXACT learning revision (Law 18),
 * owned by the founder; `currentlyPromoted` is whether this thread is currently promoted for the target (derived from
 * events). No model, no similarity, no lifecycle inference.
 */
export function assertPromotionAdmissible(revision: StrategicLearningRecord | null, currentlyPromoted: boolean, action: PromotionAction, input: PromotionInput): void {
  if (!revision) throw new PromotionValidationError('REVISION_NOT_READABLE', 'You can only promote a specific learning revision you own.');
  if (!input.target || !PROMOTION_TARGETS.has(input.target)) throw new PromotionValidationError('INVALID_TARGET', 'Choose Business Understanding or Founder Strategic Context.');
  if (!input.scope || !PROMOTION_SCOPES.has(input.scope)) throw new PromotionValidationError('SCOPE_REQUIRED', 'Choose what this promotion is about.');
  if (!s(input.rationale)) throw new PromotionValidationError('RATIONALE_REQUIRED', 'Say, in your words, why this learning should shape your Business Understanding.');
  if (!s(input.idempotencyKey)) throw new PromotionValidationError('IDEMPOTENCY_KEY_REQUIRED', 'A promotion requires an idempotency key.');
  if (action === 'PROMOTE' && currentlyPromoted) throw new PromotionValidationError('ALREADY_PROMOTED', 'This learning is already promoted here — replace or remove it instead.');
  if ((action === 'REPLACE' || action === 'REMOVE') && !currentlyPromoted) throw new PromotionValidationError('NOT_PROMOTED', 'This learning is not currently promoted here.');
}

/** Build the immutable event fields from the promoted revision + input. Pins the EXACT revision (Laws 5, 18). */
export function buildPromotionFields(revision: StrategicLearningRecord, action: PromotionAction, input: PromotionInput): Omit<PromotionEvent, 'id' | 'founderId' | 'createdAt'> {
  return {
    target: input.target, logicalLearningId: revision.logicalLearningId, learningRevisionId: revision.id, revisionNumber: revision.revision,
    promotionAction: action, rationale: s(input.rationale).slice(0, 4000), scope: input.scope, idempotencyKey: s(input.idempotencyKey).slice(0, 200),
  };
}

/**
 * Derive the effective promoted set for one target: for each logical learning thread, the LATEST event wins
 * (Laws 5, 6, 12). PROMOTE/REPLACE → the pinned revision is promoted; REMOVE → not promoted. Never the latest learning
 * revision. Deterministic ordering by createdAt then id.
 */
export function deriveEffectivePromotion(events: PromotionEvent[], target: PromotionTarget): PromotionEvent[] {
  const latestByThread = new Map<string, PromotionEvent>();
  const ordered = [...events].filter((e) => e.target === target).sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
  for (const e of ordered) latestByThread.set(e.logicalLearningId, e); // last (latest) wins
  return [...latestByThread.values()].filter((e) => e.promotionAction !== 'REMOVE').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Is this thread currently promoted for the target? (derived) */
export function isThreadPromoted(events: PromotionEvent[], target: PromotionTarget, logicalLearningId: string): boolean {
  return deriveEffectivePromotion(events, target).some((e) => e.logicalLearningId === logicalLearningId);
}

/** Founder-safe view of a promotion event. */
export function toPromotionView(e: PromotionEvent) {
  return {
    promotionId: e.id, target: e.target, promotionAction: e.promotionAction, scope: e.scope, rationale: e.rationale,
    learning: { logicalLearningId: e.logicalLearningId, revisionId: e.learningRevisionId, revision: e.revisionNumber },
    createdAt: e.createdAt,
    // constant reminders — promotion changes nothing else and regenerates nothing (Laws 4, 15, 16)
    doesNotModifyLearning: true, doesNotModifyReview: true, doesNotModifyPlan: true, doesNotModifyCommitment: true,
    doesNotModifyDecision: true, regeneratesRecommendations: false,
  };
}
