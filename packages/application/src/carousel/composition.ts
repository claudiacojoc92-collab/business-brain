/**
 * Slice 6 — CANONICAL BASE CAROUSEL TEMPLATE (MVP). This reproduces the approved reference image as the ONE
 * fixed layout: a gradient sky field over a dark ground split at a fixed horizon, a large pale focal circle
 * at a fixed position/scale straddling the horizon (muted below it), a fixed dark content panel lower-left,
 * and the text anchored bottom-left on the canvas. The geometry is FIXED for every slide — no per-role
 * variation, no seeded jitter, no mirrored variants, no brand adaptation in this pass. Colours are the
 * canonical reference palette (client brand tokens replace them in a later, separate pass). If copy is long
 * it is fit-to-width/shrunk within the same fixed layout — the composition never moves.
 */
import type { AssetDesignDirection, Slide } from './contracts';

export interface Field { readonly edge: 'top' | 'bottom' | 'left' | 'right'; readonly frac: number; readonly color: string }
export interface Focal { readonly kind: 'disc' | 'media'; readonly scaleW: number; readonly cxFrac: number; readonly cyFrac: number; readonly color: string; readonly opacity: number }
export interface Plane { readonly xFrac: number; readonly yFrac: number; readonly wFrac: number; readonly hFrac: number; readonly fill: string; readonly onFill: string; readonly onFillMuted: string; readonly elevate: boolean; readonly radius: number }
export interface CompositionPlan {
  readonly recipe: string;
  readonly ground: string;
  readonly ink: string; readonly muted: string;
  readonly skyFrom?: string; readonly skyTo?: string;   // gradient sky (the top field), when present
  readonly secondary?: Field;
  readonly focal?: Focal;
  readonly focalBelow?: string;                          // circle tone below the horizon (split)
  readonly plane?: Plane;
  readonly textOn: 'plane' | 'base' | 'canvas_bottom';
  readonly align: 'left' | 'center';
  readonly vAnchor: 'top' | 'center' | 'bottom';
  readonly emphasis: 'headline' | 'display' | 'stat';
  readonly accentRule: boolean;
  readonly accentColor: string;
  readonly chromeColor: string;
  readonly indexOnField: boolean;
  readonly vNudge: number;
}

const hasMedia = (s: Slide): boolean => s.mediaSlots.some((m) => m.kind === 'image' && m.sourceRefId);
const lum = (hex: string): number => { const n = parseInt(hex.replace('#', ''), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
const isDark = (hex: string): boolean => lum(hex) < 0.4;
function mix(hex: string, toward: string, t: number): string {
  const a = parseInt(hex.replace('#', ''), 16); const b = parseInt(toward.replace('#', ''), 16);
  const c = (sh: number) => { const x = (a >> sh) & 255, y = (b >> sh) & 255; return Math.round(x + (y - x) * t); };
  return '#' + [c(16), c(8), c(0)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** FIXED canonical geometry (fractions of 1080×1350), measured from the approved reference image. FROZEN. */
const CANON = {
  horizon: 0.37,
  circle: { cxFrac: 0.72, cyFrac: 0.318, scaleW: 0.463 },
  panel: { xFrac: 0.106, yFrac: 0.63, wFrac: 0.495, hFrac: 0.267, radius: 24 },
};

/**
 * The BRAND-TOKEN layer over the frozen geometry: geometry never changes, only these COLOURS do. Two modes —
 * MODE A a grounded client brand (warm→warm, navy/teal→navy/teal, mono→mono); MODE B the frozen Canonical
 * Default Palette v1 (see canonicalDefaultVisualSystem) when the brand is unknown. Grey/blue is NEVER a universal
 * default. A dark ground is required (white text below the horizon), so it is always a dark tone of the brand.
 * The SKY is a mid-toned, CHROMATIC brand gradient (the dusk field) — it is NOT desaturated toward ink, which is
 * what previously greyed the warm/default palette out.
 */
function canonicalColors(dir: AssetDesignDirection) {
  const cr = dir.colorRoles; const accent = cr.accent; const ink = cr.ink; const base = cr.base;
  const dark = isDark(base);
  const ground = dark ? mix(base, '#ffffff', 0.03) : mix(base, ink, 0.9);
  // the chromatic driver of the sky + circle + rule: the brand accent, else its coordinated secondary surface
  const hue = accent ?? cr.secondary;
  const circle = dark ? mix(hue, '#ffffff', 0.58) : mix(base, '#ffffff', 0.5);
  return {
    ground, panel: mix(ground, '#000000', 0.28),
    // airy tint of the brand hue over the base → a slightly deeper brand tone: keeps chroma (warm stays warm)
    skyFrom: mix(hue, base, dark ? 0.30 : 0.40),
    skyTo: mix(hue, ink, dark ? 0.10 : 0.14),
    circle,
    // lower half of the split circle: stay IN-PALETTE (blend toward the brand hue, then settle a touch) so a
    // light/warm brand does NOT produce a grey lower disc — it stays a muted warm tone of the brand.
    circleBelow: mix(mix(circle, hue, 0.55), ground, 0.16),
    accentColor: accent ?? mix(base, ink, 0.5),
    ink: '#ffffff', body: '#ece7df', chrome: mix('#ffffff', ground, 0.38),
  };
}

/**
 * Every slide resolves to the SAME frozen canonical plan (v1). Geometry is fixed; only the brand-token
 * COLOURS come from `dir`. No per-role variation, no jitter, no variants.
 */
export function planComposition(slide: Slide, dir: AssetDesignDirection): CompositionPlan {
  const media = hasMedia(slide);
  const c = canonicalColors(dir);
  const plane: Plane = { xFrac: CANON.panel.xFrac, yFrac: CANON.panel.yFrac, wFrac: CANON.panel.wFrac, hFrac: CANON.panel.hFrac, fill: c.panel, onFill: c.ink, onFillMuted: c.body, elevate: false, radius: CANON.panel.radius };
  const common = {
    ground: c.ground, ink: c.ink, muted: c.chrome, plane,
    textOn: 'canvas_bottom' as const, align: 'left' as const, vAnchor: 'bottom' as const, emphasis: 'headline' as const,
    accentRule: true, accentColor: c.accentColor, chromeColor: c.chrome, indexOnField: false, vNudge: 0,
  };
  if (media) {
    return { recipe: 'canonical_media', ...common, focal: { kind: 'media', scaleW: 1, cxFrac: 0.5, cyFrac: 0.5, color: c.ground, opacity: 1 } };
  }
  return {
    recipe: 'canonical', ...common,
    skyFrom: c.skyFrom, skyTo: c.skyTo,
    secondary: { edge: 'top', frac: CANON.horizon, color: c.skyTo },
    focal: { kind: 'disc', scaleW: CANON.circle.scaleW, cxFrac: CANON.circle.cxFrac, cyFrac: CANON.circle.cyFrac, color: c.circle, opacity: 1 },
    focalBelow: c.circleBelow,
  };
}
