/**
 * Slice 6.1 — deterministic photo-led domain logic: observed set signal, sufficiency, non-transplantability
 * quality gate (reuses the frozen anti-template / causal-derivation principle), observation-ref validation
 * (§5), rights-safe media selection, and canonical hashing for the immutable records. No claim authority here.
 */
import { createHash } from 'node:crypto';
import { canRenderAsMedia } from '../carousel/contracts';
import type { CarouselSourceRef } from '../carousel/contracts';
import type {
  MediaObservation, PhotoSetUnderstanding, SelectedMediaItem, ExcludedMediaItem, SufficiencyVerdict,
  MissingMaterial, OpportunityDraft,
} from './contracts';

/** Canonical (sorted-key) JSON — stable hashing consistent across records. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}
export const hashOf = (v: unknown): string => createHash('sha256').update(stableStringify(v), 'utf8').digest('hex');

const STOP = new Set(['the', 'and', 'your', 'you', 'with', 'this', 'that', 'for', 'from', 'about', 'into', 'their', 'they', 'them', 'will', 'have', 'what', 'when', 'where', 'which', 'more', 'over', 'next', 'make', 'photo', 'photos', 'image', 'carousel', 'content', 'post', 'social', 'brand', 'idea', 'angle', 'story', 'audience', 'founder', 'business']);
const tokens = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
const overlaps = (a: Set<string>, b: Set<string>): number => { let n = 0; for (const x of a) if (b.has(x)) n += 1; return n; };

/** Literal observed distribution across the set (no inference). */
export function setSignal(obs: MediaObservation[]): string {
  const by = new Map<string, number>();
  for (const o of obs) { const k = o.subject === 'scene' ? `${o.setting} scene` : o.subject; by.set(k, (by.get(k) ?? 0) + 1); }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ') || '(no usable observations)';
}

/** Observed tokens from the set — literal settings/subjects/objects/activities (used only for non-transplant + relevance). */
export function observedTokens(ps: PhotoSetUnderstanding): Set<string> {
  const parts: string[] = [];
  for (const o of ps.observations) { parts.push(o.setting, o.subject, o.activity ?? '', ...o.objects); }
  return tokens(parts.join(' '));
}

/**
 * §F/§3 non-transplantability: a recommendation must be causally tied to BOTH this strategy AND this observed
 * set — it must NOT read like generic content marketing that would survive swapping the business or the photos.
 * Deterministic backstop: the rec text (minus proper nouns) must overlap the strategy tokens AND the observed
 * tokens. Reuses the frozen anti-template principle (isCarouselTransplantable analog).
 */
export function assessNonTransplantable(draft: OpportunityDraft, businessName: string, strategyTokens: Set<string>, observed: Set<string>): { ok: boolean; reason: string } {
  const strip = (s: string): string => s.replace(new RegExp(businessName, 'gi'), ' ').replace(/\b[A-Z][a-z]+\b/g, ' ');
  const recTokens = tokens(strip([draft.founderLegibleRecommendation, draft.strategicConnection, draft.nonTransplantabilityTrace, draft.whyPhotosSupport].join(' ')));
  const strat = overlaps(recTokens, strategyTokens);
  const obs = overlaps(recTokens, observed);
  if (strat === 0) return { ok: false, reason: 'recommendation shares no token with the strategy (goal/coreBet/audience) — would transplant to any business' };
  if (obs === 0) return { ok: false, reason: 'recommendation shares no token with the observed photos — would transplant to any photo set' };
  return { ok: true, reason: `tied to strategy (${strat}) and photos (${obs})` };
}

/** RIGHTS DISPOSES (§6): keep only planned sources that are renderable founder media; the rest → excludedMedia. */
export function filterRenderable(selected: SelectedMediaItem[], sources: CarouselSourceRef[]): { kept: SelectedMediaItem[]; dropped: ExcludedMediaItem[] } {
  const kept: SelectedMediaItem[] = []; const dropped: ExcludedMediaItem[] = [];
  for (const item of selected) {
    const src = sources.find((s) => s.sourceRefId === item.sourceRefId);
    if (!src || !src.mediaRef) { dropped.push({ sourceRefId: item.sourceRefId, reason: 'not in the founder media pool' }); continue; }
    if (!canRenderAsMedia(src.reuseRight)) { dropped.push({ sourceRefId: item.sourceRefId, reason: `not renderable (rights: ${src.reuseRight})` }); continue; }
    if (src.sourceType === 'brand_asset') { dropped.push({ sourceRefId: item.sourceRefId, reason: 'brand asset — informs brand tokens, not a slide photo' }); continue; }
    kept.push(item);
  }
  return { kept, dropped };
}

/**
 * §5 persist-time validation: every observationRef must resolve to an observation OF THIS photo set that is
 * associated with the SAME source. Unknown ref / wrong-set ref / wrong-source ref ⇒ reject.
 */
export function validateObservationRefs(selected: SelectedMediaItem[], ps: PhotoSetUnderstanding): { ok: boolean; error?: string } {
  const byId = new Map(ps.observations.map((o) => [o.observationId, o] as const));
  for (const item of selected) {
    for (const ref of item.observationRefs) {
      const o = byId.get(ref);
      if (!o) return { ok: false, error: `unknown observation ref "${ref}" for photo set ${ps.photoSetUnderstandingId}` };
      if (o.sourceRefId !== item.sourceRefId) return { ok: false, error: `observation ref "${ref}" belongs to source ${o.sourceRefId}, not the selected ${item.sourceRefId}` };
    }
  }
  return { ok: true };
}

/**
 * §6/§8 sufficiency (deterministic backstop over the model's signals). INSUFFICIENT when the set cannot support
 * a photo-led carousel responsibly: no renderable hero-capable photo, OR no authorized claim basis for the job.
 * Otherwise SUFFICIENT, or SUFFICIENT_WITH_GAP when a specific missing photo would materially strengthen it.
 */
export function assessSufficiency(kept: SelectedMediaItem[], ps: PhotoSetUnderstanding, hasClaimBasis: boolean, missing: MissingMaterial[]): { verdict: SufficiencyVerdict; reason: string } {
  const usableById = new Map(ps.observations.map((o) => [o.observationId, o] as const));
  const heroCapable = kept.some((k) => k.observationRefs.some((r) => { const o = usableById.get(r); return o && o.usability !== 'unusable' && o.verdict !== 'unusable'; }) || k.role === 'hero');
  if (!kept.length || !heroCapable) return { verdict: 'insufficient', reason: 'no renderable, hero-capable founder photo in the set' };
  if (!hasClaimBasis) return { verdict: 'insufficient', reason: 'no authorized claim material to responsibly ground the carousel (photos are media, not claims)' };
  if (missing.length) return { verdict: 'sufficient_with_gap', reason: missing.map((m) => m.what).join('; ') };
  return { verdict: 'sufficient', reason: 'enough for a strong carousel' };
}
