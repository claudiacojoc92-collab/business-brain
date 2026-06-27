// packages/application/src/cycle/__integration__/current-review-cycle.integration.spec.ts
//
// Integration test (Vitest) against a live test database — DEFERRED.
// Proves the resolver end-to-end: the founder's latest COMMITTED/FALLBACK_COMMITTED cycle is
// returned (FAILED + in-flight excluded), deterministically ordered, founder-scoped.
//
// HARNESS-PENDING (A2 precedent): named *.integration.spec.ts, NOT matched by the vitest include
// glob (packages/*/src/**/*.test.ts) — excluded from the default suite. setup() is a deliberate
// stub covering row-level filtering/ordering that needs a real DB.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

interface IntegrationCtx {
  seedCycle(opts: { founderId: string; cycleId: string; status: string; committedAt: string | null }): Promise<void>;
  resolve(founderId: string): Promise<{ id: string } | null>;
  truncate(): Promise<void>;
  teardown(): Promise<void>;
}

describe('Current review cycle resolver (integration)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => { ctx = await setup(); });
  afterAll(async () => { await ctx.teardown(); });
  beforeEach(async () => { await ctx.truncate(); });

  it('returns the latest reviewable cycle by committed_at', async () => {
    await ctx.seedCycle({ founderId: 'f1', cycleId: 'old', status: 'COMMITTED', committedAt: '2026-06-01T00:00:00Z' });
    await ctx.seedCycle({ founderId: 'f1', cycleId: 'new', status: 'COMMITTED', committedAt: '2026-06-20T00:00:00Z' });
    expect((await ctx.resolve('f1'))?.id).toBe('new');
  });

  it('treats FALLBACK_COMMITTED as reviewable and excludes FAILED + in-flight', async () => {
    await ctx.seedCycle({ founderId: 'f1', cycleId: 'failed', status: 'FAILED', committedAt: null });
    await ctx.seedCycle({ founderId: 'f1', cycleId: 'collecting', status: 'COLLECTING', committedAt: null });
    await ctx.seedCycle({ founderId: 'f1', cycleId: 'fb', status: 'FALLBACK_COMMITTED', committedAt: '2026-06-10T00:00:00Z' });
    expect((await ctx.resolve('f1'))?.id).toBe('fb');
  });

  it('is founder-scoped', async () => {
    await ctx.seedCycle({ founderId: 'f2', cycleId: 'other', status: 'COMMITTED', committedAt: '2026-06-20T00:00:00Z' });
    expect(await ctx.resolve('f1')).toBeNull();
  });

  it('returns null when no reviewable cycle exists', async () => {
    await ctx.seedCycle({ founderId: 'f1', cycleId: 'collecting', status: 'COLLECTING', committedAt: null });
    expect(await ctx.resolve('f1')).toBeNull();
  });
});

// ── environment-specific harness — wire to the real test container before running ──
async function setup(): Promise<IntegrationCtx> {
  await Promise.resolve();
  throw new Error('Wire setup() to the real test container before running this integration spec.');
}
