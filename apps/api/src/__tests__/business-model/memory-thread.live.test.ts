import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { recomputeFromSources } from '../../business-model/recompute';
import { buildWhatMattersNow } from '../../business-model/what-matters';
import { buildDeclaredFragments } from '../../business-model/declared';
import { PgThreadRepository } from '../../business-model/pg-thread.repository';
import { reconcileThreadsOnRecompute, readMemoryThreadState, resolveByDecision } from '../../business-model/thread-service';
import { captureDecision } from '../../business-model/decision';

/**
 * Business Memory v1 — LIVE two-session gate. Real Postgres (V052), real frozen engine. Proves threads
 * PERSIST across sessions (read back through SEPARATE DB connections), open on a real recompute, recur
 * (not re-create) across recomputes despite tensionId churn, carry a proactive follow-up on return, and
 * resolve on a grounded Decision — with dangling=0 and honest attribution.
 *
 * R2: the Anthropic key is read from the running app's .env via a Node parser here, never shell-sourced
 * and never printed. Skips (does not fail) if the key or DB is unavailable.
 */
function loadKey(): string {
  try {
    for (const line of readFileSync('/Users/claudiacojoc/Desktop/business_brain/.env', 'utf8').split('\n')) {
      const m = line.match(/^ANTHROPIC_API_KEY=(.*)$/); if (m && m[1]) return m[1].trim();
    }
  } catch { /* ignore */ }
  return process.env['ANTHROPIC_API_KEY'] ?? '';
}
const ANTHROPIC = loadKey();
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const FID = 'memory-gate-founder';
const PAGE = 'https://acme.co/';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbW: any, dbR: any;
let dbUp = false; // set only if the DB is reachable — the guard that keeps a DB-less unit CI green
const inferredOf = (a: EvidenceFragment[]) => a.filter((f) => f.confidenceKind === 'inferred');

beforeAll(async () => {
  if (!ANTHROPIC) return; // no key → the test skips; don't even probe the DB
  try {
    dbW = createKyselyClient(DB_URL); dbR = createKyselyClient(DB_URL);
    for (const t of ['evidence.fragments', 'memory.thread_events', 'memory.threads']) {
      await dbW.deleteFrom(t).where('founder_id', '=', FID).execute(); // also probes reachability
    }
    dbUp = true;
  } catch { dbUp = false; } // DB unavailable → skip cleanly (never red a DB-less unit CI)
});
afterAll(async () => { try { await dbW?.destroy(); } catch { /* ignore */ } try { await dbR?.destroy(); } catch { /* ignore */ } });

describe('Memory v1 §LIVE — two-session thread persistence (real DB + frozen engine)', () => {
  it('opens → persists → follow-up → recurs → resolves(decision), across sessions, dangling=0', { timeout: 600_000 }, async (ctx) => {
    if (!ANTHROPIC || !dbUp) { ctx.skip(); return; } // no key or no DB → SKIP, keep the unit suite green
    const repoW = new PgEvidenceRepository(dbW);
    const threadsW = new PgThreadRepository(dbW);

    // ── Seed: a stark declared-intent vs observed-website contradiction ─────────────────────────
    const declaredFrags = buildDeclaredFragments(FID, [{ field: 'direction', text: 'We are an enterprise-first, sales-led company. We win six-figure annual contracts through a high-touch enterprise sales team and long procurement cycles.' }]);
    const pageText = 'Free forever. Sign up in thirty seconds — no credit card and no sales call, ever. Acme is built for solo makers and tiny teams who just want to get started today. Self-serve onboarding, flat simple pricing, cancel anytime.';
    const obs: EvidenceFragment[] = [
      makeFragment({ founderId: FID, source: 'website', sourceUrl: PAGE, confidenceKind: 'observed', visibility: 'public', payload: { text: pageText, pageType: 'home' } }),
      ...['Free forever. Sign up in thirty seconds — no credit card and no sales call, ever.', 'Acme is built for solo makers and tiny teams who just want to get started today.', 'Self-serve onboarding, flat simple pricing, cancel anytime.']
        .map((t) => makeFragment({ founderId: FID, source: 'website', sourceUrl: PAGE, confidenceKind: 'observed', visibility: 'public', payload: { kind: 'block', text: t } })),
    ];
    await repoW.appendMany([...declaredFrags, ...obs]);

    // ── SESSION 1 — real recompute → thread opens + persists ────────────────────────────────────
    const rec1 = await recomputeFromSources({ founderId: FID, repo: repoW, anthropicApiKey: ANTHROPIC });
    const all1 = await repoW.findByFounder(FID);
    const items1 = buildWhatMattersNow(inferredOf(all1), all1);
    expect(items1.length, 'engine must surface at least one grounded declared↔observed tension').toBeGreaterThanOrEqual(1);
    const threadsAfter1 = await reconcileThreadsOnRecompute(FID, all1, threadsW, new Date('2026-02-01T00:00:00Z'));
    expect(threadsAfter1.some((t) => t.status === 'open'), 'at least one thread opened on session 1').toBe(true);
    const session1Sigs = new Set(threadsAfter1.map((t) => t.signature));

    // persistence: read back through a SEPARATE connection
    const persisted1 = await new PgThreadRepository(dbR).load(FID);
    expect(persisted1.length).toBe(threadsAfter1.length);
    expect(persisted1.every((t) => t.status === 'open')).toBe(true);

    // ── SESSION 2 (returning) — state + proactive follow-up, from persisted DB (no recompute) ────
    const state = await readMemoryThreadState(FID, new PgEvidenceRepository(dbR), new PgThreadRepository(dbR));
    expect(state.followUp, 'returning session has a proactive follow-up').not.toBeNull();
    expect(state.followUp!.statement.length).toBeGreaterThan(0);
    expect(state.whatMattersNow[0]!.mark).toBe('new'); // first appearance → open → "new"

    // ── RECURRING — recompute again on the SAME evidence → same thread recurs (not re-created) ───
    await repoW.deleteBySource(FID, 'business-model'); // regenerate inferred only (declared+observed preserved)
    await recomputeFromSources({ founderId: FID, repo: repoW, anthropicApiKey: ANTHROPIC });
    const all2 = await repoW.findByFounder(FID);
    const threadsAfter2 = await reconcileThreadsOnRecompute(FID, all2, threadsW, new Date('2026-02-08T00:00:00Z'));
    // The engine may surface the concern under one or more categories; each grounded (category, field,
    // page) is its own thread (approved design). At least one recurred across the two identical
    // recomputes — matched to its EXISTING thread by grounded signature, NOT re-created.
    const recurred = threadsAfter2.find((t) => t.recurrenceCount >= 2 && t.status === 'recurring')!;
    expect(recurred, 'a grounded thread recurred across recomputes (not re-created)').toBeTruthy();
    expect(session1Sigs.has(recurred.signature), 'the recurred thread existed in session 1').toBe(true);
    expect(threadsAfter2.filter((t) => t.signature === recurred.signature)).toHaveLength(1); // NOT re-created
    const recPersist = (await new PgThreadRepository(dbR).load(FID)).find((t) => t.signature === recurred.signature);
    expect(recPersist?.recurrenceCount, 'recurrence persisted across a separate connection').toBeGreaterThanOrEqual(2);
    // tensionId churned but the grounded signature matched:
    const items2 = buildWhatMattersNow(inferredOf(all2), all2);
    const liveItem = items2.find((i) => i.tensionId === recurred.currentTensionId)!;
    expect(liveItem, 'thread relinked to the live (churned) tension id').toBeTruthy();
    // bonus (live): a category the 2nd recompute did not reproduce resolves via tension_gone — grounded.
    const goneLive = threadsAfter2.some((t) => t.resolvedReason === 'tension_gone');

    // ── DECISION — explicit founder commitment → thread resolved(decision), persisted ───────────
    await captureDecision(FID, { tensionId: liveItem.tensionId, tensionStatement: liveItem.statement, commitment: 'Commit fully to enterprise: remove the free self-serve tier and add sales-assisted onboarding by Q3.' }, repoW);
    const resolved = await resolveByDecision(FID, liveItem.tensionId, threadsW, new Date('2026-02-09T00:00:00Z'));
    expect(resolved?.resolvedReason).toBe('decision');
    const persisted2 = await new PgThreadRepository(dbR).load(FID);
    expect(persisted2.find((t) => t.signature === recurred.signature)?.status).toBe('resolved');
    expect(persisted2.find((t) => t.signature === recurred.signature)?.resolvedReason).toBe('decision');

    // ── INVARIANTS ──────────────────────────────────────────────────────────────────────────────
    const allFinal = await repoW.findByFounder(FID);
    const ids = new Set(allFinal.map((f) => f.id));
    const dangling = inferredOf(allFinal).flatMap((f) => (f.derivedFrom ?? []).filter((d) => !ids.has(d)));
    expect(dangling, 'no dangling derived_from provenance').toHaveLength(0);

    // attribution honest: the decision is declared/founder, never observed/inferred
    const decisionFrag = allFinal.find((f) => f.payload?.['decidesOn'] === liveItem.tensionId && f.payload?.['kind'] !== 'block')!;
    expect(decisionFrag.confidenceKind).toBe('declared');
    expect(decisionFrag.source).toBe('founder');
    // ceiling held: recompute returned its ceiling channel; no marketContext was persisted as evidence
    expect(Array.isArray(rec1.ceilingRejected)).toBe(true);
    expect(allFinal.every((f) => f.source !== 'business-model' || f.confidenceKind === 'inferred')).toBe(true);

    // Report line (visible in test output)
    console.log(`[live-gate] recurred(sig=${recurred.signature.slice(0, 8)}, count=${recurred.recurrenceCount}) → resolved(decision); tension_gone-live=${goneLive}; threads=${threadsAfter2.length}. persisted across 2 connections. dangling=0.`);
  });
});
