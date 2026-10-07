import { describe, it, expect } from 'vitest';
import { choosePlanePlacement, requiredScrim, coveredFraction, planePlacementMode, chromeReservedBoxes, PLANE_REGIONS } from '../../carousel/placement';
import type { Box } from '../../carousel/placement';

const intersects = (a: Box, b: Box): number => {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ix * iy;
};

const dark = () => 0.15;   // dark region → base scrim, no contrast pressure
const bright = () => 0.9;
const anchorOf = (r: ReturnType<typeof choosePlanePlacement>) => r?.anchor;

describe('Slice 6.1 — image-aware content-plane placement (deterministic, scored)', () => {
  it('A. subject on the LEFT → plane moves RIGHT (R1 rejected, R2 chosen)', () => {
    const focalBox: Box = { x: 0.04, y: 0.50, width: 0.40, height: 0.45 };  // clearly lower-left
    const c = choosePlanePlacement({ focalBox, faceBoxes: [], lumOf: dark });
    expect(anchorOf(c)).toBe('R2');
  });

  it('B. subject on the RIGHT → plane stays/moves LEFT (R1)', () => {
    const focalBox: Box = { x: 0.56, y: 0.50, width: 0.40, height: 0.45 };  // clearly lower-right
    const c = choosePlanePlacement({ focalBox, faceBoxes: [], lumOf: dark });
    expect(anchorOf(c)).toBe('R1');
  });

  it('C. dish/product center-bottom → a safe UPPER region is chosen', () => {
    const focalBox: Box = { x: 0.18, y: 0.55, width: 0.64, height: 0.42 };  // fills the lower band
    const c = choosePlanePlacement({ focalBox, faceBoxes: [], lumOf: dark });
    expect(['R4', 'R5']).toContain(anchorOf(c));
  });

  it('D. a brighter region needs a higher (bounded) scrim than a dark one', () => {
    expect(requiredScrim(0.9)).toBeGreaterThan(requiredScrim(0.1));
    expect(requiredScrim(0.9)).toBeLessThanOrEqual(1.0);
    expect(requiredScrim(0.1)).toBeGreaterThanOrEqual(0.82);
    // over a bright image the chosen placement carries a heavier scrim
    const c = choosePlanePlacement({ focalBox: { x: 0.4, y: 0.05, width: 0.5, height: 0.3 }, faceBoxes: [], lumOf: bright });
    expect(c!.scrim).toBeGreaterThan(0.82);
  });

  it('E. a face overlapping the preferred R1 → R1 is rejected (never obscure a face)', () => {
    const face: Box = { x: 0.12, y: 0.63, width: 0.18, height: 0.18 };  // inside R1
    const c = choosePlanePlacement({ focalBox: null, faceBoxes: [face], lumOf: dark });
    expect(anchorOf(c)).not.toBe('R1');
    // and the chosen plane must not cover the face
    expect(coveredFraction(c!.plane, face)).toBeLessThanOrEqual(0.02);
  });

  it('F. faces across every region → null (exclude the image / graphic fallback)', () => {
    // faces in the lower band (R1/R2/R3) AND both upper corners (R4/R5) leave no safe anchor
    const faces = [{ x: 0.30, y: 0.62, width: 0.42, height: 0.26 }, { x: 0.08, y: 0.09, width: 0.42, height: 0.26 }, { x: 0.46, y: 0.09, width: 0.42, height: 0.26 }];
    expect(choosePlanePlacement({ focalBox: null, faceBoxes: faces, lumOf: dark })).toBeNull();
  });

  it('a full-frame focal (texture/portrait) is not a subject to avoid — the plane may still place', () => {
    expect(choosePlanePlacement({ focalBox: { x: 0, y: 0, width: 1, height: 1 }, faceBoxes: [], lumOf: dark })).not.toBeNull();
  });

  it('R1 is preferred when all regions are equally safe (no subject)', () => {
    expect(anchorOf(choosePlanePlacement({ focalBox: null, faceBoxes: [], lumOf: dark }))).toBe('R1');
  });

  it('coveredFraction is intersection over the SUBJECT box area', () => {
    expect(coveredFraction({ x: 0, y: 0, width: 0.5, height: 1 }, { x: 0.25, y: 0, width: 0.5, height: 1 })).toBeCloseTo(0.5, 5);
    expect(coveredFraction(PLANE_REGIONS[0]!.plane, { x: 0.9, y: 0.05, width: 0.05, height: 0.05 })).toBe(0);
  });
});

// ── Slice 6.1 legibility REPAIR: face-dominant portraits (minimal mode + preserve photo) + chrome as a hard
//    placement constraint. These are the deterministic falsifiers behind the visual before/after. ──
describe('Slice 6.1 repair — minimal-density fallback (preserve a valuable photo before excluding it)', () => {
  const dark = () => 0.15;
  // a tight portrait: the photo is full-frame (texture ⇒ focal ignored) and a central face blocks ALL normal
  // regions (the face reaches below the lower band), but a REDUCED lower band still clears it.
  const portraitFocal: Box = { x: 0, y: 0, width: 1, height: 1 };
  const tightFace: Box = { x: 0.28, y: 0.16, width: 0.44, height: 0.56 }; // y 0.16→0.72, central

  it('A. tight central face + valuable photo → normal density impossible → MINIMAL mode selected, image RETAINED', () => {
    const c = choosePlanePlacement({ focalBox: portraitFocal, faceBoxes: [tightFace], lumOf: dark });
    expect(c).not.toBeNull();               // NOT excluded — the photo is kept
    expect(c!.mode).toBe('minimal');        // via a reduced-dimension plane
    expect(c!.anchor.startsWith('M')).toBe(true);
    expect(planePlacementMode(portraitFocal, [tightFace], [])).toBe('minimal');
  });

  it('B. the chosen MINIMAL plane never covers the face (face overlap = 0)', () => {
    const c = choosePlanePlacement({ focalBox: portraitFocal, faceBoxes: [tightFace], lumOf: dark });
    expect(coveredFraction(c!.plane, tightFace)).toBeLessThanOrEqual(0.02);
  });

  it('D. impossible even in minimal mode (faces tile every band) → image finally excluded (null)', () => {
    const faces: Box[] = [
      { x: 0.2, y: 0.69, width: 0.5, height: 0.24 }, // lower band + bottom minimal band
      { x: 0.2, y: 0.45, width: 0.5, height: 0.21 }, // mid minimal band
      { x: 0.2, y: 0.09, width: 0.5, height: 0.23 }, // top regions + upper minimal band
    ];
    expect(choosePlanePlacement({ focalBox: null, faceBoxes: faces, lumOf: dark })).toBeNull();
    expect(planePlacementMode(null, faces, [])).toBe('exclude');
  });
});

describe('Slice 6.1 repair — frozen page chrome is a HARD placement constraint', () => {
  const dark = () => 0.15;
  const indexBox = chromeReservedBoxes({ pageIndex: true, footer: false, logo: false, total: 4 })[0]!;

  it('E. a top-region candidate that collides with the page index is rejected/adjusted → the plane clears it', () => {
    // a dish fills the lower/centre frame → only a TOP region is viable; the index sits top-left.
    const dish: Box = { x: 0.1, y: 0.35, width: 0.8, height: 0.6 };
    const withoutChrome = choosePlanePlacement({ focalBox: dish, faceBoxes: [], lumOf: dark });
    const withChrome = choosePlanePlacement({ focalBox: dish, faceBoxes: [], lumOf: dark, chromeBoxes: [indexBox] });
    expect(intersects(withoutChrome!.plane, indexBox)).toBeGreaterThan(0.004);  // without the constraint the plane crowds the index
    expect(withChrome).not.toBeNull();
    expect(intersects(withChrome!.plane, indexBox)).toBeLessThanOrEqual(0.004);  // the fix: the plane no longer collides
    expect(withChrome!.plane).not.toEqual(withoutChrome!.plane);                 // a different, index-clear placement was selected
  });

  it('F. a candidate sitting on the footer with a face blocking the space above it is REJECTED', () => {
    const footerBox = chromeReservedBoxes({ pageIndex: false, footer: true, logo: false, total: 4 })[0]!;
    const onFooter = [{ id: 'R1' as const, mode: 'normal' as const, plane: { x: 0.086, y: 0.85, width: 0.52, height: 0.13 } }];
    const faceAbove: Box = { x: 0.1, y: 0.5, width: 0.6, height: 0.33 };
    const c = choosePlanePlacement({ focalBox: null, faceBoxes: [faceAbove], lumOf: dark, regions: onFooter, minimalRegions: [], chromeBoxes: [footerBox] });
    expect(c).toBeNull();
  });

  it('ordinary bottom placement is untouched by chrome (no regression) — a clear bottom photo still lands R1', () => {
    const chrome = chromeReservedBoxes({ pageIndex: true, footer: true, logo: false, total: 4 });
    const c = choosePlanePlacement({ focalBox: null, faceBoxes: [], lumOf: dark, chromeBoxes: chrome });
    expect(c!.anchor).toBe('R1');
    expect(c!.mode).toBe('normal');
  });
});
