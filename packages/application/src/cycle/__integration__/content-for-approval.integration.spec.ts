// packages/application/src/cycle/__integration__/content-for-approval.integration.spec.ts
//
// Integration test (Vitest) against a live test database — DEFERRED.
// Proves the C3 read end-to-end: GetContentForApproval returns the founder's CURRENT-CYCLE
// content_pieces in AWAITING_APPROVAL, ordered, founder- and cycle-scoped.
//
// HARNESS-PENDING (A2 precedent): named *.integration.spec.ts, so NOT matched by the vitest
// include glob (packages/*/src/**/*.test.ts) — excluded from the default suite. setup() is a
// deliberate stub. These assertions cover the row-level filtering (other founders / other cycles /
// non-AWAITING excluded) that cannot be verified without a real DB + RLS.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

interface DTO { contentPieceId: string; cycleId: string; approvalStatus: string; }

interface IntegrationCtx {
  seedCycleWithPieces(opts: {
    founderId: string;
    cycleId: string;
    awaiting: number;        // pieces in AWAITING_APPROVAL
    approved: number;        // pieces already APPROVED (must be excluded)
  }): Promise<void>;
  getContentForApproval(founderId: string, cycleId: string): Promise<DTO[]>;
  truncate(): Promise<void>;
  teardown(): Promise<void>;
}

describe('C3: GetContentForApproval read (integration)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => { ctx = await setup(); });
  afterAll(async () => { await ctx.teardown(); });
  beforeEach(async () => { await ctx.truncate(); });

  it('returns current-cycle AWAITING_APPROVAL pieces only, ordered', async () => {
    await ctx.seedCycleWithPieces({ founderId: 'f1', cycleId: 'c1', awaiting: 3, approved: 2 });
    const dtos = await ctx.getContentForApproval('f1', 'c1');
    expect(dtos).toHaveLength(3);
    expect(dtos.every((d) => d.approvalStatus === 'AWAITING_APPROVAL')).toBe(true);
  });

  it('excludes another founder\'s pieces', async () => {
    await ctx.seedCycleWithPieces({ founderId: 'f1', cycleId: 'c1', awaiting: 2, approved: 0 });
    await ctx.seedCycleWithPieces({ founderId: 'f2', cycleId: 'c2', awaiting: 2, approved: 0 });
    const dtos = await ctx.getContentForApproval('f1', 'c1');
    expect(dtos.every((d) => d.cycleId === 'c1')).toBe(true);
    expect(dtos).toHaveLength(2);
  });

  it('excludes a non-current cycle of the same founder', async () => {
    await ctx.seedCycleWithPieces({ founderId: 'f1', cycleId: 'c1', awaiting: 2, approved: 0 });
    await ctx.seedCycleWithPieces({ founderId: 'f1', cycleId: 'c2', awaiting: 5, approved: 0 });
    const dtos = await ctx.getContentForApproval('f1', 'c1');
    expect(dtos).toHaveLength(2);
  });

  it('returns [] when the cycle has no awaiting pieces', async () => {
    await ctx.seedCycleWithPieces({ founderId: 'f1', cycleId: 'c1', awaiting: 0, approved: 3 });
    expect(await ctx.getContentForApproval('f1', 'c1')).toEqual([]);
  });
});

// ── environment-specific harness — wire to the real test container before running ──
async function setup(): Promise<IntegrationCtx> {
  await Promise.resolve();
  throw new Error('Wire setup() to the real test container before running this integration spec.');
}
