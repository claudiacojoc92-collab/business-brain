// packages/application/src/cycle/__integration__/cycle-brief-hydration.integration.spec.ts
//
// Integration test (Vitest) against a live test database — DEFERRED.
// Proves C1 end-to-end: GetCycleBrief returns the REAL committed brief hydrated from
// cycle.internal_briefs (C2 Phase A read-back), founder-scoped.
//
// HARNESS-PENDING (A2 precedent): named *.integration.spec.ts, NOT matched by the vitest
// include glob (packages/*/src/**/*.test.ts) — excluded from the default suite. setup() is a
// deliberate stub covering the row-level founder isolation that needs a real DB.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

interface BriefDTO { briefId: string; briefConfidence: number; validationResult: string; isFallback: boolean; }

interface IntegrationCtx {
  seedCommittedBrief(opts: { founderId: string; cycleId: string; briefId: string; isFallback: boolean }): Promise<void>;
  getCycleBrief(founderId: string, cycleId: string): Promise<BriefDTO>;
  truncate(): Promise<void>;
  teardown(): Promise<void>;
}

describe('C1: GetCycleBrief hydration (integration)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => { ctx = await setup(); });
  afterAll(async () => { await ctx.teardown(); });
  beforeEach(async () => { await ctx.truncate(); });

  it('returns the real brief id + fields for a committed brief', async () => {
    await ctx.seedCommittedBrief({ founderId: 'f1', cycleId: 'c1', briefId: 'b1', isFallback: false });
    const dto = await ctx.getCycleBrief('f1', 'c1');
    expect(dto.briefId).toBe('b1');
    expect(dto.briefConfidence).toBeGreaterThan(0);
    expect(dto.isFallback).toBe(false);
  });

  it('surfaces is_fallback + validation_result for a fallback brief', async () => {
    await ctx.seedCommittedBrief({ founderId: 'f1', cycleId: 'c1', briefId: 'b1', isFallback: true });
    const dto = await ctx.getCycleBrief('f1', 'c1');
    expect(dto.isFallback).toBe(true);
    expect(dto.validationResult).toBeTruthy();
  });

  it('does not return another founder\'s brief', async () => {
    await ctx.seedCommittedBrief({ founderId: 'f1', cycleId: 'c1', briefId: 'b1', isFallback: false });
    await expect(ctx.getCycleBrief('f2', 'c1')).rejects.toMatchObject({ code: 'CYCLE_NOT_FOUND' });
  });
});

// ── environment-specific harness — wire to the real test container before running ──
async function setup(): Promise<IntegrationCtx> {
  await Promise.resolve();
  throw new Error('Wire setup() to the real test container before running this integration spec.');
}
