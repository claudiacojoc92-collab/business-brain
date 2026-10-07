/**
 * Slice 6.1 — image-aware content-plane placement (DETERMINISTIC, visual-layout only; NO claim/safety change).
 * Runs for PHOTO-LED media slides. The DARK content plane of Base Design Grammar v1 is FROZEN — we only adapt
 * its ANCHOR (a closed set), bounded dimensions, and scrim, so light text stays readable and the plane never
 * covers a face, the primary focal subject, or the frozen page chrome. Placement is SCORED across all candidate
 * regions (not first-match): hard-fail on face overlap / focal overlap / chrome collision over tolerance; among
 * valid candidates the lowest cost wins, with R1 (the canonical bottom-left) preferred when equally safe.
 *
 * FALLBACK LADDER (Slice 6.1 repair): a strategically-relevant photo is preserved before it is ever excluded —
 *   NORMAL regions (R1..R5, full density) → MINIMAL regions (M1..M3, a reduced-dimension plane for less copy) →
 *   only then null (⇒ the slide falls back to the graphic focal). Image exclusion is the LAST resort. The
 *   density adaptation itself (which copy renders / redistributing the overflow meaning to an adjacent slide) is
 *   done in compose.ts through the FROZEN safety path — this layer only reports the MODE, it never rewrites copy.
 */
export interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type PlaneAnchor = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'M1' | 'M2' | 'M3';
export type PlaneMode = 'normal' | 'minimal';
export interface PlaneRegion { readonly id: PlaneAnchor; readonly plane: Box; readonly mode: PlaneMode }

/** The closed NORMAL anchor set — bounded content-plane boxes (fractions of the canvas). Bottom bias + overlap
 *  + premium negative space are preserved; no free canvas. R1 is the canonical (frozen) default. */
export const PLANE_REGIONS: PlaneRegion[] = [
  { id: 'R1', mode: 'normal', plane: { x: 0.086, y: 0.60, width: 0.52, height: 0.30 } }, // bottom-left (canonical default)
  { id: 'R2', mode: 'normal', plane: { x: 0.394, y: 0.60, width: 0.52, height: 0.30 } }, // bottom-right
  { id: 'R3', mode: 'normal', plane: { x: 0.086, y: 0.66, width: 0.828, height: 0.26 } }, // lower band
  { id: 'R4', mode: 'normal', plane: { x: 0.086, y: 0.09, width: 0.52, height: 0.28 } }, // top-left
  { id: 'R5', mode: 'normal', plane: { x: 0.394, y: 0.09, width: 0.52, height: 0.28 } }, // top-right
];

/** The MINIMAL anchor set — REDUCED-DIMENSION variants of the same band positions (still Base Design Grammar v1,
 *  not a new family). Used ONLY when no NORMAL region is safe: the plane shrinks to the minimum needed for a
 *  kicker + short headline (+ optionally one short line) so a valuable photo (e.g. a tight founder headshot)
 *  keeps its image dominant instead of being dropped. Bands clear the page chrome by construction. */
export const MINIMAL_REGIONS: PlaneRegion[] = [
  { id: 'M1', mode: 'minimal', plane: { x: 0.086, y: 0.72, width: 0.828, height: 0.16 } }, // reduced lower band (preferred)
  { id: 'M3', mode: 'minimal', plane: { x: 0.086, y: 0.50, width: 0.828, height: 0.15 } }, // reduced mid band
  { id: 'M2', mode: 'minimal', plane: { x: 0.086, y: 0.135, width: 0.828, height: 0.135 } }, // reduced upper band (below the index)
];

const FACE_TOLERANCE = 0.02;   // faces: hard zero-obstruction except negligible measurement tolerance
const FOCAL_TOLERANCE = 0.12;  // primary focal subject: a very small bounded overlap only
const CHROME_TOLERANCE = 0.004; // page index / footer / logo reserved zones: a negligible touch is allowed
const CHROME_GAP = 0.012;      // clearance kept between an adjusted plane and the chrome it moved away from
const BASE_SCRIM = 0.82;       // the dark plane is opaque enough that white text is readable by construction …
const MAX_SCRIM = 1.0;         // … up to fully opaque for a bright region behind it.
const TEXTURE_FOCAL_AREA = 0.55; // a focal box filling most of the frame is a FIELD/texture/portrait, not a
                                 // single subject to avoid — the plane may sit anywhere (faces are still avoided).
const DEVIATION: Record<PlaneAnchor, number> = {
  R1: 0, R2: 0.6, R3: 0.4, R4: 1.2, R5: 1.2,   // NORMAL: prefer the canonical bottom-left
  M1: 0.3, M3: 0.9, M2: 1.3,                    // MINIMAL: prefer the reduced lower band
};

/** Fraction of box B that box A covers (A∩B / area(B)). Used for face/focal occlusion (B = the subject). */
export function coveredFraction(a: Box, b: Box): number {
  const areaB = b.width * b.height;
  return areaB <= 0 ? 0 : intersectArea(a, b) / areaB;
}
/** Absolute intersection area of two boxes (fractions of the canvas). */
function intersectArea(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ix * iy;
}

/** Scrim opacity the DARK plane needs so white text is WCAG-readable over a region of mean luminance `lum` (0..1).
 *  A darker region needs only the base scrim (more integrated look); a bright region trends toward opaque. */
export function requiredScrim(lum: number): number {
  return Math.min(MAX_SCRIM, Math.max(BASE_SCRIM, BASE_SCRIM + (Math.max(0, lum - 0.25)) * 0.4));
}

/** Reserved CHROME zones (fractions of the canvas) the plane must never collide with — derived from the FROZEN
 *  renderer chrome (page index top-left, corner logo top-right, footer handle + accent rule bottom-left). The
 *  boxes are generous so text never crowds the chrome. Both the renderer (placement) and compose (density
 *  prediction) call this so their decisions cannot diverge. */
export interface ChromeFlags { readonly pageIndex: boolean; readonly footer: boolean; readonly logo: boolean; readonly total: number }
export function chromeReservedBoxes(f: ChromeFlags): Box[] {
  const boxes: Box[] = [];
  if (f.pageIndex && f.total > 1) boxes.push({ x: 0.06, y: 0.03, width: 0.34, height: 0.085 }); // "NN / NN" sequence marker
  if (f.logo) boxes.push({ x: 0.76, y: 0.03, width: 0.22, height: 0.10 });                        // corner logo
  if (f.footer) boxes.push({ x: 0.06, y: 0.898, width: 0.56, height: 0.10 });                     // footer handle + accent rule
  return boxes;
}

/** Move a candidate plane vertically away from any chrome box it collides with, keeping its dimensions (a bounded
 *  "safe-region adjustment" within Base Design Grammar v1). Returns the adjusted plane, or null if it cannot
 *  settle clear of the chrome inside the canvas (⇒ that candidate is rejected). */
function adjustAroundChrome(plane: Box, chrome: Box[]): Box | null {
  let p = plane;
  for (let iter = 0; iter < 5; iter++) {
    const hit = chrome.find((c) => intersectArea(p, c) > CHROME_TOLERANCE);
    if (!hit) return (p.y >= 0 && p.y + p.height <= 1) ? p : null;
    const chromeAbove = (hit.y + hit.height / 2) < (p.y + p.height / 2);
    p = chromeAbove ? { ...p, y: hit.y + hit.height + CHROME_GAP } : { ...p, y: hit.y - CHROME_GAP - p.height };
  }
  return null; // chrome above and below fight for the same band — no safe position
}

const asTextureFiltered = (b: Box | null): Box | null => (b && b.width * b.height <= TEXTURE_FOCAL_AREA ? b : null);

/** Feasibility of a single region: adjust around chrome, then hard-fail on residual chrome / face / focal overlap.
 *  Returns the (possibly chrome-adjusted) plane box if the region is usable, else null. Shared by the scorer and
 *  the mode predictor so the chosen MODE is identical in both. */
function feasiblePlane(region: PlaneRegion, focal: Box | null, faceBoxes: Box[], chrome: Box[]): Box | null {
  const adj = adjustAroundChrome(region.plane, chrome);
  if (!adj) return null;
  if (chrome.some((c) => intersectArea(adj, c) > CHROME_TOLERANCE)) return null;
  const faceOv = faceBoxes.length ? Math.max(...faceBoxes.map((f) => coveredFraction(adj, f))) : 0;
  if (faceOv > FACE_TOLERANCE) return null;                       // never obscure a face
  const focalOv = focal ? coveredFraction(adj, focal) : 0;
  if (focalOv > FOCAL_TOLERANCE) return null;                     // never meaningfully cover the primary subject
  return adj;
}

export interface PlacementInput {
  readonly focalBox: Box | null;
  readonly faceBoxes: Box[];
  readonly lumOf: (plane: Box) => number;   // mean luminance behind the plane box (0..1), from the real bytes
  readonly regions?: PlaneRegion[];         // override the NORMAL set (tests)
  readonly minimalRegions?: PlaneRegion[];  // override the MINIMAL set (tests)
  readonly chromeBoxes?: Box[];             // reserved chrome zones (hard constraint); [] ⇒ no chrome
}
export interface PlacementChoice { readonly anchor: PlaneAnchor; readonly plane: Box; readonly scrim: number; readonly cost: number; readonly mode: PlaneMode }

/**
 * Score every candidate region; return the safest lowest-cost one. Tries the NORMAL set first (full density);
 * only if NO normal region is safe does it try the MINIMAL set (reduced-dimension plane, mode 'minimal'). null
 * ⇒ exclude the image on this slide (fall back to the graphic focal) — the last resort. Face/focal/chrome
 * overlap beyond tolerance are HARD fails; contrast is guaranteed by the (dark) plane + scrim so it never
 * hard-fails here.
 */
export function choosePlanePlacement(input: PlacementInput): PlacementChoice | null {
  const chrome = input.chromeBoxes ?? [];
  const focal = asTextureFiltered(input.focalBox);
  const scoreSet = (regions: PlaneRegion[]): PlacementChoice | null => {
    let best: PlacementChoice | null = null;
    for (const r of regions) {
      const adj = feasiblePlane(r, focal, input.faceBoxes, chrome);
      if (!adj) continue;
      const faceOv = input.faceBoxes.length ? Math.max(...input.faceBoxes.map((f) => coveredFraction(adj, f))) : 0;
      const focalOv = focal ? coveredFraction(adj, focal) : 0;
      const scrim = requiredScrim(input.lumOf(adj));
      const cost = 6 * faceOv + 4 * focalOv + 2 * (scrim - BASE_SCRIM) + DEVIATION[r.id];
      if (!best || cost < best.cost - 1e-9) best = { anchor: r.id, plane: adj, scrim, cost, mode: r.mode };
    }
    return best;
  };
  return scoreSet(input.regions ?? PLANE_REGIONS) ?? scoreSet(input.minimalRegions ?? MINIMAL_REGIONS);
}

/**
 * The density MODE a photo slide will render at, from geometry ALONE (no pixel luminance) — so compose can decide
 * copy redistribution and the renderer can decide the plane, and the two can never disagree. 'normal' (a normal
 * region is safe), 'minimal' (only a reduced plane is safe ⇒ less copy, redistribute the overflow), or 'exclude'
 * (no plane is safe even minimal ⇒ drop the image to the graphic focal).
 */
export function planePlacementMode(focalBox: Box | null, faceBoxes: Box[], chromeBoxes: Box[]): PlaneMode | 'exclude' {
  const focal = asTextureFiltered(focalBox);
  const anySafe = (regions: PlaneRegion[]): boolean => regions.some((r) => feasiblePlane(r, focal, faceBoxes, chromeBoxes) !== null);
  if (anySafe(PLANE_REGIONS)) return 'normal';
  if (anySafe(MINIMAL_REGIONS)) return 'minimal';
  return 'exclude';
}

/** Aspect ratio (w/h) read from a PNG's IHDR — pure buffer math, shared by the renderer and compose so the
 *  image→canvas box mapping is identical in both. Defaults to the canvas AR (0.8) when unreadable. */
export function imageAspectFromPng(png: Buffer): number {
  try { const w = png.readUInt32BE(16), h = png.readUInt32BE(20); return h > 0 ? w / h : 0.8; } catch { return 0.8; }
}

/** Map a box in ORIGINAL image space → canvas space after the full-bleed xMidYMid-slice crop (canvas AR 0.8). */
export function sliceBox(b: Box, imgAR: number, canvasAR = 0.8): Box {
  if (imgAR > canvasAR) { const vis = canvasAR / imgAR, off = (1 - vis) / 2; return { x: (b.x - off) / vis, y: b.y, width: b.width / vis, height: b.height }; }
  const vis = imgAR / canvasAR, off = (1 - vis) / 2; return { x: b.x, y: (b.y - off) / vis, width: b.width, height: b.height / vis };
}
