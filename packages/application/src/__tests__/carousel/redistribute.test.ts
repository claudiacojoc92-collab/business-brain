import { describe, it, expect } from 'vitest';
import { redistributeMinimalMedia } from '../../carousel/compose';
import type { Slide, TextBlock } from '../../carousel/contracts';

const tb = (id: string, role: TextBlock['role'], text: string, sourceRefId: string | null = null): TextBlock =>
  ({ blockId: id, role, text, authorizedFrom: { propositionRef: role === 'body' ? 'P1' : null, sourceRefId, ctaFunction: role === 'cta' ? 'book' : null }, locked: false });

const slide = (id: string, order: number, role: Slide['semanticRole'], blocks: TextBlock[], media = false): Slide => ({
  slideId: id, order, semanticRole: role, textBlocks: blocks,
  mediaSlots: media ? [{ slotId: 'm-' + id, kind: 'image', sourceRefId: 'src-' + id, fit: 'cover', locked: false, placement: { focalSubjectBox: null, faceBoxes: [{ x: 0.3, y: 0.2, width: 0.4, height: 0.4 }] } }] : [],
  layoutFamily: media ? 'split_media' : 'editorial_text', layoutParams: {}, lockedFields: [], sourceRefIds: media ? ['src-' + id] : [],
});

const allBodyIds = (slides: Slide[]): string[] => slides.flatMap((s) => s.textBlocks.filter((b) => b.role === 'body').map((b) => b.blockId)).sort();

describe('Slice 6.1 repair — content-density redistribution (no substantive meaning silently disappears)', () => {
  const base = (): Slide[] => [
    slide('hook', 0, 'hook', [tb('h-head', 'headline', 'The operator behind the advice'), tb('h-body', 'body', 'Years inside the rooms where it goes wrong.', 'S1')], true),
    slide('proof', 1, 'proof', [tb('p-head', 'headline', 'Rooms, not slides'), tb('p-body', 'body', 'The work happens in the operating review.')]),
    slide('cta', 2, 'cta', [tb('c-head', 'headline', 'Let us talk'), tb('c-cta', 'cta', 'Book a 30-minute session')]),
  ];

  it('C. a minimal photo slide keeps its headline but its BODY moves to an adjacent slide — same block, binding preserved', () => {
    const slides = base();
    const out = redistributeMinimalMedia(slides, new Set(['hook']));

    // the hook keeps its headline over the (minimal) plane, but no longer carries the body
    const hook = out.find((s) => s.slideId === 'hook')!;
    expect(hook.textBlocks.some((b) => b.role === 'headline')).toBe(true);
    expect(hook.textBlocks.some((b) => b.blockId === 'h-body')).toBe(false);

    // the SAME immutable block (id + authorization binding) now lives on the adjacent proof slide
    const proof = out.find((s) => s.slideId === 'proof')!;
    const moved = proof.textBlocks.find((b) => b.blockId === 'h-body');
    expect(moved).toBeTruthy();
    expect(moved!.role).toBe('body');
    expect(moved!.authorizedFrom.propositionRef).toBe('P1');
    expect(moved!.authorizedFrom.sourceRefId).toBe('S1');
    expect(proof.sourceRefIds).toContain('S1'); // the source binding follows the meaning

    // NO substantive body block is lost across the asset (nothing silently deleted)
    expect(allBodyIds(out)).toEqual(allBodyIds(slides));
  });

  it('never targets the CTA slide as a redistribution home, and never moves a locked body', () => {
    const slides = base();
    // lock the hook body → it must stay put (no move, no loss)
    slides[0]!.textBlocks[1] = { ...slides[0]!.textBlocks[1]!, locked: true };
    const out = redistributeMinimalMedia(slides, new Set(['hook']));
    expect(out.find((s) => s.slideId === 'hook')!.textBlocks.some((b) => b.blockId === 'h-body')).toBe(true);
    expect(out.find((s) => s.slideId === 'cta')!.textBlocks.some((b) => b.role === 'body')).toBe(false);
  });

  it('is identity when no slide is minimal (plan path untouched)', () => {
    const slides = base();
    expect(redistributeMinimalMedia(slides, new Set())).toBe(slides);
  });
});
