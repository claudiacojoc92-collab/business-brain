/**
 * Wave 2 closure — the durable understanding worker. Processes a CLAIMED run stage-by-stage
 * (INGESTING → ANALYZING → SYNTHESIZING → READY), renewing the lease at each step and failing CLOSED with a
 * founder-legible category on any error. Side effects (ingestion, the frozen engine, synthesis) run once per
 * attempt; a crash leaves the run active-with-expired-lease, which recoverStale() turns into a retryable
 * FAILED (never a silent re-run). The final understanding is published only after successful validation.
 */
import type { IEvidenceRepository } from '@bb/domain';
import type { PgUnderstandingRunRepository } from './pg-understanding-run.repository';
import type { PgUnderstandingRepository } from './pg-understanding.repository';
import type { UnderstandingRun } from './understanding-run';
import { generateId } from '@bb/shared';
import { composeUnderstanding, type EngineOutcome } from './business-understanding.service';
import type { SynthesisModel, Understanding } from './understanding';

export interface WorkerDeps {
  runRepo: PgUnderstandingRunRepository;
  understanding: PgUnderstandingRepository;
  evidence: IEvidenceRepository;
  ingest: (founderId: string, url: string) => Promise<void>;     // wraps ingestWebsite
  runEngine: (founderId: string) => Promise<EngineOutcome>;      // wraps the FROZEN engine
  synthesisModel: SynthesisModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;                                                        // for the atomic finalize (save + READY)
  leaseMs: number;
  now: () => Date;
}

/** Process one claimed run (already INGESTING). Returns the terminal run row (READY or FAILED). */
export async function processRun(run: UnderstandingRun, deps: WorkerDeps): Promise<UnderstandingRun> {
  const { runRepo, understanding, evidence, ingest, runEngine, synthesisModel, db, leaseMs, now } = deps;
  const fail = async (code: Parameters<PgUnderstandingRunRepository['markFailed']>[1], detail: string) =>
    (await runRepo.markFailed(run.id, code, detail, now())) ?? (await runRepo.getById(run.founderId, run.id))!;
  try {
    // INGESTING — bring the source in (only if the run carries a website source).
    if (run.sourceKey.startsWith('http')) {
      try { await ingest(run.founderId, run.sourceKey); }
      catch (e) { return await fail('unreachable_website', String((e as Error)?.message ?? e)); }
    }
    if (!(await runRepo.advance(run.id, 'INGESTING', 'ANALYZING', now(), leaseMs))) return (await runRepo.getById(run.founderId, run.id))!;

    // ANALYZING — the FROZEN engine.
    let engine: EngineOutcome;
    try { engine = await runEngine(run.founderId); }
    catch (e) { return await fail('analysis_failed', String((e as Error)?.message ?? e)); }
    if (!(await runRepo.advance(run.id, 'ANALYZING', 'SYNTHESIZING', now(), leaseMs))) return (await runRepo.getById(run.founderId, run.id))!;

    // SYNTHESIZING — the LLM call OUTSIDE any transaction (never hold a tx across a multi-second call).
    let composed: Awaited<ReturnType<typeof composeUnderstanding>>;
    try { composed = await composeUnderstanding({ founderId: run.founderId, evidence, engine, synthesisModel }); }
    catch (e) { return await fail('synthesis_failed', String((e as Error)?.message ?? e)); }
    if (composed.status === 'insufficient_evidence') return await fail('insufficient_evidence', 'no observed evidence');

    // ATOMIC finalize — version + save + READY in ONE commit. A crash before commit persists nothing (clean
    // retry); after commit, both the version and READY exist (idempotent — no orphan/duplicate version).
    const understandingId = generateId();
    try {
      await db.transaction().execute(async (tx: unknown) => {
        const version = await understanding.nextVersion(run.founderId, tx);
        const u: Understanding = { id: understandingId, founderId: run.founderId, version, supersedesId: null, modelVersion: composed.modelVersion, sourceFragmentIds: composed.sourceFragmentIds, conclusions: composed.conclusions, createdAt: now().toISOString() };
        await understanding.save(u, tx);
        const ready = await runRepo.markReady(run.id, understandingId, version, now(), tx);
        if (!ready) throw new Error('run left SYNTHESIZING (lost race) — roll back the version'); // keeps version↔run 1:1
      });
    } catch (e) { return await fail('synthesis_failed', String((e as Error)?.message ?? e)); }
    return (await runRepo.getById(run.founderId, run.id))!;
  } catch (e) {
    return await fail('unknown', String((e as Error)?.message ?? e));
  }
}

/** Start the in-process worker loop: recover stale runs, claim one QUEUED run, process it. Returns a stop fn. */
export function startUnderstandingWorker(deps: WorkerDeps & { intervalMs?: number }): () => void {
  let stopped = false;
  const interval = deps.intervalMs ?? 1500;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await deps.runRepo.recoverStale(deps.now());          // documented, implemented sweep — no stranded runs
      const claimed = await deps.runRepo.claimQueued(deps.now(), deps.leaseMs);
      if (claimed) { await processRun(claimed, deps); if (!stopped) { setTimeout(() => void tick(), 0); return; } } // drain quickly when busy
    } catch { /* transient — next tick retries */ }
    if (!stopped) setTimeout(() => void tick(), interval);
  };
  setTimeout(() => void tick(), 0);
  return () => { stopped = true; };
}
