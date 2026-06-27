// packages/application/src/cycle/__integration__/approval-load.integration.spec.ts
//
// Integration test (Vitest) against a live test database — DEFERRED.
// Proves the C4 load-swap end-to-end: the approval path loads the REAL persisted
// content_piece by id, founder-scoped, and acts on it.
//
// HARNESS-PENDING (A2 precedent): named *.integration.spec.ts, NOT matched by the vitest
// include glob (packages/*/src/**/*.test.ts) — excluded from the default suite. setup() is a
// deliberate stub. These assertions cover the row-level founder isolation that cannot be
// verified without a real DB.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

interface IntegrationCtx {
  seedPiece(opts: { founderId: string; cycleId: string; pieceId: string }): Promise<void>;
  loadForApproval(founderId: string, pieceId: string): Promise<{ id: string } | null>;
  approve(founderId: string, pieceId: string): Promise<void>;
  pieceStatus(pieceId: string): Promise<string | null>;
  truncate(): Promise<void>;
  teardown(): Promise<void>;
}

describe('C4: approval real-piece load (integration)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => { ctx = await setup(); });
  afterAll(async () => { await ctx.teardown(); });
  beforeEach(async () => { await ctx.truncate(); });

  it('loads the real piece by id for its founder and approves it', async () => {
    await ctx.seedPiece({ founderId: 'f1', cycleId: 'c1', pieceId: 'p1' });
    const loaded = await ctx.loadForApproval('f1', 'p1');
    expect(loaded?.id).toBe('p1');

    await ctx.approve('f1', 'p1');
    expect(await ctx.pieceStatus('p1')).toBe('APPROVED');
  });

  it('does not load another founder\'s piece (cross-founder isolation)', async () => {
    await ctx.seedPiece({ founderId: 'f1', cycleId: 'c1', pieceId: 'p1' });
    expect(await ctx.loadForApproval('f2', 'p1')).toBeNull();
  });

  it('unknown id resolves to not-found (no piece)', async () => {
    expect(await ctx.loadForApproval('f1', 'ghost')).toBeNull();
  });
});

// ── environment-specific harness — wire to the real test container before running ──
async function setup(): Promise<IntegrationCtx> {
  await Promise.resolve();
  throw new Error('Wire setup() to the real test container before running this integration spec.');
}
