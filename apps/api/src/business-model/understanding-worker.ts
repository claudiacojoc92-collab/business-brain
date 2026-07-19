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
import { synthesizeUnderstanding, type EngineOutcome } from './business-understanding.service';
import type { SynthesisModel } from './understanding';

export interface WorkerDeps {
  runRepo: PgUnderstandingRunRepository;
  understanding: PgUnderstandingRepository;
  evidence: IEvidenceRepository;
  ingest: (founderId: string, url: string) => Promise<void>;     // wraps ingestWebsite
  runEngine: (founderId: string) => Promise<EngineOutcome>;      // wraps the FROZEN engine
  synthesisModel: SynthesisModel;
  leaseMs: number;
  now: () => Date;
}

/** Process one claimed run (already INGESTING). Returns the terminal run row (READY or FAILED). */
export async function processRun(run: UnderstandingRun, deps: WorkerDeps): Promise<UnderstandingRun> {
  const { runRepo, understanding, evidence, ingest, runEngine, synthesisModel, leaseMs, now } = deps;
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

    // SYNTHESIZING — Layer-2 synthesis + validated persist. Publish only on success.
    let synth: Awaited<ReturnType<typeof synthesizeUnderstanding>>;
    try { synth = await synthesizeUnderstanding({ founderId: run.founderId, evidence, engine, synthesisModel, understanding, now: now() }); }
    catch (e) { return await fail('synthesis_failed', String((e as Error)?.message ?? e)); }
    if (synth.status === 'insufficient_evidence') return await fail('insufficient_evidence', 'no observed evidence');

    return (await runRepo.markReady(run.id, synth.understanding.id, synth.understanding.version, now()))
      ?? (await runRepo.getById(run.founderId, run.id))!;
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
