/**
 * Business Memory v1 — the C→B loop service. Closes the loop end to end:
 *   1. capture the founder's structured response to a C tension as `declared` evidence (memory.ts,
 *      B's exact gate);
 *   2. RE-RUN recomputeFromSources — the FROZEN engine re-reads the response as declared input, so
 *      the next reflection reflects what the founder said about C's own reasoning;
 *   3. return BEFORE/AFTER "what matters now", with responses folded in (applyResponses).
 *
 * No new confidence_kind, no second pipeline: the response is declared evidence on the SAME path.
 * A returning session reads persisted state (readMemoryState) — the "still knows me" half.
 */
import type { IEvidenceRepository, EvidenceFragment } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import { recomputeFromSources } from './recompute';
import { buildWhatMattersNow } from './what-matters';
import { captureResponse, responsesByTension, applyResponses, type TensionResponse, type RespondedItem } from './memory';
import { buildInferredLines, type ReflectionLine } from './reflection';

const INSIGHT_KEYS: ReadonlyArray<keyof BusinessModel> = [
  'contradictions', 'blindSpots', 'hiddenStrengths', 'hiddenWeaknesses', 'positioningOpportunities',
];

const inferredOf = (all: EvidenceFragment[]) => all.filter((f) => f.confidenceKind === 'inferred');
function foldedWhatMatters(all: EvidenceFragment[]): RespondedItem[] {
  return applyResponses(buildWhatMattersNow(inferredOf(all), all), responsesByTension(all));
}

export interface MemoryStateResult { whatMattersNow: RespondedItem[]; responded: number }

/** Returning-session state: persisted tensions with prior responses folded in — NO recompute. */
export async function readMemoryState(founderId: string, repo: IEvidenceRepository): Promise<MemoryStateResult> {
  const all = await repo.findByFounder(founderId);
  const byTension = responsesByTension(all);
  const items = foldedWhatMatters(all);
  return { whatMattersNow: items, responded: items.filter((it) => byTension.has(it.tensionId)).length };
}

export interface RespondResult {
  before: RespondedItem[];
  after: RespondedItem[];
  responseStored: boolean;
  resolution: { insightsTotal: number; resolved: number; rejected: number; ceilingRejected: number };
  inferredLines: ReflectionLine[];
  timing: { recomputeMs: number };
}

/**
 * Capture a response → RE-RUN recompute → BEFORE/AFTER. `onBefore` fires with the current state
 * before the (~110s) recompute so the UI can show BEFORE immediately.
 */
export async function runTensionResponse(args: {
  founderId: string; response: TensionResponse; repo: IEvidenceRepository; anthropicApiKey: string; model?: string;
  onBefore?: (items: RespondedItem[]) => void;
  onProgress?: (message: string) => void;
}): Promise<RespondResult> {
  const { founderId, repo } = args;

  const before = foldedWhatMatters(await repo.findByFounder(founderId));
  args.onBefore?.(before);

  // Persist the response as declared (B's gate), then rerun so the frozen engine re-reads it.
  args.onProgress?.('Taking in your response…');
  const stored = await captureResponse(founderId, args.response, repo);
  await repo.deleteBySource(founderId, 'business-model'); // recompute reruns; declared (incl. the response) + observed preserved
  args.onProgress?.('Rethinking this against everything you\'ve told me…');
  const t0 = Date.now();
  const rec = await recomputeFromSources({ founderId, repo, anthropicApiKey: args.anthropicApiKey, model: args.model });
  const recomputeMs = Date.now() - t0;

  const postAll = await repo.findByFounder(founderId);
  const after = foldedWhatMatters(postAll);
  const insightsTotal = INSIGHT_KEYS.reduce((n, k) => n + ((rec.model[k] as unknown[] | undefined)?.length ?? 0), 0);

  return {
    before, after, responseStored: stored.stored > 0,
    resolution: { insightsTotal, resolved: rec.persisted, rejected: rec.rejected.length, ceilingRejected: rec.ceilingRejected.length },
    inferredLines: buildInferredLines(inferredOf(postAll)),
    timing: { recomputeMs },
  };
}
