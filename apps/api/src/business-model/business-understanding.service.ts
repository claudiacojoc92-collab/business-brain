/**
 * Wave 2 — Business Understanding orchestration (Layer-2; frozen engine byte-identical).
 *
 * generateUnderstanding: observed evidence → the frozen engine (injected `runEngine`) → the synthesis model
 * (injected) → validated, banded conclusions → persisted version 1. respondToConclusion: a founder response
 * persists their words as DECLARED evidence AND creates a NEW understanding version (original preserved).
 *
 * Both the engine and the synthesis model are injected so the deterministic logic (normalization, grounding,
 * banding, versioning, correction) is fully testable without live LLM calls; the route wires the real ones.
 */
import { generateId } from '@bb/shared';
import { makeFragment, type IEvidenceRepository } from '@bb/domain';
import type { PgUnderstandingRepository } from './pg-understanding.repository';
import {
  normalizeConclusions, applyFounderResponse, type Understanding, type SynthesisModel, type ConfirmationState,
} from './understanding';

/** The frozen engine's contribution to synthesis (produced by the caller's recompute run). */
export interface EngineOutcome { modelConfidence: string; inferred: Array<{ category: string; statement: string }> }

/** Synthesis + persist, given an ALREADY-COMPUTED frozen-engine outcome. The durable worker calls this
 *  between its ANALYZING and READY stages; generateUnderstanding wraps it with the engine run. */
export async function synthesizeUnderstanding(args: {
  founderId: string;
  evidence: IEvidenceRepository;
  engine: EngineOutcome;
  synthesisModel: SynthesisModel;
  understanding: PgUnderstandingRepository;
  now: Date;
}): Promise<{ status: 'ok'; understanding: Understanding } | { status: 'insufficient_evidence' }> {
  const observedAll = await args.evidence.findObserved(args.founderId);
  const nonBlock = observedAll.filter((f) => f.payload?.['kind'] !== 'block' && typeof f.payload?.['text'] === 'string' && String(f.payload['text']).trim().length > 0);
  if (nonBlock.length === 0) return { status: 'insufficient_evidence' };
  const observed = nonBlock.map((f) => ({ id: f.id, text: String(f.payload!['text']), source: f.source }));
  const raw = await args.synthesisModel.synthesize({ founderId: args.founderId, observed, engineModelConfidence: args.engine.modelConfidence, inferred: args.engine.inferred });
  const sourceIds = observed.map((o) => o.id);
  const conclusions = normalizeConclusions(raw, sourceIds, () => generateId());
  const u: Understanding = {
    id: generateId(), founderId: args.founderId, version: await args.understanding.nextVersion(args.founderId), supersedesId: null,
    modelVersion: args.synthesisModel.version, sourceFragmentIds: sourceIds, conclusions, createdAt: args.now.toISOString(),
  };
  await args.understanding.save(u); // committed only after normalization/validation succeeds
  return { status: 'ok', understanding: u };
}

export async function generateUnderstanding(args: {
  founderId: string;
  evidence: IEvidenceRepository;
  runEngine: (founderId: string) => Promise<EngineOutcome>;   // wraps the FROZEN engine (recompute); byte-identical
  synthesisModel: SynthesisModel;
  understanding: PgUnderstandingRepository;
  now: Date;
}): Promise<{ status: 'ok'; understanding: Understanding } | { status: 'insufficient_evidence' }> {
  const engine = await args.runEngine(args.founderId); // FROZEN engine
  return synthesizeUnderstanding({ founderId: args.founderId, evidence: args.evidence, engine, synthesisModel: args.synthesisModel, understanding: args.understanding, now: args.now });
}

export async function respondToConclusion(args: {
  founderId: string;
  conclusionId: string;
  response: ConfirmationState;
  correction: string | null;
  evidence: IEvidenceRepository;
  understanding: PgUnderstandingRepository;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  now: Date;
}): Promise<{ status: 'ok'; understanding: Understanding } | { status: 'not_found' }> {
  const latest = await args.understanding.latest(args.founderId);
  if (!latest) return { status: 'not_found' };
  const target = latest.conclusions.find((c) => c.id === args.conclusionId);
  if (!target) return { status: 'not_found' };

  const nextConclusions = applyFounderResponse(latest.conclusions, args.conclusionId, args.response, args.correction);
  const next: Understanding = {
    id: generateId(), founderId: args.founderId, version: latest.version + 1, supersedesId: latest.id,
    modelVersion: latest.modelVersion, sourceFragmentIds: latest.sourceFragmentIds, conclusions: nextConclusions,
    createdAt: args.now.toISOString(),
  };

  // Atomic: persist the founder's DECLARED correction (unless a bare confirm) + the new version together.
  await args.db.transaction().execute(async (tx: unknown) => {
    const text = args.correction?.trim();
    if (args.response !== 'confirmed' && text) {
      const common = { founderId: args.founderId, source: 'founder', platform: null, sourceUrl: `conversation://correction/${args.conclusionId}`, confidenceKind: 'declared' as const, visibility: 'private' as const, occurredAt: null as Date | null };
      await args.evidence.appendMany([
        makeFragment({ ...common, payload: { text, correctsConclusion: args.conclusionId, conclusionType: target.type, response: args.response } }),
        makeFragment({ ...common, payload: { kind: 'block', text, blockType: 'correction', correctsConclusion: args.conclusionId } }),
      ], tx);
    }
    await args.understanding.save(next, tx);
  });
  return { status: 'ok', understanding: next };
}
