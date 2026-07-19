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
import { normalizeConclusions, type Understanding, type SynthesisModel } from './understanding';

/** The frozen engine's contribution to synthesis (produced by the caller's recompute run). */
export interface EngineOutcome { modelConfidence: string; inferred: Array<{ category: string; statement: string }> }

/** Synthesis WITHOUT persistence — the LLM call + validation, returning the ingredients of a version.
 *  The durable worker runs this OUTSIDE any transaction, then commits the version + READY atomically, so a
 *  crash mid-finalization can never orphan a version or let a retry create a duplicate. */
export async function composeUnderstanding(args: {
  founderId: string; evidence: IEvidenceRepository; engine: EngineOutcome; synthesisModel: SynthesisModel;
}): Promise<{ status: 'ok'; conclusions: Understanding['conclusions']; sourceFragmentIds: string[]; modelVersion: string } | { status: 'insufficient_evidence' }> {
  const observedAll = await args.evidence.findObserved(args.founderId);
  const nonBlock = observedAll.filter((f) => f.payload?.['kind'] !== 'block' && typeof f.payload?.['text'] === 'string' && String(f.payload['text']).trim().length > 0);
  if (nonBlock.length === 0) return { status: 'insufficient_evidence' };
  const observed = nonBlock.map((f) => ({ id: f.id, text: String(f.payload!['text']), source: f.source }));
  const raw = await args.synthesisModel.synthesize({ founderId: args.founderId, observed, engineModelConfidence: args.engine.modelConfidence, inferred: args.engine.inferred });
  const sourceFragmentIds = observed.map((o) => o.id);
  const conclusions = normalizeConclusions(raw, sourceFragmentIds, () => generateId());
  return { status: 'ok', conclusions, sourceFragmentIds, modelVersion: args.synthesisModel.version };
}

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

/**
 * Record a founder response to a conclusion (Wave 2 item 4). This does NOT re-synthesize or bump the
 * understanding version (no inflation from Confirm/Reject) — the original synthesis + evidence are immutable.
 * It appends to the response log (superseding the prior effective response) and, ONLY for genuine founder
 * input (Correct's text; Partly's qualification), persists that text as founder-DECLARED evidence for future
 * orchestration. Confirm records acceptance; Reject records rejection and creates no inverse/declared fact.
 */
export async function recordConclusionResponse(args: {
  founderId: string;
  conclusionId: string;
  type: import('./understanding').ResponseType;
  acceptedText: string | null;
  qualificationText: string | null;
  correctionText: string | null;
  evidence: IEvidenceRepository;
  understanding: PgUnderstandingRepository;
  responses: import('./pg-conclusion-response.repository').PgConclusionResponseRepository;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  now: Date;
}): Promise<{ status: 'ok'; responseId: string } | { status: 'not_found' }> {
  const latest = await args.understanding.latest(args.founderId);
  if (!latest) return { status: 'not_found' };
  const target = latest.conclusions.find((c) => c.id === args.conclusionId);
  if (!target) return { status: 'not_found' };

  // The founder's NEW words become declared evidence: Correct → correctionText; Partly → qualificationText.
  const declaredText = (args.type === 'corrected' ? args.correctionText : args.type === 'partly' ? args.qualificationText : null)?.trim() || null;

  let responseId = '';
  await args.db.transaction().execute(async (tx: unknown) => {
    if (declaredText) {
      const common = { founderId: args.founderId, source: 'founder', platform: null, sourceUrl: `conversation://correction/${args.conclusionId}`, confidenceKind: 'declared' as const, visibility: 'private' as const, occurredAt: null as Date | null };
      await args.evidence.appendMany([
        makeFragment({ ...common, payload: { text: declaredText, correctsConclusion: args.conclusionId, conclusionType: target.type, response: args.type } }),
        makeFragment({ ...common, payload: { kind: 'block', text: declaredText, blockType: 'correction', correctsConclusion: args.conclusionId } }),
      ], tx);
    }
    const rec = await args.responses.record({
      founderId: args.founderId, understandingId: latest.id, conclusionId: args.conclusionId, type: args.type,
      acceptedText: args.acceptedText, qualificationText: args.qualificationText, correctionText: args.correctionText, now: args.now,
    }, tx);
    responseId = rec.id;
  });
  return { status: 'ok', responseId };
}
