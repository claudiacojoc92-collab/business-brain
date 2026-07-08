import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { recomputeFromSources } from '../../business-model/recompute';
import { buildDeclaredFragments } from '../../business-model/declared';
import { PgThreadRepository } from '../../business-model/pg-thread.repository';
import { reconcileThreadsOnRecompute } from '../../business-model/thread-service';
import { recordRecommendationOnThread } from '../../business-model/thread';
import { recommendationsFromRecompute, toRecommendationView } from '../../business-model/recommendation-service';
import { PgRecommendationRepository } from '../../business-model/pg-recommendation.repository';
import { renderRecommendation, RECOMMENDATION_LABEL } from '../../business-model/recommendation';

/**
 * Recommendation §LIVE GATE (ADR-010). Real Postgres (V053), real frozen engine. A real recommendation
 * is produced from real grounded inference (reusing existing recompute output — no second inference),
 * discloses basis+assumptions+confidence in founder-facing language, is labeled a read, persists with
 * BOTH its contract fields AND its `inferred` truth status, a thread references it, the ceiling holds,
 * dangling=0. R2: Anthropic key read from .env via a Node parser (never shell-sourced/printed). Skips
 * (does not fail) without DB/key.
 */
function loadKey(): string {
  try { for (const l of readFileSync('/Users/claudiacojoc/Desktop/business_brain/.env', 'utf8').split('\n')) { const m = l.match(/^ANTHROPIC_API_KEY=(.*)$/); if (m && m[1]) return m[1].trim(); } } catch { /* ignore */ }
  return process.env['ANTHROPIC_API_KEY'] ?? '';
}
const ANTHROPIC = loadKey();
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const FID = 'recommendation-gate-founder';
const PAGE = 'https://acme.co/';
const inferredOf = (a: EvidenceFragment[]) => a.filter((f) => f.confidenceKind === 'inferred');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbW: any, dbR: any; let dbUp = false;

beforeAll(async () => {
  if (!ANTHROPIC) return;
  try {
    dbW = createKyselyClient(DB_URL); dbR = createKyselyClient(DB_URL);
    for (const t of ['evidence.fragments', 'memory.recommendations', 'memory.thread_events', 'memory.threads']) {
      await dbW.deleteFrom(t).where('founder_id', '=', FID).execute();
    }
    dbUp = true;
  } catch { dbUp = false; }
});
afterAll(async () => { try { await dbW?.destroy(); } catch { /* ignore */ } try { await dbR?.destroy(); } catch { /* ignore */ } });

describe('Recommendation §LIVE — real recommendation from real inference (real DB + frozen engine)', () => {
  it('produces → discloses → labeled-a-read → persists (contract + inferred truth) → thread references it', { timeout: 600_000 }, async (ctx) => {
    if (!ANTHROPIC || !dbUp) { ctx.skip(); return; }
    const repoW = new PgEvidenceRepository(dbW);
    const threadsW = new PgThreadRepository(dbW);
    const recRepo = new PgRecommendationRepository(dbW);

    // Seed a stark declared-vs-observed positioning situation (evokes grounded inference + market context).
    const declaredFrags = buildDeclaredFragments(FID, [{ field: 'direction', text: 'We are enterprise-first: we win six-figure annual contracts through a high-touch sales team and long procurement.' }]);
    const pageText = 'Free forever. Sign up in thirty seconds — no credit card and no sales call, ever. Acme is built for solo makers and tiny teams. Self-serve onboarding, flat simple pricing, cancel anytime.';
    const obs: EvidenceFragment[] = [
      makeFragment({ founderId: FID, source: 'website', sourceUrl: PAGE, confidenceKind: 'observed', visibility: 'public', payload: { text: pageText, pageType: 'home' } }),
      ...['Free forever. Sign up in thirty seconds — no credit card and no sales call, ever.', 'Acme is built for solo makers and tiny teams.', 'Self-serve onboarding, flat simple pricing, cancel anytime.']
        .map((t) => makeFragment({ founderId: FID, source: 'website', sourceUrl: PAGE, confidenceKind: 'observed', visibility: 'public', payload: { kind: 'block', text: t } })),
    ];
    await repoW.appendMany([...declaredFrags, ...obs]);

    // Real recompute → reconcile threads (existing) → generate recommendations from EXISTING output.
    const rec = await recomputeFromSources({ founderId: FID, repo: repoW, anthropicApiKey: ANTHROPIC });
    const all = await repoW.findByFounder(FID);
    const threads = await reconcileThreadsOnRecompute(FID, all, threadsW, new Date('2026-03-01T00:00:00Z'));
    const recommendations = recommendationsFromRecompute(rec.model, all);
    expect(recommendations.length, 'engine produced ≥1 grounded advice-shaped inferred claim + disclosable assumptions').toBeGreaterThanOrEqual(1);

    // Prefer a recommendation whose claim is ALSO a thread tension, so the thread can reference it.
    const threadTensionIds = new Set(threads.map((t) => t.currentTensionId));
    const chosen = recommendations.find((r) => threadTensionIds.has(r.claim.id)) ?? recommendations[0]!;

    // Contract is real: basis ⊆ the claim's provenance; assumptions/confidence/language present.
    expect(chosen.claim.confidenceKind).toBe('inferred');                                   // internal truth status
    expect(chosen.contract.evidenceBasis.length).toBeGreaterThan(0);
    expect(chosen.contract.evidenceBasis.every((id) => (chosen.claim.derivedFrom ?? []).includes(id))).toBe(true); // real basis
    expect(chosen.contract.assumptions.length).toBeGreaterThan(0);
    expect(['low', 'medium', 'high']).toContain(chosen.contract.confidence);
    expect(chosen.contract.recommendation.length).toBeGreaterThan(0);

    // Rendered as a READ, never a fact; discloses everything.
    const rendered = renderRecommendation(chosen);
    expect(rendered).toContain(RECOMMENDATION_LABEL);
    expect(rendered).toMatch(/not a fact/i);
    expect(rendered).toContain("What I'm assuming:");
    expect(rendered).toMatch(/Confidence: (low|medium|high)/);

    // Persist the Product Primitive; record it on its thread (reuse the merged thread infra).
    const linkedThread = threads.find((t) => t.currentTensionId === chosen.claim.id);
    await recRepo.save(FID, chosen, linkedThread?.signature ?? null);
    if (linkedThread) await threadsW.save(FID, recordRecommendationOnThread(threads, chosen.claim.id, new Date('2026-03-01T01:00:00Z')));

    // Persisted with BOTH contract fields AND inferred truth status — read back via a SEPARATE connection.
    const storedList = await new PgRecommendationRepository(dbR).load(FID);
    const stored = storedList.find((s) => s.claimFragmentId === chosen.claim.id)!;
    expect(stored, 'recommendation persisted').toBeTruthy();
    expect(stored.evidenceBasis.length).toBeGreaterThan(0);
    expect(stored.assumptions.length).toBeGreaterThan(0);
    expect(stored.recommendationText).toBe(chosen.contract.recommendation);
    const allR = await new PgEvidenceRepository(dbR).findByFounder(FID);
    const view = toRecommendationView(stored, new Map(allR.map((f) => [f.id, f])))!;
    expect(view.truthStatus, 'underlying claim is still `inferred` in the evidence store').toBe('inferred');
    expect(view.evidenceBasis.length).toBeGreaterThan(0);

    // Thread references it (if the claim was a thread tension) — a 'recommended' event in history.
    if (linkedThread) {
      const persistedThreads = await new PgThreadRepository(dbR).load(FID);
      const t = persistedThreads.find((x) => x.signature === linkedThread.signature)!;
      expect(t.history.some((e) => e.event === 'recommended' && e.tensionId === chosen.claim.id), 'thread history references the recommendation').toBe(true);
    }

    // Ceiling holds: marketContext (external reality) was never persisted as evidence — every
    // 'business-model' fragment is `inferred`; assumptions were DISCLOSED from the model, not stored as fact.
    expect(allR.every((f) => f.source !== 'business-model' || f.confidenceKind === 'inferred')).toBe(true);
    // dangling=0: every persisted inferred claim's provenance resolves.
    const ids = new Set(allR.map((f) => f.id));
    const dangling = inferredOf(allR).flatMap((f) => (f.derivedFrom ?? []).filter((d) => !ids.has(d)));
    expect(dangling, 'no dangling provenance').toHaveLength(0);

    console.log(`[rec-live] emitted ${recommendations.length} rec(s); chosen claim=${chosen.claim.id.slice(0, 8)} category=${chosen.claim.payload?.['category']} confidence=${chosen.contract.confidence} basis=${chosen.contract.evidenceBasis.length} assumptions=${chosen.contract.assumptions.length} threadRef=${Boolean(linkedThread)}; truthStatus=inferred; dangling=0.`);
  });
});
