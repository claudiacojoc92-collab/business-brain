/**
 * Slice 7 — deterministic reel domain logic (no LLM, no side effects). Rights disposal, exact-range validation,
 * non-transplantability, sufficiency, the immutable EDL/timeline build + hash, duration contract, and the
 * spoken-claim disposition rule. Mirrors the frozen photocarousel deterministic gates.
 */
import { createHash } from 'node:crypto';
import { generateId } from '@bb/shared';
import type {
  ClipObservation, VideoSetUnderstanding, ReelSourceRef, SelectedClipRange, ExcludedClip,
  ReelTimeline, TimelineSegment, ReelTextBlock, TextOverlay, ReelOpportunityDraft, ReelSufficiency,
  SpokenClaimDisposition, ClipTranscript, TranscriptSegment, SegmentRole, MotionIntensity, EditingEnergy, MissingShot,
} from './contracts';
import { canRenderClip } from './contracts';

export const MIN_REEL_MS = 5000;
export const MAX_REEL_MS = 30000;   // V1 duration contract (job/footage-driven; never padded)
export const MIN_SEG_MS = 700;      // a segment shorter than this is not a usable beat
const ROLE_ORDER: Record<SegmentRole, number> = { hook: 0, build: 1, proof: 2, detail: 3, close: 4 };

const sha = (o: unknown): string => createHash('sha256').update(JSON.stringify(o), 'utf8').digest('hex');
export const hashOf = (o: unknown): string => sha(o);
const tokens = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []));

/** Literal observed distribution (founder-invisible signal). */
export function setSignal(obs: ClipObservation[]): string {
  const by = new Map<string, number>();
  for (const o of obs) { const k = `${o.subject}/${o.shot}`; by.set(k, (by.get(k) ?? 0) + 1); }
  return [...by.entries()].map(([k, n]) => `${n} ${k}`).join(', ');
}
export function observedTokens(vs: VideoSetUnderstanding): Set<string> {
  const t = new Set<string>();
  for (const o of vs.observations) { tokens([o.setting, o.subject, o.activity ?? '', ...o.objects].join(' ')).forEach((x) => t.add(x)); }
  return t;
}

// ── Rights: a selected range may render only from a renderable, existing source with a REAL usable span. ──
export function filterRenderableRanges(ranges: SelectedClipRange[], sources: ReelSourceRef[], obs: ClipObservation[]):
  { kept: SelectedClipRange[]; dropped: ExcludedClip[] } {
  const kept: SelectedClipRange[] = []; const dropped: ExcludedClip[] = [];
  for (const r of ranges) {
    const src = sources.find((s) => s.sourceRefId === r.sourceRefId);
    const o = obs.find((x) => x.observationId === r.observationRef && x.sourceRefId === r.sourceRefId);
    if (!src) { dropped.push({ sourceRefId: r.sourceRefId, reason: 'source not found' }); continue; }
    if (!canRenderClip(src.reuseRight)) { dropped.push({ sourceRefId: r.sourceRefId, reason: `rights: ${src.reuseRight} may not render` }); continue; }
    if (!o) { dropped.push({ sourceRefId: r.sourceRefId, reason: 'observation ref invalid' }); continue; }
    if (o.verdict === 'unusable') { dropped.push({ sourceRefId: r.sourceRefId, reason: 'clip unusable' }); continue; }
    const inMs = Math.max(0, Math.min(r.inMs, o.durationMs));
    const outMs = Math.max(inMs, Math.min(r.outMs, o.durationMs));
    if (outMs - inMs < MIN_SEG_MS) { dropped.push({ sourceRefId: r.sourceRefId, reason: 'no clean usable range' }); continue; }
    // clamp the range to a declared usable span when the model over-reached into a rejected region
    kept.push({ ...r, inMs, outMs });
  }
  return { kept, dropped };
}

/** §5 STRICT: every selected observationRef must exist AND belong to its clip. */
export function validateSelectionRefs(ranges: SelectedClipRange[], vs: VideoSetUnderstanding): { ok: boolean; error?: string } {
  for (const r of ranges) {
    const o = vs.observations.find((x) => x.observationId === r.observationRef);
    if (!o) return { ok: false, error: `unknown observation ref ${r.observationRef}` };
    if (o.sourceRefId !== r.sourceRefId) return { ok: false, error: `observation ${r.observationRef} not from source ${r.sourceRefId}` };
  }
  return { ok: true };
}

/** Non-transplantable: the recommendation must be grounded in BOTH this strategy AND these observed clips, and
 *  not be a generic template. Mirrors the frozen photocarousel anti-transplant gate. */
export function assessNonTransplantable(draft: ReelOpportunityDraft, businessName: string, strategyTokens: Set<string>, observed: Set<string>):
  { ok: boolean; reason: string } {
  const recTokens = tokens([draft.communicationJob, draft.narrativeArc, draft.whyFootageSupports, draft.strategicConnection].join(' '));
  const nameTok = tokens(businessName);
  const overlapsStrategy = [...recTokens].some((t) => strategyTokens.has(t) && !nameTok.has(t));
  const overlapsObserved = [...recTokens].some((t) => observed.has(t));
  const generic = /\b(behind[- ]the[- ]scenes|show your journey|day in the life|just be authentic|tell your story)\b/i.test(draft.communicationJob + ' ' + draft.narrativeArc)
    && !draft.nonTransplantabilityTrace.trim();
  if (!overlapsStrategy) return { ok: false, reason: 'recommendation does not connect to this strategy' };
  if (!overlapsObserved) return { ok: false, reason: 'recommendation not grounded in these clips' };
  if (generic) return { ok: false, reason: 'generic template angle' };
  if (!draft.selectedRanges.length) return { ok: false, reason: 'no clip ranges selected' };
  return { ok: true, reason: 'grounded in strategy + these clips' };
}

/** Sufficiency: enough governable material (a claim basis) + a hook + ≥3 usable ranges → sufficient; a small
 *  useful gap → sufficient_with_gap; otherwise insufficient. */
export function assessSufficiency(kept: SelectedClipRange[], hasClaimBasis: boolean, missing: { what: string }[]): ReelSufficiency {
  if (kept.length < 3 || !hasClaimBasis) return 'insufficient';
  const totalMs = kept.reduce((a, r) => a + (r.outMs - r.inMs), 0);
  if (totalMs < MIN_REEL_MS) return 'insufficient';
  if (missing.length > 0) return 'sufficient_with_gap';
  return 'sufficient';
}

// ── Editorial-fit: match the VISUAL ENERGY of the OPENING clip to the concept's treatment intent. ──
// A small additive creative-director gate. It reads only literal media facts (motionIntensity) and an execution
// decision (editingEnergy). It infers NO emotion/aggression/psychology — "battle ropes = high physical motion"
// is allowed; "the person is intense/angry" is not. It never fabricates calmness: if the footage cannot match a
// calm concept, it asks for one calmer shot rather than opening on intensity.

const INTENSITY_RANK: Record<MotionIntensity, number> = { low: 0, medium: 1, high: 2 };

// Bounded lexicons over STRATEGY/CONCEPT text (execution treatment, not business truth).
const CALM_MARKERS = /\b(sustainab\w*|gentle|calm\w*|slow\w*|steady|realistic|everyday|normal|quiet|minimal\w*|relax\w*|longevity|consisten\w*|balance\w*|manageable|grounded|not[ -](?:extreme|hype|hard)|without[ -]burnout|habit\w*)\b/i;
const ENERGETIC_MARKERS = /\b(launch\w*|urgen\w*|intens\w*|high[ -]energy|momentum|challenge\w*|hype\w*|explosiv\w*|power\w*|bootcamp|blitz|countdown|hurry|deadline|last[ -]chance|beast|hardcore|sprint\w*|amp\w*|max[ -]out|go[ -]hard|push[ -]hard)\b/i;

/** Derive the smallest treatment signal from strategy + concept text. Deterministic; bounded lexicon.
 *  sustainable/normal/not-extreme → calm; high-energy/urgency/challenge → energetic; otherwise balanced. */
export function deriveEditingEnergy(signals: string): EditingEnergy {
  const calm = CALM_MARKERS.test(signals);
  const energetic = ENERGETIC_MARKERS.test(signals);
  if (energetic && !calm) return 'energetic';
  if (calm && !energetic) return 'calm';
  return 'balanced';
}

/** Literal visual energy of a selected range's clip (observed media fact; defaults to medium if unobserved). */
export function rangeMotionIntensity(range: SelectedClipRange, obs: ClipObservation[]): MotionIntensity {
  const o = obs.find((x) => x.observationId === range.observationRef) ?? obs.find((x) => x.sourceRefId === range.sourceRefId);
  return o?.motionIntensity ?? 'medium';
}

export type EditorialFitVerdict =
  | 'coherent'                      // the opener's energy already fits the treatment
  | 'conflict_has_alternative'      // calm concept opening on high energy, but a calmer eligible clip exists
  | 'conflict_no_alternative'       // calm concept but ALL eligible clips are high energy → must ask for a calmer shot
  | 'understrength_has_alternative';// energetic concept opening on a calm clip while a higher-energy clip is eligible
export interface EditorialFit {
  readonly verdict: EditorialFitVerdict;
  readonly editingEnergy: EditingEnergy;
  readonly hookIntensity: MotionIntensity;
  readonly calmerLeadRef: string | null;      // observationRef of a lower-energy eligible lead (demote/lead-swap)
  readonly energeticLeadRef: string | null;   // observationRef of a higher-energy eligible lead (energetic concept)
}

/** Does the opener's visual energy fit the concept? A calm concept must not OPEN on the highest-motion clip merely
 *  because it moves the most; an energetic concept may (and should) lead with it. Pure, deterministic. */
export function assessEditorialFit(kept: SelectedClipRange[], obs: ClipObservation[], editingEnergy: EditingEnergy): EditorialFit {
  const hook = kept.find((r) => r.role === 'hook') ?? kept[0];
  if (!hook) return { verdict: 'coherent', editingEnergy, hookIntensity: 'medium', calmerLeadRef: null, energeticLeadRef: null };
  const hookIntensity = rangeMotionIntensity(hook, obs);
  const others = kept.filter((r) => r !== hook).map((r) => ({ r, i: INTENSITY_RANK[rangeMotionIntensity(r, obs)] }));
  const calmerLeadRef = others.filter((x) => x.i < INTENSITY_RANK[hookIntensity]).sort((a, b) => a.i - b.i)[0]?.r.observationRef ?? null;
  const energeticLeadRef = others.filter((x) => x.i > INTENSITY_RANK[hookIntensity]).sort((a, b) => b.i - a.i)[0]?.r.observationRef ?? null;
  if (editingEnergy === 'calm' && hookIntensity === 'high') {
    return { verdict: calmerLeadRef ? 'conflict_has_alternative' : 'conflict_no_alternative', editingEnergy, hookIntensity, calmerLeadRef, energeticLeadRef: null };
  }
  if (editingEnergy === 'energetic' && hookIntensity !== 'high' && energeticLeadRef) {
    return { verdict: 'understrength_has_alternative', editingEnergy, hookIntensity, calmerLeadRef: null, energeticLeadRef };
  }
  return { verdict: 'coherent', editingEnergy, hookIntensity, calmerLeadRef, energeticLeadRef };
}

/** Deterministic backstop: make the ref the hook and demote the current hook to a supporting 'build' beat. Every
 *  other range keeps its role. Used only when the model didn't self-correct after a re-prompt. */
export function leadWith(kept: SelectedClipRange[], newLeadObservationRef: string): SelectedClipRange[] {
  const lead = kept.find((r) => r.observationRef === newLeadObservationRef);
  if (!lead) return kept;
  const oldHook = kept.find((r) => r.role === 'hook');
  return kept.map((r) => {
    if (r === lead) return { ...r, role: 'hook' as SegmentRole };
    if (oldHook && r === oldHook) return { ...r, role: 'build' as SegmentRole };
    return r;
  });
}

/** The honest fail-closed request when a calm concept has no calm footage — never fabricate calmness. */
export const CALMER_SHOT_GAP: MissingShot = {
  what: 'one calmer 3–5 second training shot',
  whyItHelps: 'so the opening matches your calm, sustainable message instead of leading on the most intense clip',
};

/** Duration contract: never padded; bounded to [MIN,MAX]; driven by the sum of selected usable ranges. */
export function targetDuration(kept: SelectedClipRange[], proposedMs: number): number {
  const total = kept.reduce((a, r) => a + (r.outMs - r.inMs), 0);
  return Math.max(MIN_REEL_MS, Math.min(MAX_REEL_MS, Math.min(total, proposedMs || total)));
}

// ── Build the immutable EDL from ordered selected ranges + governed copy. Hook overlay on the opener; CTA on the
//    closer when present. V1: hard cuts, center-crop reframe (null), per-segment audio. ──
export function buildTimeline(ranges: SelectedClipRange[], textBlocks: ReelTextBlock[], canvas = { width: 1080, height: 1920, fps: 30 }): ReelTimeline {
  const ordered = [...ranges].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  const hook = textBlocks.find((b) => b.role === 'hook');
  const cta = textBlocks.find((b) => b.role === 'cta');
  const segments: TimelineSegment[] = ordered.map((r, i): TimelineSegment => {
    const durMs = r.outMs - r.inMs;
    const overlays: TextOverlay[] = [];
    if (i === 0 && hook) overlays.push({ blockId: hook.blockId, startMs: 250, endMs: Math.min(durMs, 2600), safeRegion: 'bottom' });
    if (i === ordered.length - 1 && cta) overlays.push({ blockId: cta.blockId, startMs: Math.max(0, durMs - 2200), endMs: durMs, safeRegion: 'bottom' });
    return {
      segmentId: generateId(), order: i, sourceRefId: r.sourceRefId, inMs: r.inMs, outMs: r.outMs, role: r.role,
      reframe: null, audioUse: r.audioUse, transitionIn: 'cut', overlays, locked: false,
    };
  });
  const totalDurationMs = segments.reduce((a, s) => a + (s.outMs - s.inMs), 0);
  return { canvas, segments, totalDurationMs };
}

/** DETERMINISTIC lineage anchor — a hash of the edit decision (not the MP4 bytes). Overlay TEXT is included so a
 *  copy-only change mints a new edl hash; segment identities are excluded (order+source+range+role define the cut). */
export function edlHash(timeline: ReelTimeline, textBlocks: ReelTextBlock[]): string {
  const blockText = new Map(textBlocks.map((b) => [b.blockId, b.text]));
  const canon = {
    canvas: timeline.canvas,
    segments: timeline.segments.map((s) => ({
      order: s.order, sourceRefId: s.sourceRefId, inMs: s.inMs, outMs: s.outMs, role: s.role,
      reframe: s.reframe, audioUse: s.audioUse, transitionIn: s.transitionIn,
      overlays: s.overlays.map((o) => ({ text: blockText.get(o.blockId) ?? '', startMs: o.startMs, endMs: o.endMs, region: o.safeRegion })),
    })),
  };
  return sha(canon);
}

/**
 * Spoken-claim disposition — the governed decision for a spoken segment BB might amplify. Given the kernel's
 * verdict on whether the SPOKEN TEXT introduces an unauthorized substantive proposition, and whether that
 * segment is load-bearing for the reel (i.e. it carries the hook/spine), decide how the clip may be used.
 * Using a clip ≠ broadcasting its claim: an incidental unsupported claim → use the clip MUTED as B-roll; a
 * load-bearing one → block.
 */
export function disposeSpokenClaim(input: { hasUnauthorizedClaim: boolean; loadBearing: boolean }): SpokenClaimDisposition {
  if (!input.hasUnauthorizedClaim) return input.loadBearing ? 'authorized_may_feature' : 'no_substantive_claim';
  return input.loadBearing ? 'load_bearing_blocked' : 'incidental_use_muted';
}

/** A segment is "load-bearing" for speech when it is the hook/opening beat or the only proof beat. */
export function isLoadBearingRange(range: SelectedClipRange, all: SelectedClipRange[]): boolean {
  if (range.role === 'hook') return true;
  const proofs = all.filter((r) => r.role === 'proof');
  return range.role === 'proof' && proofs.length === 1;
}

/** The spoken text of a range (joined transcript segments overlapping [inMs,outMs]). */
export function spokenTextOf(range: SelectedClipRange, transcript: ClipTranscript | null): string {
  if (!transcript || transcript.status !== 'transcribed') return '';
  return transcript.segments
    .filter((s: TranscriptSegment) => s.endMs > range.inMs && s.startMs < range.outMs)
    .map((s) => s.text).join(' ').trim();
}
