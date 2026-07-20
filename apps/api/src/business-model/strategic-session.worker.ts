/**
 * Wave 4 — durable Founder Strategy worker. Processes a CLAIMED session (already PROCESSING): assemble the
 * current eligible context (outside any tx) → record the snapshot → reason with the strategy model (outside any
 * tx) → resolve to READY (immutable recommendation), INSUFFICIENT_EVIDENCE, or FAILED (with a founder-safe
 * category). READY publication is a single-row update (atomic); a crash before it publishes nothing; a prior
 * successful session is preserved (prior_successful_session_id). Fails CLOSED — never a raw error to the founder.
 */
import type { PgStrategicSessionRepository } from './pg-strategic-session.repository';
import { assembleStrategicContext, type AssemblerDeps, type StrategicContext } from './strategic-context.assembler';
import type { StrategyModel } from './anthropic-strategy.model';
import { STRATEGY_FAILURE_MESSAGE, type StrategicSession, type StrategicOutcome, type SessionContextConflict } from './strategy';
import { detectNonNegotiableExcludesOnlyOption, effectiveNonNegotiables, optionExcludedBy, type BoundedOption } from './effective-strategic-context.resolver';
import { buildProvenanceManifest, validateRecommendationProvenance, serializeProvenanceManifest, groundingIntegrityFailed, degradeForGroundingIntegrity } from './provenance';

/**
 * Rule 3 (NON_NEGOTIABLE_OPTION) over the strategist's OWN bounded option set: for each option the model assessed,
 * resolve which founder non-negotiable excludes it (the model's echoed context id, validated against the effective
 * non-negotiables; else a conservative token match), then deterministically decide whether every evidence-supported
 * option is excluded. Returns the conflict (with references resolving to immutable context items) or null. Pure.
 */
export function computeSessionContextConflicts(context: StrategicContext, outcome: StrategicOutcome): SessionContextConflict[] {
  const fc = context.founderContext;
  const groups = { GOAL: fc.goals, CONSTRAINT: fc.constraints, RESOURCE: fc.resources, STRATEGIC_PREFERENCE: fc.strategicPreferences, DECISION_HORIZON: fc.decisionHorizons };
  const oa = (outcome as { optionAssessment?: Array<{ label: string; supportedByEvidence: boolean; excludedByContextRefId: string | null }> }).optionAssessment;
  if (!oa || oa.length === 0) return [];
  const nn = effectiveNonNegotiables(groups);
  const nnIds = new Set(nn.map((i) => i.id));
  const options: BoundedOption[] = oa.map((o) => ({
    label: o.label, supportedByEvidence: o.supportedByEvidence === true,
    // Trust the model's echoed exclusion only if it resolves to a REAL effective non-negotiable id; else derive it.
    excludedByItemId: (o.excludedByContextRefId && nnIds.has(o.excludedByContextRefId)) ? o.excludedByContextRefId : optionExcludedBy(nn, o.label),
  }));
  const conflict = detectNonNegotiableExcludesOnlyOption(groups, options);
  return conflict ? [conflict] : [];
}

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

  // PROVENANCE VALIDATION (KA-1) — deterministic, against the exact assembled manifest: invalid grounded references are
  // removed (never substituted); a recommendation left with no validated grounded basis degrades to INSUFFICIENT.
  const manifest = buildProvenanceManifest(context);
  const serializedManifest = serializeProvenanceManifest(manifest); // immutable, persisted with the outcome (Blocker 1)
  let { outcome: validated, validation } = validateRecommendationProvenance(outcome, manifest);

  // OPTION B — whole-outcome grounding integrity (Blocker 2). A recommendation that lost ANY grounding reference
  // (DEGRADED) cannot be persisted as grounded READY: one bounded inline retry, then terminal INSUFFICIENT. An
  // unrelated valid reference never launders an unsupported primary claim. Prefer false-negative grounding.
  if (validated.kind === 'STRATEGIC_RECOMMENDATION' && groundingIntegrityFailed(validation)) {
    let retry: StrategicOutcome | null = null;
    try { retry = await model.reason(context); } catch { retry = null; }
    const revalidated = retry != null ? validateRecommendationProvenance(retry, manifest) : null;
    if (revalidated && revalidated.outcome.kind === 'STRATEGIC_RECOMMENDATION' && !groundingIntegrityFailed(revalidated.validation)) {
      ({ outcome: validated, validation } = revalidated); // retry produced a fully-grounded recommendation
    } else if (revalidated && revalidated.outcome.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE') {
      ({ outcome: validated, validation } = revalidated); // retry collapsed to INSUFFICIENT on its own
    } else {
      const base = revalidated ?? { outcome: validated, validation }; // retry still degraded (or failed) → degrade whole outcome
      ({ outcome: validated, validation } = degradeForGroundingIntegrity(base.outcome, base.validation));
    }
  }

  // Deterministic NON_NEGOTIABLE_OPTION conflict (rule 3), over the (possibly degraded) validated outcome's option set.
  const contextConflicts = computeSessionContextConflicts(context, validated);

  if (validated.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE') {
    return (await sessionRepo.markInsufficient(session.id, validated, 'I don’t have enough yet to make this call responsibly.', now(), contextConflicts, validation, serializedManifest)) ?? (await sessionRepo.getById(session.founderId, session.id))!;
  }
  // RECOMMENDATION → atomic READY (single-row publish; the recommendation + manifest are immutable thereafter).
  return (await sessionRepo.markReady(session.id, validated, now(), contextConflicts, validation, serializedManifest)) ?? (await sessionRepo.getById(session.founderId, session.id))!;
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
