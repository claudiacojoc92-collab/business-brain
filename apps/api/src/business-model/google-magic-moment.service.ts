/**
 * Google end-to-end service — TWO BEATS, spanning sources (mirrors the upload service).
 *   Beat 1: granted Google files → (connector → evidence store) → grounded OBSERVED reflection
 *           from the private Google docs AND any already-connected website (fast; no synthesis).
 *   Beat 2: recomputeFromSources (frozen engine, fail-closed, spanning website+upload+google) →
 *           inferred lines that stream in behind — including cross-source fusion.
 * Honest throughout; every rendered line traces to real fragment ids. Engine byte-identical.
 * The founder outcome is DEPTH ("it understood my private working docs"), not freshness.
 */
import type { IEvidenceRepository, EvidenceFragment } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import { readGoogle, type GoogleConnector, type GoogleState } from '../connectors/google/google.connector';
import { recomputeFromSources } from './recompute';
import { buildObservedReflection, buildGoogleObservedLines, buildInferredLines, type ReflectionLine } from './reflection';

const INSIGHT_KEYS: ReadonlyArray<keyof BusinessModel> = [
  'contradictions', 'blindSpots', 'hiddenStrengths', 'hiddenWeaknesses', 'positioningOpportunities',
];

const HANDOFF = "That's what your site says in public and what your private working docs say behind the scenes. Now tell me the part neither one can — what are you actually trying to build?";
const COPY: Partial<Record<GoogleState, string>> = {
  unsupported: "I couldn't read the files you picked yet — Google Docs, PDFs, and text files work best. (Sheets, Slides, and image-only scans are on the list, not ready yet.)",
  empty: "I opened what you granted but couldn't find much to read. A text-based Google Doc, PDF, or plain-text file works best.",
  redundant: "These look like content I've already read from your website — I'll skip the duplicates and keep anything new. Nothing new here, so I haven't added it twice.",
  failed: "I couldn't read from Google just now — the connection may have expired. Want to reconnect and try again?",
};

export interface GoogleProgress { phase: string; message: string }
export interface GoogleBeat1 { state: GoogleState; googleLines: ReflectionLine[]; websiteLines: ReflectionLine[]; handoff: string | null; message: string | null }
export interface GoogleSliceResult {
  state: GoogleState;
  beat1: GoogleBeat1;
  inferredLines: ReflectionLine[];
  timing: { ingestMs: number; timeToFirstReflectionMs: number; recomputeMs: number; fullMs: number };
  resolution: { insightsTotal: number; resolved: number; rejected: number; ceilingRejected: number; hitRate: number };
  filesRead: number; unitsRead: number; redundantUnits: number; unsupportedFiles: number;
  error?: string; // surfaced Drive/read failure detail (dev diagnostic) — never a swallowed 'unsupported'
}

const isReflective = (s: GoogleState) => s === 'synced' || s === 'partial';

export async function runGoogleMagicMoment(args: {
  founderId: string; fileIds: string[]; conn: GoogleConnector; repo: IEvidenceRepository; anthropicApiKey: string; model?: string;
  onProgress?: (e: GoogleProgress) => void;
  onFirstReflection?: (b: GoogleBeat1) => void;
  onInferredLines?: (l: ReflectionLine[]) => void;
}): Promise<GoogleSliceResult> {
  const t0 = Date.now();
  args.onProgress?.({ phase: 'reading', message: `Reading ${args.fileIds.length} document${args.fileIds.length === 1 ? '' : 's'} from Google…` });

  // Spine: read granted files → extract → classify → observed google fragments in store. (Website/
  // upload evidence already present is preserved for cross-source fusion.)
  const read = await readGoogle(args.conn, args.founderId, args.fileIds);
  const ingestMs = Date.now() - t0;
  args.onProgress?.({ phase: 'reading', message: isReflective(read.state) ? `Read ${read.filesRead} document${read.filesRead === 1 ? '' : 's'} — cross-referencing with your website…` : 'Finished reading.' });

  // BEAT 1 — google observed + website observed, deterministic, fast.
  const observed = await args.repo.findObserved(args.founderId);
  const nonReflective = !isReflective(read.state);
  const beat1: GoogleBeat1 = {
    state: read.state,
    googleLines: nonReflective ? [] : buildGoogleObservedLines(observed.filter((f) => f.source === 'google')),
    websiteLines: nonReflective ? [] : buildObservedReflection({ state: 'synced', observed: observed.filter((f) => f.source === 'website'), gaps: [] }).lines,
    handoff: nonReflective ? null : HANDOFF,
    message: COPY[read.state] ?? null,
  };
  const timeToFirstReflectionMs = Date.now() - t0;
  args.onFirstReflection?.(beat1);

  const baseResult = (over: Partial<GoogleSliceResult>): GoogleSliceResult => ({
    state: read.state, beat1, inferredLines: [],
    timing: { ingestMs, timeToFirstReflectionMs, recomputeMs: 0, fullMs: timeToFirstReflectionMs },
    resolution: { insightsTotal: 0, resolved: 0, rejected: 0, ceilingRejected: 0, hitRate: 0 },
    filesRead: read.filesRead, unitsRead: read.unitsRead, redundantUnits: read.redundantUnits, unsupportedFiles: read.unsupportedFiles, error: read.error, ...over,
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
