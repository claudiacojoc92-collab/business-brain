// apps/api/src/__tests__/__integration__/current-review-routes.integration.spec.ts
//
// Integration test (Vitest) against a live API + database — DEFERRED.
// Proves the two GET endpoints end-to-end: resolve current review cycle → existing handler DTOs,
// founder-scoped, with the established null/empty pathways.
//
// HARNESS-PENDING (A2 precedent): named *.integration.spec.ts, NOT matched by the vitest include
// glob (apps/api/src/**/*.test.ts) — excluded from the default suite. setup() is a deliberate stub.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

interface InjectResult { statusCode: number; json(): unknown }

interface IntegrationCtx {
  seedReviewCycleWithContent(opts: { founderId: string; pieces: number }): Promise<void>;
  get(path: string, founderId: string): Promise<InjectResult>;
  truncate(): Promise<void>;
  teardown(): Promise<void>;
}

describe('Current review routes (integration)', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => { ctx = await setup(); });
  afterAll(async () => { await ctx.teardown(); });
  beforeEach(async () => { await ctx.truncate(); });

  it('GET /cycles/current/brief returns the committed brief for the resolved cycle', async () => {
    await ctx.seedReviewCycleWithContent({ founderId: 'f1', pieces: 3 });
    const res = await ctx.get('/v1/founders/me/cycles/current/brief', 'f1');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { briefId: string }).briefId).toBeTruthy();
  });

  it('GET /cycles/current/content returns the AWAITING_APPROVAL list', async () => {
    await ctx.seedReviewCycleWithContent({ founderId: 'f1', pieces: 3 });
    const res = await ctx.get('/v1/founders/me/cycles/current/content', 'f1');
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBe(3);
  });

  it('GET /cycles/current/content → [] when the founder has no review cycle', async () => {
    const res = await ctx.get('/v1/founders/me/cycles/current/content', 'f-none');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /cycles/current/brief → 404 when the founder has no review cycle', async () => {
    const res = await ctx.get('/v1/founders/me/cycles/current/brief', 'f-none');
    expect(res.statusCode).toBe(404);
  });

  it('is founder-scoped: founder B cannot see founder A\'s content', async () => {
    await ctx.seedReviewCycleWithContent({ founderId: 'fA', pieces: 2 });
    const res = await ctx.get('/v1/founders/me/cycles/current/content', 'fB');
    expect(res.json()).toEqual([]);
  });
});

// ── environment-specific harness — wire to the real API + test container before running ──
async function setup(): Promise<IntegrationCtx> {
  await Promise.resolve();
  throw new Error('Wire setup() to the real API + test container before running this integration spec.');
}
