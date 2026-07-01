/**
 * M2.1 end-to-end service — TWO BEATS (timing decision B).
 *   Beat 1: URL → (connector → evidence store) → grounded OBSERVED reflection (fast; no
 *           synthesis call). The ~30s promise attaches to THIS (first grounded reflection).
 *   Beat 2: frozen engine synthesis → fail-closed resolution → persist inferred → inferred
 *           lines, which stream in behind Beat 1 when synthesis completes.
 * Honest throughout; every rendered line traces to real fragment ids. Engine byte-identical.
 */
import type { IEvidenceRepository, EvidenceFragment } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import { readWebsite, type ConnectionState, type ProgressEvent } from '../connectors/website/website.connector';
import { recomputeFromWebsite } from './recompute';
import { buildObservedReflection, buildInferredLines, type Reflection, type ReflectionLine } from './reflection';

const INSIGHT_KEYS: ReadonlyArray<keyof BusinessModel> = [
  'contradictions', 'blindSpots', 'hiddenStrengths', 'hiddenWeaknesses', 'positioningOpportunities',
];

export interface SliceResult {
  state: ConnectionState;
  observedReflection: Reflection;   // Beat 1
  inferredLines: ReflectionLine[];  // Beat 2
  timing: { fetchMs: number; timeToFirstReflectionMs: number; recomputeMs: number; fullSynthesisMs: number };
  resolution: { insightsTotal: number; resolved: number; rejected: number; hitRate: number };
  pagesRead: number;
  fragmentsStored: number;
  gaps: string[];
  diagnostics: { enginePages: string[]; rejectedSample: string[] };
}

export async function runWebsiteMagicMoment(args: {
  founderId: string;
  url: string;
  repo: IEvidenceRepository;
  anthropicApiKey: string;
  model?: string;
  onProgress?: (e: ProgressEvent) => void;
  onFirstReflection?: (r: Reflection) => void;   // Beat 1 ready
  onInferredLines?: (lines: ReflectionLine[]) => void; // Beat 2 ready
}): Promise<SliceResult> {
  const t0 = Date.now();

  // Spine: fetch → extract → observed fragments in store.
  const read = await readWebsite({ founderId: args.founderId, url: args.url, repo: args.repo, onProgress: args.onProgress });
  const fetchMs = Date.now() - t0;

  // BEAT 1 — grounded observed reflection, fast, no synthesis.
  const observed = await args.repo.findObserved(args.founderId, 'website');
  const observedReflection = buildObservedReflection({ state: read.state, observed, gaps: read.gaps });
  const timeToFirstReflectionMs = Date.now() - t0;
  args.onFirstReflection?.(observedReflection);

  if (read.state === 'failed' || observedReflection.state === 'empty') {
    return {
      state: observedReflection.state, observedReflection, inferredLines: [],
      timing: { fetchMs, timeToFirstReflectionMs, recomputeMs: 0, fullSynthesisMs: timeToFirstReflectionMs },
      resolution: { insightsTotal: 0, resolved: 0, rejected: 0, hitRate: 0 },
      pagesRead: read.pagesRead, fragmentsStored: read.fragmentsStored, gaps: read.gaps,
      diagnostics: { enginePages: [], rejectedSample: [] },
    };
  }

  // BEAT 2 — synthesis behind: frozen engine → fail-closed resolution → persist inferred.
  const tR = Date.now();
  const rec = await recomputeFromWebsite({ founderId: args.founderId, repo: args.repo, anthropicApiKey: args.anthropicApiKey, model: args.model });
  const recomputeMs = Date.now() - tR;

  const inferred = (await args.repo.findByFounder(args.founderId)).filter((f: EvidenceFragment) => f.confidenceKind === 'inferred');
  const inferredLines = buildInferredLines(inferred);
  args.onInferredLines?.(inferredLines);

  const insightsTotal = INSIGHT_KEYS.reduce((n, k) => n + ((rec.model[k] as unknown[] | undefined)?.length ?? 0), 0);
  const hitRate = insightsTotal > 0 ? rec.persisted / insightsTotal : 0;

  return {
    state: observedReflection.state, observedReflection, inferredLines,
    timing: { fetchMs, timeToFirstReflectionMs, recomputeMs, fullSynthesisMs: Date.now() - t0 },
    resolution: { insightsTotal, resolved: rec.persisted, rejected: rec.rejected.length, hitRate },
    pagesRead: read.pagesRead, fragmentsStored: read.fragmentsStored, gaps: read.gaps,
    diagnostics: { enginePages: rec.enginePages, rejectedSample: rec.rejected.slice(0, 4).map((r) => r.reason) },
  };
}
