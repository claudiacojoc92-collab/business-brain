/**
 * Slice 6 — deterministic composition: a coherent asset-level CarouselCopyDraft + Concept → structured,
 * addressable Slides (stable ids). The coherent visual system + per-slide composition are assigned by the
 * planner in ./visual-system (BB chooses; no founder template picker).
 */
import { generateId } from '@bb/shared';
import { canRenderAsMedia } from './contracts';
import type { CarouselSourceRef } from './contracts';

/** A source may fill a SLIDE image slot only when it is reusable AND is content media — a logo the founder
 * uploaded as a brand asset informs brand tokens, never a full-bleed slide photo. */
const isSlideMedia = (s: CarouselSourceRef): boolean => Boolean(s.mediaRef) && canRenderAsMedia(s.reuseRight) && s.sourceType !== 'brand_asset';
import type {
  CarouselCopyDraft, Concept, Slide, TextBlock, MediaSlot, SlideRole, LayoutFamily, AssetAuthorizationSnapshot, MediaPlanItem,
} from './contracts';

const layoutForRole = (role: SlideRole): LayoutFamily => {
  switch (role) {
    case 'hook': return 'hero_hook';
    case 'proof': return 'proof_stat';
    case 'step': return 'structured_list';
    case 'reframe': return 'contrast_reframe';
    case 'cta': return 'cta_close';
    default: return 'editorial_text';
  }
};

/** Compose Slides from the asset-level copy + concept outline. Stable ids minted here; index/order ≠ identity. */
export function composeSlides(copy: CarouselCopyDraft, concept: Concept, snapshot: AssetAuthorizationSnapshot): Slide[] {
  const bindFor = (slideKey: string, role: TextBlock['role']): TextBlock['authorizedFrom'] => {
    const b = copy.propositionBindings.find((x) => x.blockRef === `${slideKey}:${role}`);
    return { propositionRef: b?.propositionRef ?? null, sourceRefId: b?.sourceRefId ?? null, ctaFunction: b?.ctaFunction ?? null };
  };
  return copy.orderedSlideCopy.map((sc, i): Slide => {
    const slideId = generateId();
    const blocks: TextBlock[] = [];
    if (sc.kicker) blocks.push({ blockId: generateId(), role: 'kicker', text: sc.kicker, authorizedFrom: bindFor(sc.slideKey, 'kicker'), locked: false });
    const headText = i === 0 ? (sc.headline || copy.hook) : (sc.headline ?? '');
    if (headText) blocks.push({ blockId: generateId(), role: 'headline', text: headText, authorizedFrom: bindFor(sc.slideKey, 'headline'), locked: false });
    if (sc.body) blocks.push({ blockId: generateId(), role: 'body', text: sc.body, authorizedFrom: bindFor(sc.slideKey, 'body'), locked: false });
    if (sc.role === 'cta') blocks.push({ blockId: generateId(), role: 'cta', text: copy.cta, authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: snapshot.ctaFunction }, locked: false });
    const sourceRefIds = blocks.map((b) => b.authorizedFrom.sourceRefId).filter((x): x is string => Boolean(x));
    // Option A media: a bound source becomes a rendered image slot ONLY when it is a media asset the founder
    // may reuse (owned / founder_uploaded / licensed). reference_only / unknown inform claims but NEVER render.
    const mediaSlots: MediaSlot[] = [];
    for (const rid of [...new Set(sourceRefIds)]) {
      const src = snapshot.sourceRefs.find((s) => s.sourceRefId === rid);
      if (src && isSlideMedia(src)) mediaSlots.push({ slotId: generateId(), kind: 'image', sourceRefId: rid, fit: 'cover', locked: false });
    }
    const layoutFamily: LayoutFamily = mediaSlots.length ? 'split_media' : layoutForRole(sc.role);
    return { slideId, order: i, semanticRole: sc.role, textBlocks: blocks, mediaSlots, layoutFamily, layoutParams: {}, lockedFields: [], sourceRefIds: [...new Set(sourceRefIds)] };
  });
}

/**
 * BB chooses eligible founder media for the asset — it does NOT force every uploaded image in. For the
 * smallest vertical: if the media pool has an eligible image (owned/founder_uploaded/licensed with bytes)
 * and no slide already carries media, lead the HOOK with it. Unused media stays unused. reference_only /
 * unknown never enters here (canRenderAsMedia filters it).
 */
export function attachHookMedia(slides: Slide[], snapshot: AssetAuthorizationSnapshot): Slide[] {
  if (slides.some((s) => s.mediaSlots.some((m) => m.kind === 'image'))) return slides;
  const eligible = snapshot.sourceRefs.find(isSlideMedia);
  if (!eligible) return slides;
  const hookIdx = slides.findIndex((s) => s.semanticRole === 'hook');
  const i = hookIdx >= 0 ? hookIdx : 0;
  const target = slides[i]!;
  const withMedia: Slide = { ...target, mediaSlots: [{ slotId: generateId(), kind: 'image', sourceRefId: eligible.sourceRefId, fit: 'cover', locked: false }], sourceRefIds: [...new Set([...target.sourceRefIds, eligible.sourceRefId])] };
  return slides.map((s, idx) => (idx === i ? withMedia : s));
}

/**
 * Slice 6.1 (additive) — the ONE approved compose seam. When a PhotoLedCarouselContext supplies a media PLAN,
 * honor its role/order when placing founder photos: 'hero' leads the first media-bearing slide (the hook),
 * 'supporting'/'detail' fill later non-CTA slides in order ('detail' degrades to supporting under Canonical v1).
 * HONOR ≠ FORCE: every planned source still passes the FROZEN rights gate (isSlideMedia); a reference_only /
 * unknown / missing / already-used source is skipped, never forced. Called ONLY when a plan exists — the plan
 * path (no PhotoLedCarouselContext) uses the untouched attachHookMedia above, so its behavior is byte-identical.
 */
export function attachPlannedMedia(slides: Slide[], snapshot: AssetAuthorizationSnapshot, plan: MediaPlanItem[]): Slide[] {
  if (!plan.length) return attachHookMedia(slides, snapshot);
  // renderable planned sources only (rights disposes), preserving plan order; hero first, then supporting/detail
  const order: Record<MediaPlanItem['role'], number> = { hero: 0, supporting: 1, detail: 1 };
  const eligible = plan
    .map((p) => ({ p, src: snapshot.sourceRefs.find((s) => s.sourceRefId === p.sourceRefId) }))
    .filter((x): x is { p: MediaPlanItem; src: CarouselSourceRef } => Boolean(x.src) && isSlideMedia(x.src!))
    .sort((a, b) => order[a.p.role] - order[b.p.role]);
  if (!eligible.length) return slides;

  // target slides in reading order: hook first, then the rest, never the CTA slide; one media slot per slide.
  const hookIdx = slides.findIndex((s) => s.semanticRole === 'hook');
  const targetOrder = [
    ...(hookIdx >= 0 ? [hookIdx] : []),
    ...slides.map((_, i) => i).filter((i) => i !== hookIdx && slides[i]!.semanticRole !== 'cta'),
  ];
  const next = slides.map((s) => ({ ...s }));
  let ei = 0;
  for (const ti of targetOrder) {
    if (ei >= eligible.length) break;
    const slide = next[ti]!;
    if (slide.mediaSlots.some((m) => m.kind === 'image')) continue; // don't double-place
    const { p } = eligible[ei]!; ei += 1;
    const placement = (p.focalSubjectBox || p.faceBoxes) ? { placement: { focalSubjectBox: p.focalSubjectBox ?? null, faceBoxes: p.faceBoxes ?? [] } } : {};
    next[ti] = { ...slide, mediaSlots: [{ slotId: generateId(), kind: 'image', sourceRefId: p.sourceRefId, fit: 'cover', locked: false, ...placement }], sourceRefIds: [...new Set([...slide.sourceRefIds, p.sourceRefId])] };
  }
  return next;
}

/**
 * Slice 6.1 legibility repair — CONTENT-DENSITY ADAPTATION (never copy invention). When a photo slide can only
 * safely carry a MINIMAL plane (a tight founder headshot etc.), the slide keeps its kicker/headline over the
 * reduced plane and its BODY block is REDISTRIBUTED to an adjacent eligible slide — the SAME immutable block
 * (blockId + authorization binding preserved), so no substantive meaning disappears and no new claim is minted.
 * The moved block re-enters the FROZEN safety/closure/overflow gates downstream like any other block. If no
 * eligible neighbour exists the body is left in place (the image still renders minimally; the structural gate
 * guards fit). A locked body / locked slide is never moved. Plan path (no minimal slides) ⇒ identity.
 */
export function redistributeMinimalMedia(slides: Slide[], minimalSlideIds: ReadonlySet<string>): Slide[] {
  if (!minimalSlideIds.size) return slides;
  const eligibleTarget = (s: Slide): boolean => s.semanticRole !== 'cta' && !minimalSlideIds.has(s.slideId);
  const removed = new Map<number, Set<string>>();   // sourceIndex → blockIds to remove
  const added = new Map<number, TextBlock[]>();      // targetIndex → blocks appended (as body)
  slides.forEach((src, i) => {
    if (!minimalSlideIds.has(src.slideId)) return;
    const body = src.textBlocks.find((b) => b.role === 'body' && !b.locked
      && !src.lockedFields.includes('slide') && !src.lockedFields.includes(`block:${b.blockId}`));
    if (!body) return;                               // no movable substantive block → already minimal-friendly
    let ti = -1;
    for (let d = 1; d < slides.length && ti < 0; d++) {
      if (i + d < slides.length && eligibleTarget(slides[i + d]!)) ti = i + d;
      else if (i - d >= 0 && eligibleTarget(slides[i - d]!)) ti = i - d;
    }
    if (ti < 0) return;                              // nowhere to move it → keep here (image still renders)
    (removed.get(i) ?? removed.set(i, new Set()).get(i)!).add(body.blockId);
    (added.get(ti) ?? added.set(ti, []).get(ti)!).push(body);
  });
  if (!removed.size) return slides;
  return slides.map((s, i): Slide => {
    const rm = removed.get(i); const ad = added.get(i);
    let textBlocks = rm ? s.textBlocks.filter((b) => !rm.has(b.blockId)) : s.textBlocks;
    if (!ad) return rm ? { ...s, textBlocks } : s;
    textBlocks = [...textBlocks, ...ad];
    const extraSrc = ad.map((b) => b.authorizedFrom.sourceRefId).filter((x): x is string => Boolean(x));
    return { ...s, textBlocks, sourceRefIds: [...new Set([...s.sourceRefIds, ...extraSrc])] };
  });
}

/** Apply a copy-only revision to a single slide's blocks, preserving locks and everything non-targeted. */
export function reviseSlideCopy(slide: Slide, newTextByRole: Partial<Record<TextBlock['role'], string>>): Slide {
  const textBlocks = slide.textBlocks.map((b) => {
    const isLocked = b.locked || slide.lockedFields.includes(`block:${b.blockId}`) || slide.lockedFields.includes('slide');
    const next = newTextByRole[b.role];
    if (isLocked || next === undefined) return b;
    return { ...b, text: next };
  });
  return { ...slide, textBlocks };
}
