/**
 * Wave 4 — durable Founder Strategy worker. Processes a CLAIMED session (already PROCESSING): assemble the
 * current eligible context (outside any tx) → record the snapshot → reason with the strategy model (outside any
 * tx) → resolve to READY (immutable recommendation), INSUFFICIENT_EVIDENCE, or FAILED (with a founder-safe
 * category). READY publication is a single-row update (atomic); a crash before it publishes nothing; a prior
 * successful session is preserved (prior_successful_session_id). Fails CLOSED — never a raw error to the founder.
 */
import type { PgStrategicSessionRepository } from './pg-strategic-session.repository';
import { assembleStrategicContext, type AssemblerDeps } from './strategic-context.assembler';
import type { StrategyModel } from './anthropic-strategy.model';
import { STRATEGY_FAILURE_MESSAGE, type StrategicSession } from './strategy';

export interface StrategicWorkerDeps {
  sessionRepo: PgStrategicSessionRepository;
  assembler: AssemblerDeps;
  model: StrategyModel;
  leaseMs: number;
  now: () => Date;
}

export async function processSession(session: StrategicSession, deps: StrategicWorkerDeps): Promise<StrategicSession> {
  const { sessionRepo, model, now } = deps;
  const failed = async (cat: 'MODEL_FAILED' | 'ASSEMBLY_FAILED', detail: string) =>
    (await sessionRepo.markFailed(session.id, cat, STRATEGY_FAILURE_MESSAGE[cat], detail, now())) ?? (await sessionRepo.getById(session.founderId, session.id))!;

  // ASSEMBLE — current eligible context (outside any transaction).
  let context;
  try { context = await assembleStrategicContext(session.founderId, session.questionText, session.subtype, deps.assembler); }
  catch (e) { return failed('ASSEMBLY_FAILED', String((e as Error)?.message ?? e)); }
  await sessionRepo.recordAssembly(session.id, { understandingVersion: context.businessUnderstanding.version, contextHealth: context.contextHealth, decisionHorizon: context.question.decisionHorizon }, now());

  // REASON — the strategy model (outside any transaction).
  let outcome;
  try { outcome = await model.reason(context); }
  catch (e) { return failed('MODEL_FAILED', String((e as Error)?.message ?? e)); }
  if (outcome == null) return failed('MODEL_FAILED', 'strategy model output failed to parse/validate');

  if (outcome.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE') {
    return (await sessionRepo.markInsufficient(session.id, outcome, 'I don’t have enough yet to make this call responsibly.', now())) ?? (await sessionRepo.getById(session.founderId, session.id))!;
  }
  // RECOMMENDATION → atomic READY (single-row publish; the recommendation is immutable thereafter).
  return (await sessionRepo.markReady(session.id, outcome, now())) ?? (await sessionRepo.getById(session.founderId, session.id))!;
}

export function startStrategicSessionWorker(deps: StrategicWorkerDeps & { intervalMs?: number }): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await deps.sessionRepo.recoverStale(deps.now());
      const claimed = await deps.sessionRepo.claimQueued(deps.now(), deps.leaseMs);
      if (claimed) await processSession(claimed, deps);
    } catch { /* keep the loop alive */ }
    if (!stopped) setTimeout(() => void tick(), deps.intervalMs ?? 1000);
  };
  void tick();
  return () => { stopped = true; };
}
