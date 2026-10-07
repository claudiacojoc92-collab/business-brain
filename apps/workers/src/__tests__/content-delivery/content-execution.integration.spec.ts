// apps/workers/src/__tests__/content-delivery/content-execution.integration.spec.ts
//
// Integration test (Vitest) against a live test database — DEFERRED.
// Proves the CEL end-to-end claim (CEL Spec V1.1):
//   BriefCommitted → content_pieces (AWAITING_APPROVAL) → ContentReadyForReview,
//   idempotent and transactional.
//
// HARNESS-PENDING (A2 precedent): this file is named *.integration.spec.ts and is NOT matched
// by the vitest include glob (apps/workers/src/**/*.test.ts), so it is excluded from the default
// suite. setup() is a deliberate stub. The ASSERTIONS are the contract; wire setup() to a real
// Postgres + Redis harness (the production worker composition) to run it. These assertions cover
// the DB-transaction behaviours that cannot be unit-tested without a real connection:
// all-or-nothing persistence (content_pieces + consumed_events + ContentReadyForReview), and
// rollback leaving NO rows on failure.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

interface PieceRow { id: string; approval_status: string; piece_type: string; brief_id: string; }
interface EventRow { event_type: string; payload: Record<string, unknown>; }

interface IntegrationCtx {
  /** Seed a founder + a committed brief; returns { cycleId, founderId, briefId, eventId }. */
  seedCommittedBrief(opts: { isFallback: boolean }): Promise<{ cycleId: string; founderId: string; briefId: string; eventId: string }>;
  /** Drive the worker for a delivered BriefCommitted/FallbackBriefCommitted event. */
  deliver(eventId: string): Promise<void>;
  contentPieces(cycleId: string): Promise<PieceRow[]>;
  domainEvents(cycleId: string): Promise<EventRow[]>;
  consumedEvents(eventId: string): Promise<number>;
  /** Force the next generation to fail unrecoverably (e.g. NEVER-list). */
  forceFailure(): void;
  truncate(): Promise<void>;
  teardown(): Promise<void>;
}

describe('CEL: BriefCommitted → content_pieces → ContentReadyForReview (integration)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => { ctx = await setup(); });
  afterAll(async () => { await ctx.teardown(); });
  beforeEach(async () => { await ctx.truncate(); });

  it('persists pieces AWAITING_APPROVAL and emits ContentReadyForReview', async () => {
    const { cycleId, eventId } = await ctx.seedCommittedBrief({ isFallback: false });
    await ctx.deliver(eventId);

    const pieces = await ctx.contentPieces(cycleId);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((p) => p.approval_status === 'AWAITING_APPROVAL')).toBe(true);

    const events = await ctx.domainEvents(cycleId);
    const ready = events.find((e) => e.event_type === 'cycle.ContentExecution.ContentReadyForReview');
    expect(ready?.payload.piece_count).toBe(pieces.length);
    expect(await ctx.consumedEvents(eventId)).toBe(1);
  });

  it('is idempotent: redelivery does not double-write', async () => {
    const { cycleId, eventId } = await ctx.seedCommittedBrief({ isFallback: false });
    await ctx.deliver(eventId);
    const first = (await ctx.contentPieces(cycleId)).length;
    await ctx.deliver(eventId); // redelivery
    expect((await ctx.contentPieces(cycleId)).length).toBe(first);
    expect(await ctx.consumedEvents(eventId)).toBe(1);
  });

  it('rolls back fully on failure: no content_pieces, ContentGenerationFailed emitted', async () => {
    const { cycleId, eventId } = await ctx.seedCommittedBrief({ isFallback: false });
    ctx.forceFailure();
    await ctx.deliver(eventId);

    expect(await ctx.contentPieces(cycleId)).toHaveLength(0);
    expect(await ctx.consumedEvents(eventId)).toBe(0); // claim rolled back with the pieces
    const events = await ctx.domainEvents(cycleId);
    expect(events.some((e) => e.event_type === 'cycle.ContentExecution.ContentGenerationFailed')).toBe(true);
  });

  it('handles FallbackBriefCommitted on the same path (pieces link the fallback brief)', async () => {
    const { cycleId, eventId, briefId } = await ctx.seedCommittedBrief({ isFallback: true });
    await ctx.deliver(eventId);
    const pieces = await ctx.contentPieces(cycleId);
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.every((p) => p.brief_id === briefId)).toBe(true);
  });
});

// ── environment-specific harness — wire to the real worker composition before running ──
async function setup(): Promise<IntegrationCtx> {
  await Promise.resolve();
  throw new Error('Wire setup() to a real Postgres + Redis harness before running this integration spec.');
}
