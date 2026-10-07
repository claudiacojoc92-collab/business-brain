/**
 * Slice 7 V2 — deterministic shot matching (no LLM). Maps uploaded footage (frozen VideoSetUnderstanding) to a
 * ShootingPlan's ShotRequests by STORY JOB, not filename/order. Flexible on how a beat is filmed, strict on which
 * narrative job a clip performs. Produces ShotFulfillment, substitution, sufficiency, and the smallest missing shot.
 * It emits NO EDL, NO render, NO rights/claim authority — it is an upstream matcher over frozen observations.
 */
import { MIN_SEG_MS } from '../reel/reel';
import { CALMER_SHOT_GAP } from '../reel/reel';
import type { SegmentRole, MotionIntensity, ClipObservation, VideoSetUnderstanding } from '../reel/contracts';
import type { ShotRequest, ShootingPlanVersion, ShotFulfillment, FulfillmentReport, ShootSufficiency } from './contracts';
import { ROLE_ORDER } from './plan';

const tok = (s: string): string[] => (s.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []);
const STOP = new Set(['the', 'and', 'for', 'with', 'your', 'you', 'into', 'onto', 'this', 'that', 'film', 'clip', 'shot', 'seconds', 'second', 'phone']);
const obsTokens = (o: ClipObservation): Set<string> => new Set([o.setting, o.subject, o.activity ?? '', ...o.objects].flatMap(tok).filter((t) => !STOP.has(t)));
const shotTokens = (s: ShotRequest): Set<string> => new Set([...s.matchTokens, ...tok(s.subject), ...tok(s.visibleAction), ...tok(s.storyJob)].filter((t) => !STOP.has(t)));
const overlap = (a: Set<string>, b: Set<string>): number => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

const FRAMING_OF: Record<string, string> = { wide: 'wide', medium: 'medium', close: 'close', unknown: 'medium' };
const ENERGY_RANK: Record<MotionIntensity, number> = { low: 0, medium: 1, high: 2 };

/** The longest usable span of an observation, as a hint window (V1 picks the exact in/out). */
function hintWindow(o: ClipObservation): { inMs: number; outMs: number } | null {
  const spans = [...o.usableSpans].sort((a, b) => (b.endMs - b.startMs) - (a.endMs - a.startMs));
  if (spans.length && spans[0]!.endMs - spans[0]!.startMs >= MIN_SEG_MS) return { inMs: spans[0]!.startMs, outMs: spans[0]!.endMs };
  if (o.durationMs >= MIN_SEG_MS) return { inMs: Math.round(o.durationMs * 0.05), outMs: Math.round(o.durationMs * 0.95) };
  return null;
}

interface Cand { readonly obs: ClipObservation; readonly score: number; readonly jobOverlap: number; readonly window: { inMs: number; outMs: number } }
/** Score how well an observation performs a shot's STORY JOB. Returns null if it does not perform the job at all. */
function scoreFor(shot: ShotRequest, o: ClipObservation): Cand | null {
  if (o.verdict === 'unusable') return null;
  const win = hintWindow(o);
  if (!win) return null;
  const jobOverlap = overlap(shotTokens(shot), obsTokens(o));
  if (jobOverlap < 1) return null;                       // wrong footage → does not perform this job
  let score = jobOverlap * 10;
  if (FRAMING_OF[o.shotScale] === shot.framing) score += 3;      // framing bonus (soft)
  if (o.orientation === 'portrait') score += 2; else score -= 2; // vertical preferred
  if (shot.audioNeed === 'spoken_line') { if (o.speechPresent && o.shot === 'talking_head') score += 4; else score -= 6; }
  if (shot.visualEnergyNeed) score -= Math.abs(ENERGY_RANK[o.motionIntensity] - ENERGY_RANK[shot.visualEnergyNeed]) * 3;
  return { obs: o, score, jobOverlap, window: win };
}

function statusFor(shot: ShotRequest, o: ClipObservation): { status: ShotFulfillment['status']; reasons: string[]; missing?: string } {
  const reasons: string[] = [`performs the ${shot.sequenceRole} job`];
  let weak = false;
  if (o.orientation !== 'portrait') { weak = true; reasons.push('filmed non-vertical (usable, not ideal)'); }
  if (shot.audioNeed === 'spoken_line' && !(o.speechPresent && o.shot === 'talking_head')) {
    return { status: 'missing', reasons, missing: 'this shot needs you speaking to camera' };
  }
  if (shot.visualEnergyNeed && ENERGY_RANK[o.motionIntensity] !== ENERGY_RANK[shot.visualEnergyNeed]) { weak = true; reasons.push(`energy is ${o.motionIntensity}, wanted ${shot.visualEnergyNeed}`); }
  return { status: weak ? 'partial' : 'satisfied', reasons };
}

/** Match uploaded footage to the plan. Deterministic. Story-job first; substitution fills required gaps from spare
 *  clips (including ones filmed for optional beats); no filename/order trust. */
export function matchFootage(plan: ShootingPlanVersion, vsu: VideoSetUnderstanding, now: string): ShotFulfillment[] {
  const obs = vsu.observations;
  const assigned = new Map<string, string>();     // observationId → shotId
  const result = new Map<string, ShotFulfillment>();
  const shotsByPriority = [...plan.shotRequests].sort((a, b) => (Number(b.required) - Number(a.required)) || (ROLE_ORDER[a.sequenceRole] - ROLE_ORDER[b.sequenceRole]));

  // a spoken-line shot can only be satisfied by a clip of someone actually speaking to camera
  const eligible = (shot: ShotRequest, c: Cand): boolean => shot.audioNeed !== 'spoken_line' || (c.obs.speechPresent && c.obs.shot === 'talking_head');

  const fulfil = (shot: ShotRequest, cand: Cand | null, substitutedFrom: string | null): void => {
    if (!cand) { result.set(shot.shotId, base(shot.shotId, 'missing', now, { missingReason: whyMissing(shot, obs) })); return; }
    const st = statusFor(shot, cand.obs);
    assigned.set(cand.obs.observationId, shot.shotId);
    result.set(shot.shotId, {
      shotId: shot.shotId, status: st.status, matchedSourceRefId: cand.obs.sourceRefId,
      observationRef: cand.obs.observationId, matchedRange: cand.window, matchReasons: st.reasons,
      missingReason: st.missing ?? null, substitutedFromShotId: substitutedFrom, producedAt: now,
    });
  };

  // pass 1 — best eligible unassigned candidate per shot (required first). Non-filmed shots (on-screen text cards)
  // need no footage — BB/the editor makes them — so they are auto-satisfied and never counted as a gap.
  for (const shot of shotsByPriority) {
    if (!shot.founderFilms) { result.set(shot.shotId, base(shot.shotId, 'satisfied', now, { matchReasons: ['on-screen text card — no filming needed'] })); continue; }
    const best = obs.filter((o) => !assigned.has(o.observationId)).map((o) => scoreFor(shot, o)).filter((c): c is Cand => c != null && eligible(shot, c)).sort((a, b) => b.score - a.score)[0] ?? null;
    fulfil(shot, best, null);
  }

  // pass 2 — substitution: fill still-missing REQUIRED beats from spare clips (unassigned or assigned to OPTIONAL shots)
  const optionalShotIds = new Set(plan.shotRequests.filter((s) => !s.required).map((s) => s.shotId));
  for (const shot of shotsByPriority.filter((s) => s.required && result.get(s.shotId)!.status === 'missing')) {
    const spare = obs.filter((o) => !assigned.has(o.observationId) || optionalShotIds.has(assigned.get(o.observationId)!));
    const cand = spare.map((o) => scoreFor(shot, o)).filter((c): c is Cand => c != null && eligible(shot, c)).sort((a, b) => b.score - a.score)[0];
    if (!cand) continue;
    const stolenFrom = assigned.get(cand.obs.observationId) ?? null;
    if (stolenFrom) result.set(stolenFrom, base(stolenFrom, 'missing', now, { missingReason: 'clip reused for a more important beat' }));
    fulfil(shot, cand, stolenFrom);
  }

  // provenance: a clip whose STRONGEST job match is a different shot than the beat it filled is a substitution
  const topShotFor = (o: ClipObservation): string | null =>
    plan.shotRequests.filter((s) => s.founderFilms).map((s) => ({ s, c: scoreFor(s, o) })).filter((x) => x.c != null && eligible(x.s, x.c!)).sort((a, b) => b.c!.score - a.c!.score)[0]?.s.shotId ?? null;
  for (const s of plan.shotRequests) {
    const f = result.get(s.shotId)!;
    if (!f.observationRef || f.substitutedFromShotId) continue;
    const o = obs.find((x) => x.observationId === f.observationRef)!;
    const top = topShotFor(o);
    if (top && top !== s.shotId) result.set(s.shotId, { ...f, substitutedFromShotId: top, matchReasons: [...f.matchReasons, 'substituted from another beat'] });
  }

  return plan.shotRequests.map((s) => result.get(s.shotId)!);
}

function base(shotId: string, status: ShotFulfillment['status'], now: string, extra: Partial<ShotFulfillment> = {}): ShotFulfillment {
  return { shotId, status, matchedSourceRefId: null, observationRef: null, matchedRange: null, matchReasons: [], missingReason: null, substitutedFromShotId: null, producedAt: now, ...extra };
}
function whyMissing(shot: ShotRequest, obs: ClipObservation[]): string {
  if (shot.audioNeed === 'spoken_line' && !obs.some((o) => o.speechPresent)) return 'I don’t see a clip of you speaking to camera';
  return `I don’t see a clip that does the ${shot.sequenceRole} job`;
}

/** Sufficiency + the ONE smallest missing shot. Partial counts as present. Visual-energy mismatch across the whole
 *  set (calm concept, all high-energy footage) triggers an honest "one calmer shot" ask (mirrors frozen V1). */
export function assessShootSufficiency(plan: ShootingPlanVersion, fulfillments: ShotFulfillment[], conceptEnergy: MotionIntensity | 'calm' | 'balanced' | 'energetic'): {
  sufficiency: ShootSufficiency; smallestMissing: FulfillmentReport['smallestMissing'];
} {
  const byId = new Map(fulfillments.map((f) => [f.shotId, f]));
  const req = plan.shotRequests.filter((s) => s.required && s.founderFilms);   // text cards need no footage → never a gap
  const present = (f: ShotFulfillment) => f.status === 'satisfied' || f.status === 'partial';
  const hook = req.find((s) => s.sequenceRole === 'hook');
  const hookPresent = !hook || present(byId.get(hook.shotId)!);
  const missingReq = req.filter((s) => !present(byId.get(s.shotId)!)).sort((a, b) => ROLE_ORDER[a.sequenceRole] - ROLE_ORDER[b.sequenceRole]);
  const presentReq = req.filter((s) => present(byId.get(s.shotId)!)).length;

  // calm concept but every matched clip is high-energy → ask for one calmer shot (do not fabricate calm)
  const matched = fulfillments.filter((f) => f.observationRef && present(f));
  if (conceptEnergy === 'calm' && matched.length > 0 && matched.every((f) => (f.matchReasons.join(' ').match(/energy is high/) ))) {
    return { sufficiency: 'sufficient_with_gap', smallestMissing: { shotId: 'calmer', founderAsk: `${CALMER_SHOT_GAP.what} — ${CALMER_SHOT_GAP.whyItHelps}` } };
  }

  if (!hookPresent || presentReq < 2 || missingReq.length > 2) {
    const first = missingReq[0];
    return { sufficiency: 'insufficient', smallestMissing: first ? { shotId: first.shotId, founderAsk: askFor(first) } : null };
  }
  if (missingReq.length === 0) return { sufficiency: 'sufficient', smallestMissing: null };
  const first = missingReq[0]!;
  return { sufficiency: 'sufficient_with_gap', smallestMissing: { shotId: first.shotId, founderAsk: askFor(first) } };
}

function askFor(shot: ShotRequest): string {
  const secs = Math.max(3, Math.round(shot.approxDurationMs / 1000));
  return `One more — a ${secs}-second ${shot.framing} shot: ${shot.founderProse}`;
}

export function assembleReport(plan: ShootingPlanVersion, vsu: VideoSetUnderstanding, conceptEnergy: 'calm' | 'balanced' | 'energetic', now: string): FulfillmentReport {
  const fulfillments = matchFootage(plan, vsu, now);
  const { sufficiency, smallestMissing } = assessShootSufficiency(plan, fulfillments, conceptEnergy);
  return { shootingPlanVersionId: plan.versionId, videoSetUnderstandingId: vsu.videoSetUnderstandingId, fulfillments, sufficiency, smallestMissing, producedAt: now };
}

export type { SegmentRole };
