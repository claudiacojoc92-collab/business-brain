/**
 * Slice 6 — the CANONICAL base carousel template (MVP). Every slide resolves to ONE fixed composition that
 * reproduces the approved reference: gradient sky over a dark ground split at a fixed horizon, a large focal
 * circle at a fixed position/scale, a fixed dark content panel, text anchored bottom-left. No per-role
 * variation, no jitter, no mirrored variants, no brand adaptation in this pass.
 */
import { describe, it, expect } from 'vitest';
import { resolveDesignDirection, canonicalDefaultVisualSystem } from '../../carousel/visual-system';
import { planComposition } from '../../carousel/composition';
import type { BrandContext, Slide, SlideRole, TextBlockRole, MediaSlot } from '../../carousel/contracts';

let n = 0;
const tb = (role: TextBlockRole, text: string) => ({ blockId: 'b' + n++, role, text, authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: null }, locked: false });
const slide = (role: SlideRole, media?: MediaSlot): Slide => ({ slideId: 's' + n++, order: 0, semanticRole: role, textBlocks: [tb('headline', 'A headline'), tb('body', 'Some body copy.')], mediaSlots: media ? [media] : [], layoutFamily: 'editorial_text', layoutParams: {}, lockedFields: [], sourceRefIds: [] });
const marbury = () => resolveDesignDirection({ brandContextVersion: 'b', mode: 'known', constraints: { palette: ['#faf6ee', '#241a12', '#8a7d6b', '#b4531a'] } } as BrandContext);

describe('Slice 6 — canonical base template', () => {
  it('reproduces the fixed reference geometry (horizon 0.37, circle 0.72/0.318/0.463, panel 0.106/0.63)', () => {
    const p = planComposition(slide('hook'), marbury());
    expect(p.recipe).toBe('canonical');
    expect(p.secondary?.frac).toBeCloseTo(0.37, 3);
    expect(p.focal?.kind).toBe('disc');
    expect(p.focal?.cxFrac).toBeCloseTo(0.72, 3);
    expect(p.focal?.cyFrac).toBeCloseTo(0.318, 3);
    expect(p.focal?.scaleW).toBeCloseTo(0.463, 3);
    expect(p.plane?.xFrac).toBeCloseTo(0.106, 3);
    expect(p.plane?.yFrac).toBeCloseTo(0.63, 3);
    expect(p.textOn).toBe('canvas_bottom');       // text on the canvas bottom-left, not inside the panel
    expect(p.skyFrom).toBeTruthy(); expect(p.focalBelow).toBeTruthy(); // gradient sky + split circle
  });

  it('is the SAME fixed geometry for every slide role (no per-role variation, no rhythm)', () => {
    const hook = planComposition(slide('hook'), marbury());
    const cta = planComposition(slide('cta'), marbury());
    expect(cta.focal?.cxFrac).toBe(hook.focal?.cxFrac);
    expect(cta.plane?.xFrac).toBe(hook.plane?.xFrac);
    expect(cta.secondary?.frac).toBe(hook.secondary?.frac);
    expect(cta.vNudge).toBe(0); expect(hook.vNudge).toBe(0); // no jitter
  });

  it('the same slide renders identically twice (deterministic — no randomness)', () => {
    const s = slide('hook');
    expect(JSON.stringify(planComposition(s, marbury()))).toBe(JSON.stringify(planComposition(s, marbury())));
  });

  it('client media becomes the ground/focal within the SAME canonical template (panel + text unchanged)', () => {
    const p = planComposition(slide('hook', { slotId: 'm', kind: 'image', sourceRefId: 'img1', fit: 'cover', locked: false }), marbury());
    expect(p.recipe).toBe('canonical_media');
    expect(p.focal?.kind).toBe('media');
    expect(p.plane?.xFrac).toBeCloseTo(0.106, 3);
    expect(p.textOn).toBe('canvas_bottom');
  });

  it('the no-brand neutral uses the same canonical template (not a different layout)', () => {
    const p = planComposition(slide('hook'), canonicalDefaultVisualSystem());
    expect(p.recipe).toBe('canonical');
    expect(p.focal?.cxFrac).toBeCloseTo(0.72, 3);
    expect(p.textOn).toBe('canvas_bottom');
  });
});
