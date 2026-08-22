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
  CarouselCopyDraft, Concept, Slide, TextBlock, MediaSlot, SlideRole, LayoutFamily, AssetAuthorizationSnapshot,
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
