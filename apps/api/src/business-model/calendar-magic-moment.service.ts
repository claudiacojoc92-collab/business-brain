/**
 * Calendar end-to-end service — TWO BEATS (behavior dimension). Mirrors the Google service and adds
 * Capability C's "what matters now", because the payoff of the Calendar Source IS the time-vs-intent
 * tension.
 *   Beat 1: read the founder's calendar → temporal `observed` evidence (time-allocation patterns) →
 *           grounded reflection showing WHAT THEIR TIME SHOWS (observed behavior) alongside WHAT THEY
 *           TOLD US (declared intent), kept distinct.
 *   Beat 2: recomputeFromSources (frozen engine, fail-closed, spanning website+upload+google+
 *           calendar+declared) → inferred lines, then C ranks the grounded tensions → the time-vs-
 *           intent tension surfaces in "what matters now".
 *
 * Honest throughout; every rendered line traces to real fragment ids. Engine byte-identical; no new
 * confidence_kind; the SAME recompute path (calendar is just another observed source it already reads).
 */
import type { IEvidenceRepository, EvidenceFragment } from '@bb/domain';
import type { BusinessModel } from '@bb/business-model-engine';
import type { GoogleConnector } from '../connectors/google/google.connector';
import { recomputeFromSources } from './recompute';
import {
  buildObservedReflection, buildCalendarObservedLines, buildDeclaredLines, buildInferredLines,
  type ReflectionLine,
} from './reflection';
import { buildWhatMattersNow, type WhatMattersItem } from './what-matters';

const INSIGHT_KEYS: ReadonlyArray<keyof BusinessModel> = [
  'contradictions', 'blindSpots', 'hiddenStrengths', 'hiddenWeaknesses', 'positioningOpportunities',
];

const HANDOFF = "That's what your time actually shows, next to what you told me you're building. Where they pull apart is what matters most.";
const EMPTY = "I connected to your calendar but found no scheduled events in the last 60 days to read a pattern from. Add a few and I'll show you where your time is really going.";

export type CalendarState = 'synced' | 'empty' | 'failed';

export interface CalendarProgress { phase: string; message: string }
export interface CalendarBeat1 {
  state: CalendarState;
  calendarLines: ReflectionLine[];   // "Your calendar shows: …" (observed behavior)
  declaredLines: ReflectionLine[];    // "You told me: …" (declared intent), kept distinct
  websiteLines: ReflectionLine[];
  handoff: string | null;
  message: string | null;
}
export interface CalendarSliceResult {
  state: CalendarState;
  beat1: CalendarBeat1;
  inferredLines: ReflectionLine[];
  whatMattersNow: WhatMattersItem[]; // the time-vs-intent tension surfaces here (Capability C)
  timing: { ingestMs: number; timeToFirstReflectionMs: number; recomputeMs: number; fullMs: number };
  resolution: { insightsTotal: number; resolved: number; rejected: number; ceilingRejected: number; hitRate: number };
  eventsRead: number; fragmentsStored: number;
  error?: string;
}

export async function runCalendarMagicMoment(args: {
  founderId: string; conn: GoogleConnector; repo: IEvidenceRepository; anthropicApiKey: string; model?: string;
  windowDays?: number; now?: Date;
  onProgress?: (e: CalendarProgress) => void;
  onFirstReflection?: (b: CalendarBeat1) => void;
  onInferredLines?: (l: ReflectionLine[]) => void;
  onWhatMatters?: (w: WhatMattersItem[]) => void;
}): Promise<CalendarSliceResult> {
  const t0 = Date.now();
  args.onProgress?.({ phase: 'reading', message: 'Reading how you actually spend your time…' });

  // Spine: read calendar → temporal observed evidence in the store (fail closed inside syncCalendar).
  let sync;
  try {
    sync = await args.conn.syncCalendar(args.founderId, { windowDays: args.windowDays, now: args.now });
  } catch (e) {
    const beat1: CalendarBeat1 = { state: 'failed', calendarLines: [], declaredLines: [], websiteLines: [], handoff: null, message: "I couldn't read from your calendar just now — the connection may have expired. Want to reconnect and try again?" };
    args.onFirstReflection?.(beat1);
    return base(beat1, cap(t0), { error: e instanceof Error ? e.message : 'calendar read error' });
  }
  const ingestMs = Date.now() - t0;

  const all = await args.repo.findByFounder(args.founderId);
  const calendarObserved = all.filter((f) => f.source === 'google-calendar' && f.confidenceKind === 'observed');
  const declaredFrags = all.filter((f) => f.confidenceKind === 'declared');
  const websiteObserved = all.filter((f) => f.source === 'website' && f.confidenceKind === 'observed');

  if (!sync.hasPattern || calendarObserved.length === 0) {
    const beat1: CalendarBeat1 = { state: 'empty', calendarLines: [], declaredLines: [], websiteLines: [], handoff: null, message: EMPTY };
    args.onFirstReflection?.(beat1);
    return base(beat1, cap(t0), { eventsRead: sync.eventsRead });
  }

  // BEAT 1 — observed behavior (calendar) + declared intent, kept distinct.
  const beat1: CalendarBeat1 = {
    state: 'synced',
    calendarLines: buildCalendarObservedLines(calendarObserved),
    declaredLines: buildDeclaredLines(declaredFrags),
    websiteLines: buildObservedReflection({ state: 'synced', observed: websiteObserved, gaps: [] }).lines,
    handoff: HANDOFF,
    message: null,
  };
  const timeToFirstReflectionMs = Date.now() - t0;
  args.onFirstReflection?.(beat1);

  // BEAT 2 — synthesis behind: frozen engine across ALL sources (incl calendar) → fail-closed.
  const tR = Date.now();
  const rec = await recomputeFromSources({ founderId: args.founderId, repo: args.repo, anthropicApiKey: args.anthropicApiKey, model: args.model });
  const recomputeMs = Date.now() - tR;
  const afterRec = await args.repo.findByFounder(args.founderId);
  const inferred = afterRec.filter((f: EvidenceFragment) => f.confidenceKind === 'inferred');
  const inferredLines = buildInferredLines(inferred);
  args.onInferredLines?.(inferredLines);

  // Capability C — rank the grounded tensions; the time-vs-intent tension surfaces here.
  const whatMattersNow = buildWhatMattersNow(inferred, afterRec);
  args.onWhatMatters?.(whatMattersNow);

  const insightsTotal = INSIGHT_KEYS.reduce((n, k) => n + ((rec.model[k] as unknown[] | undefined)?.length ?? 0), 0);
  return {
    state: 'synced', beat1, inferredLines, whatMattersNow,
    timing: { ingestMs, timeToFirstReflectionMs, recomputeMs, fullMs: Date.now() - t0 },
    resolution: { insightsTotal, resolved: rec.persisted, rejected: rec.rejected.length, ceilingRejected: rec.ceilingRejected.length, hitRate: insightsTotal > 0 ? rec.persisted / insightsTotal : 0 },
    eventsRead: sync.eventsRead, fragmentsStored: sync.fragmentsStored,
  };
}

const cap = (t0: number) => ({ ingestMs: Date.now() - t0, timeToFirstReflectionMs: Date.now() - t0, recomputeMs: 0, fullMs: Date.now() - t0 });

function base(beat1: CalendarBeat1, timing: CalendarSliceResult['timing'], over: Partial<CalendarSliceResult>): CalendarSliceResult {
  return {
    state: beat1.state, beat1, inferredLines: [], whatMattersNow: [], timing,
    resolution: { insightsTotal: 0, resolved: 0, rejected: 0, ceilingRejected: 0, hitRate: 0 },
    eventsRead: 0, fragmentsStored: 0, ...over,
  };
}
