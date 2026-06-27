import { generateId } from '@bb/shared';
import type { DomainEventEnvelope } from '@bb/shared';

/**
 * Content Execution Layer outbound events (CEL Spec V1.1 §ContentReadyForReview /
 * ContentGenerationFailed). Emitted by the ContentDeliveryWorker via the transactional
 * outbox (app.domain_events). These are not aggregate-stream events, so the envelope is
 * constructed directly; stream_id namespaces by cycle and event_number is fixed at 1
 * (the domain_events stream index is non-unique; the PK is event_id).
 */

export const CONTENT_READY_FOR_REVIEW = 'cycle.ContentExecution.ContentReadyForReview';
export const CONTENT_GENERATION_FAILED = 'cycle.ContentExecution.ContentGenerationFailed';

export interface ContentReadyForReviewPayload {
  cycle_id: string;
  founder_id: string;
  piece_count: number;
  ready_at: string;
}

export interface ContentGenerationFailedPayload {
  cycle_id: string;
  founder_id: string;
  failed_at: string;
  failure_reason: string;
}

export interface CelEventMeta {
  cycleId: string;
  correlationId: string;
  traceId: string;
  /** event_id of the triggering BriefCommitted/FallbackBriefCommitted. */
  causationId: string;
  now: Date;
}

function envelope<T>(
  eventType: string,
  meta: CelEventMeta,
  payload: T,
): DomainEventEnvelope<T> {
  return {
    event_id:       generateId(),
    event_type:     eventType,
    schema_version: 1,
    stream_id:      `contentexecution:${meta.cycleId}`,
    event_number:   BigInt(1),
    emitted_by:     'bb-workers',
    emitted_at:     meta.now,
    correlation_id: meta.correlationId,
    causation_id:   meta.causationId,
    trace_id:       meta.traceId,
    payload,
  };
}

export function buildContentReadyForReview(
  meta: CelEventMeta,
  founderId: string,
  pieceCount: number,
): DomainEventEnvelope<ContentReadyForReviewPayload> {
  return envelope(CONTENT_READY_FOR_REVIEW, meta, {
    cycle_id:    meta.cycleId,
    founder_id:  founderId,
    piece_count: pieceCount,
    ready_at:    meta.now.toISOString(),
  });
}

export function buildContentGenerationFailed(
  meta: CelEventMeta,
  founderId: string,
  failureReason: string,
): DomainEventEnvelope<ContentGenerationFailedPayload> {
  return envelope(CONTENT_GENERATION_FAILED, meta, {
    cycle_id:       meta.cycleId,
    founder_id:     founderId,
    failed_at:      meta.now.toISOString(),
    failure_reason: failureReason,
  });
}
