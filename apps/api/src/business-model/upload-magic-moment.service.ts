/**
 * M2.2 end-to-end upload service — TWO BEATS, spanning sources (mirrors the website service).
 *   Beat 1: upload → (connector → evidence store) → grounded OBSERVED reflection from the
 *           uploaded doc AND any already-connected website (fast; no synthesis).
 *   Beat 2: recomputeFromSources (frozen engine, fail-closed, spanning website+upload) →
 *           inferred lines that stream in behind — including cross-source fusion.
 * Honest throughout; every rendered line traces to real fragment ids. Engine byte-identical.
 */
import type { IEvidenceRepository, EvidenceFragment } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import { readUpload } from '../connectors/upload/upload.connector';
import type { UploadInput, UploadState } from '../connectors/upload/types';
import { recomputeFromSources } from './recompute';
import { buildObservedReflection, buildUploadObservedLines, buildInferredLines, type ReflectionLine } from './reflection';

const INSIGHT_KEYS: ReadonlyArray<keyof BusinessModel> = [
  'contradictions', 'blindSpots', 'hiddenStrengths', 'hiddenWeaknesses', 'positioningOpportunities',
];

const HANDOFF = "That's what your site says in public and what your doc says in private. Now tell me the part neither one can — what are you actually trying to build?";
const COPY: Partial<Record<UploadState, string>> = {
  unsupported: "I can't read this type yet — a PDF, Word doc, or text file works best. (Design files, spreadsheets, and image-only scans are on the list, not ready yet.)",
  empty: "I opened it but couldn't find much to read. If it's a scanned or image-only file, I can't see the text yet — a text-based PDF, Word doc, or plain text works best.",
  redundant: "This looks like your website content, which I've already read — I'll skip the duplicate and keep anything new. Nothing new here, so I haven't added it twice.",
  failed: "I couldn't open that file — it looks corrupted or wasn't fully uploaded. Want to try it again, or send a different one?",
};

export interface UploadProgress { phase: string; message: string }
export interface UploadBeat1 { state: UploadState; uploadLines: ReflectionLine[]; websiteLines: ReflectionLine[]; handoff: string | null; message: string | null }
export interface UploadSliceResult {
  state: UploadState;
  beat1: UploadBeat1;
  inferredLines: ReflectionLine[];
  timing: { ingestMs: number; timeToFirstReflectionMs: number; recomputeMs: number; fullMs: number };
  resolution: { insightsTotal: number; resolved: number; rejected: number; ceilingRejected: number; hitRate: number };
  filename: string; provenanceStrength: string | null; unitsRead: number; redundantUnits: number;
}

const isReflective = (s: UploadState) => s === 'synced' || s === 'partial';

export async function runUploadMagicMoment(args: {
  founderId: string; input: UploadInput; repo: IEvidenceRepository; anthropicApiKey: string; model?: string;
  onProgress?: (e: UploadProgress) => void;
  onFirstReflection?: (b: UploadBeat1) => void;   // Beat 1 ready
  onInferredLines?: (l: ReflectionLine[]) => void; // Beat 2 ready
}): Promise<UploadSliceResult> {
  const t0 = Date.now();
  args.onProgress?.({ phase: 'reading', message: `Reading ${args.input.filename}…` });

  // Spine: intake → detect → extract → classify → observed fragments in store. (Website evidence
  // already present, if any, is preserved for cross-source fusion.)
  const read = await readUpload({ founderId: args.founderId, input: args.input, repo: args.repo });
  const ingestMs = Date.now() - t0;
  args.onProgress?.({ phase: 'reading', message: isReflective(read.state) ? `Found ${read.unitsRead} sections — cross-referencing with your website…` : 'Finished reading.' });

  // BEAT 1 — upload observed + website observed, deterministic, fast.
  const observed = await args.repo.findObserved(args.founderId);
  const nonReflective = !isReflective(read.state);
  const beat1: UploadBeat1 = {
    state: read.state,
    uploadLines: nonReflective ? [] : buildUploadObservedLines(observed.filter((f) => f.source === 'upload')),
    websiteLines: nonReflective ? [] : buildObservedReflection({ state: 'synced', observed: observed.filter((f) => f.source === 'website'), gaps: [] }).lines,
    handoff: nonReflective ? null : HANDOFF,
    message: COPY[read.state] ?? null,
  };
  const timeToFirstReflectionMs = Date.now() - t0;
  args.onFirstReflection?.(beat1);

  const baseResult = (over: Partial<UploadSliceResult>): UploadSliceResult => ({
    state: read.state, beat1, inferredLines: [],
    timing: { ingestMs, timeToFirstReflectionMs, recomputeMs: 0, fullMs: timeToFirstReflectionMs },
    resolution: { insightsTotal: 0, resolved: 0, rejected: 0, ceilingRejected: 0, hitRate: 0 },
    filename: read.filename, provenanceStrength: read.provenanceStrength, unitsRead: read.unitsRead, redundantUnits: read.redundantUnits, ...over,
  });
  if (nonReflective) return baseResult({}); // honest empty/redundant/unsupported/failed — no synthesis

  // BEAT 2 — synthesis behind: frozen engine across sources → fail-closed → persist inferred.
  const tR = Date.now();
  const rec = await recomputeFromSources({ founderId: args.founderId, repo: args.repo, anthropicApiKey: args.anthropicApiKey, model: args.model });
  const recomputeMs = Date.now() - tR;
  const inferred = (await args.repo.findByFounder(args.founderId)).filter((f: EvidenceFragment) => f.confidenceKind === 'inferred');
  const inferredLines = buildInferredLines(inferred);
  args.onInferredLines?.(inferredLines);
  const insightsTotal = INSIGHT_KEYS.reduce((n, k) => n + ((rec.model[k] as unknown[] | undefined)?.length ?? 0), 0);

  return baseResult({
    inferredLines,
    timing: { ingestMs, timeToFirstReflectionMs, recomputeMs, fullMs: Date.now() - t0 },
    resolution: { insightsTotal, resolved: rec.persisted, rejected: rec.rejected.length, ceilingRejected: rec.ceilingRejected.length, hitRate: insightsTotal > 0 ? rec.persisted / insightsTotal : 0 },
  });
}
