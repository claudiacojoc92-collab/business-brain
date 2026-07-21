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
  // V080 explicit deterministic lineage (contract C-8): effective state derives from this chain, never createdAt alone.
  promotionSequence: number; predecessorPromotionEventId: string | null;
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

/** Build the immutable content fields from the promoted revision + input. Pins the EXACT revision (Laws 5, 18). Lineage
 * (`promotionSequence`, `predecessorPromotionEventId`) is computed separately by the repository under the chain lock. */
export function buildPromotionFields(revision: StrategicLearningRecord, action: PromotionAction, input: PromotionInput): Omit<PromotionEvent, 'id' | 'founderId' | 'createdAt' | 'promotionSequence' | 'predecessorPromotionEventId'> {
  return {
    target: input.target, logicalLearningId: revision.logicalLearningId, learningRevisionId: revision.id, revisionNumber: revision.revision,
    promotionAction: action, rationale: s(input.rationale).slice(0, 4000), scope: input.scope, idempotencyKey: s(input.idempotencyKey).slice(0, 200),
  };
}

/**
 * The head of one thread's chain for a target = the highest-`promotionSequence` event (contract C-8). This is the single
 * source of truth for "current effective promotion of this thread" — derived from the EXPLICIT sequence chain, NEVER from
 * `createdAt`. Returns null if the thread has no events for the target.
 */
export function chainHead(events: PromotionEvent[], target: PromotionTarget, logicalLearningId: string): PromotionEvent | null {
  const chain = events.filter((e) => e.target === target && e.logicalLearningId === logicalLearningId);
  if (chain.length === 0) return null;
  return chain.reduce((hi, e) => (e.promotionSequence > hi.promotionSequence ? e : hi));
}

/**
 * Derive the effective promoted set for one target: for each logical learning thread, the CHAIN HEAD (highest sequence)
 * wins (contract C-8; Laws 5, 6, 12). PROMOTE/REPLACE → the pinned revision is promoted; REMOVE → not promoted. Never the
 * latest learning revision, never createdAt ordering. Deterministic stable ordering of the result by (sequence desc, id).
 */
export function deriveEffectivePromotion(events: PromotionEvent[], target: PromotionTarget): PromotionEvent[] {
  const heads = new Map<string, PromotionEvent>();
  for (const e of events) {
    if (e.target !== target) continue;
    const cur = heads.get(e.logicalLearningId);
    if (!cur || e.promotionSequence > cur.promotionSequence) heads.set(e.logicalLearningId, e);
  }
  return [...heads.values()]
    .filter((e) => e.promotionAction !== 'REMOVE')
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
}

/** Is this thread currently promoted for the target? (derived from the chain head) */
export function isThreadPromoted(events: PromotionEvent[], target: PromotionTarget, logicalLearningId: string): boolean {
  const head = chainHead(events, target, logicalLearningId);
  return head != null && head.promotionAction !== 'REMOVE';
}

/**
 * Compute the lineage fields for the NEXT event on a thread's chain (contract C-8). Given the thread's current events for
 * the target: sequence = head.sequence + 1 (or 1 for a fresh chain); predecessor = head.id (or null at sequence 1). The
 * first event must be a PROMOTE; a re-PROMOTE after a REMOVE is simply the next sequence pointing at the REMOVE head.
 */
export function nextLineage(events: PromotionEvent[], target: PromotionTarget, logicalLearningId: string): { promotionSequence: number; predecessorPromotionEventId: string | null } {
  const head = chainHead(events, target, logicalLearningId);
  return head ? { promotionSequence: head.promotionSequence + 1, predecessorPromotionEventId: head.id } : { promotionSequence: 1, predecessorPromotionEventId: null };
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
