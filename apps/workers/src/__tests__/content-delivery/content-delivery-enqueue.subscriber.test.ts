import { describe, it, expect, vi } from 'vitest';
import { ContentDeliveryEnqueueSubscriber } from '../../content-delivery/content-delivery-enqueue.subscriber';
import type { DomainEventEnvelope } from '@bb/shared';

type Handler = (e: DomainEventEnvelope) => Promise<void>;

function makeEnvelope(eventType: string, isFallback: boolean): DomainEventEnvelope {
  return {
    event_id:       'evt-1',
    event_type:     eventType,
    schema_version: 1,
    stream_id:      'weeklycycle:cycle-1',
    event_number:   BigInt(7),
    emitted_by:     'bb-api',
    emitted_at:     new Date('2026-06-27T10:00:00.000Z'),
    correlation_id: 'corr-1',
    causation_id:   null,
    trace_id:       'trace-1',
    payload: { cycleId: 'cycle-1', founderId: 'founder-1', briefId: 'brief-1', isFallback },
  };
}

function setup() {
  const handlers = new Map<string, Handler>();
  const eventBus = { subscribe: vi.fn((t: string, h: Handler) => handlers.set(t, h)), publish: vi.fn() };
  const queueRegistry = { enqueueContentDelivery: vi.fn(async () => undefined) };
  const sub = new ContentDeliveryEnqueueSubscriber(eventBus as never, queueRegistry as never);
  sub.register();
  return { handlers, eventBus, queueRegistry };
}

describe('ContentDeliveryEnqueueSubscriber', () => {
  it('subscribes to BriefCommitted and FallbackBriefCommitted', () => {
    const { handlers } = setup();
    expect(handlers.has('cycle.WeeklyCycle.BriefCommitted')).toBe(true);
    expect(handlers.has('cycle.WeeklyCycle.FallbackBriefCommitted')).toBe(true);
  });

  it('maps BriefCommitted → CONTENT_DELIVERY enqueue (isFallback false)', async () => {
    const { handlers, queueRegistry } = setup();
    await handlers.get('cycle.WeeklyCycle.BriefCommitted')!(makeEnvelope('cycle.WeeklyCycle.BriefCommitted', false));

    expect(queueRegistry.enqueueContentDelivery).toHaveBeenCalledTimes(1);
    expect(queueRegistry.enqueueContentDelivery).toHaveBeenCalledWith(expect.objectContaining({
      jobType:    'CONTENT_DELIVERY',
      jobId:      'cel-evt-1',     // deterministic (event-derived) AND colon-free
      eventId:    'evt-1',
      cycleId:    'cycle-1',
      briefId:    'brief-1',
      founderId:  'founder-1',
      isFallback: false,
      correlationId: 'corr-1',
      traceId:    'trace-1',
    }));
    // Guard the regression: BullMQ rejects ':' in a custom jobId. Fail if it is reintroduced.
    const { jobId } = (queueRegistry.enqueueContentDelivery as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(jobId).not.toContain(':');
    expect(jobId).toBe('cel-evt-1');
  });

  it('maps FallbackBriefCommitted → CONTENT_DELIVERY enqueue (isFallback true)', async () => {
    const { handlers, queueRegistry } = setup();
    await handlers.get('cycle.WeeklyCycle.FallbackBriefCommitted')!(
      makeEnvelope('cycle.WeeklyCycle.FallbackBriefCommitted', true),
    );
    expect(queueRegistry.enqueueContentDelivery).toHaveBeenCalledWith(expect.objectContaining({ isFallback: true }));
  });
});
