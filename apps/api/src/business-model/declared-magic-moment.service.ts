/**
 * Capability B v1 — declared-intent two-beat service (mirrors the upload/google services).
 *   Beat 1: capture the founder's answers as `declared` evidence (unchanged gate) → grounded
 *           reflection showing what they TOLD us (declared) alongside what we OBSERVED (website +
 *           google + upload), kept visibly distinct.
 *   Beat 2: recomputeFromSources (frozen engine, fail-closed) fusing declared + observed → inferred
 *           lines, including the declared-vs-observed gap ("you say X, your evidence shows Y").
 *
 * Honest throughout; declared is attributed as declared ("you told me"), NEVER as observed truth.
 * Engine byte-identical; no new confidence_kind; the SAME recompute path (declared is just another
 * kind it already reads after the Phase-3 wiring).
 */
import type { IEvidenceRepository, EvidenceFragment } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import { captureDeclared, type DeclaredAnswer } from './declared';
import { recomputeFromSources } from './recompute';
import {
  buildObservedReflection, buildUploadObservedLines, buildGoogleObservedLines,
  buildDeclaredLines, buildInferredLines, type ReflectionLine,
} from './reflection';

const INSIGHT_KEYS: ReadonlyArray<keyof BusinessModel> = [
  'contradictions', 'blindSpots', 'hiddenStrengths', 'hiddenWeaknesses', 'positioningOpportunities',
];

const HANDOFF = "Now I know what you're trying to build, not just what you've made. Where your intent and your evidence pull apart is where the real work is.";

export type DeclaredState = 'reading' | 'synced' | 'empty';

export interface DeclaredProgress { phase: string; message: string }
export interface DeclaredBeat1 {
  state: DeclaredState;
  declaredLines: ReflectionLine[];   // "You told me: …" (kind 'declared')
  observedLines: ReflectionLine[];   // website + google + upload (kind 'observed')
  handoff: string | null;
  message: string | null;
}
export interface DeclaredSliceResult {
  state: DeclaredState;
  beat1: DeclaredBeat1;
  inferredLines: ReflectionLine[];
  timing: { captureMs: number; timeToFirstReflectionMs: number; recomputeMs: number; fullMs: number };
  resolution: { insightsTotal: number; resolved: number; rejected: number; ceilingRejected: number; hitRate: number };
  fieldsCaptured: number;
}

/** Combine the observed reflection across all connected sources (kept distinct from declared). */
function observedLinesFor(observed: EvidenceFragment[]): ReflectionLine[] {
  return [
    ...buildGoogleObservedLines(observed.filter((f) => f.source === 'google')),
    ...buildUploadObservedLines(observed.filter((f) => f.source === 'upload')),
    ...buildObservedReflection({ state: 'synced', observed: observed.filter((f) => f.source === 'website'), gaps: [] }).lines,
  ];
}

export async function runDeclaredMagicMoment(args: {
  founderId: string; answers: DeclaredAnswer[]; repo: IEvidenceRepository; anthropicApiKey: string; model?: string;
  onProgress?: (e: DeclaredProgress) => void;
  onFirstReflection?: (b: DeclaredBeat1) => void;
  onInferredLines?: (l: ReflectionLine[]) => void;
}): Promise<DeclaredSliceResult> {
  const t0 = Date.now();
  args.onProgress?.({ phase: 'reading', message: 'Taking in what you told me…' });

  // Spine: capture answers → declared fragments through the UNCHANGED gate.
  const cap = await captureDeclared(args.founderId, args.answers, args.repo);
  const captureMs = Date.now() - t0;

  const base = (over: Partial<DeclaredSliceResult>): DeclaredSliceResult => ({
    state: 'empty', beat1: { state: 'empty', declaredLines: [], observedLines: [], handoff: null, message: null }, inferredLines: [],
    timing: { captureMs, timeToFirstReflectionMs: Date.now() - t0, recomputeMs: 0, fullMs: Date.now() - t0 },
    resolution: { insightsTotal: 0, resolved: 0, rejected: 0, ceilingRejected: 0, hitRate: 0 },
    fieldsCaptured: cap.fields, ...over,
  });

  if (cap.fields === 0) {
    const beat1: DeclaredBeat1 = { state: 'empty', declaredLines: [], observedLines: [], handoff: null, message: "I didn't catch any answers — tell me even one thing and I'll fold it in." };
    args.onFirstReflection?.(beat1);
    return base({ beat1 }); // honest empty — no synthesis, no fabrication
  }

  // BEAT 1 — declared (what you told me) + observed (what I've seen), kept distinct.
  const all = await args.repo.findByFounder(args.founderId);
  const declaredFrags = all.filter((f) => f.confidenceKind === 'declared');
  const observedFrags = all.filter((f) => f.confidenceKind === 'observed');
  const beat1: DeclaredBeat1 = {
    state: 'synced',
    declaredLines: buildDeclaredLines(declaredFrags),
    observedLines: observedLinesFor(observedFrags),
    handoff: HANDOFF,
    message: null,
  };
  const timeToFirstReflectionMs = Date.now() - t0;
  args.onFirstReflection?.(beat1);

  // BEAT 2 — synthesis behind: frozen engine across sources (declared + observed) → fail-closed.
  const tR = Date.now();
  const rec = await recomputeFromSources({ founderId: args.founderId, repo: args.repo, anthropicApiKey: args.anthropicApiKey, model: args.model });
  const recomputeMs = Date.now() - tR;
  const inferred = (await args.repo.findByFounder(args.founderId)).filter((f: EvidenceFragment) => f.confidenceKind === 'inferred');
  const inferredLines = buildInferredLines(inferred);
  args.onInferredLines?.(inferredLines);
  const insightsTotal = INSIGHT_KEYS.reduce((n, k) => n + ((rec.model[k] as unknown[] | undefined)?.length ?? 0), 0);

  return base({
    state: 'synced', beat1, inferredLines,
    timing: { captureMs, timeToFirstReflectionMs, recomputeMs, fullMs: Date.now() - t0 },
    resolution: { insightsTotal, resolved: rec.persisted, rejected: rec.rejected.length, ceilingRejected: rec.ceilingRejected.length, hitRate: insightsTotal > 0 ? rec.persisted / insightsTotal : 0 },
  });
}
