/**
 * PART 1 — per-role DESIGN character budgets for generated carousel copy.
 *
 * The renderer fits copy by shrinking the font toward the 28px floor; copy that only "fits" at the floor renders as
 * an unreadable wall. Good carousel copy sits far below that ceiling. These budgets are DESIGN targets: the number of
 * characters that render at (or near) the role's intended type size within a small, fixed design line count — not the
 * height-allowed maximum. They are computed from the live canvas geometry + type scale (so they track any change to
 * either), then capped by a design target so a larger canvas never invites more text than reads well.
 *
 * chars/line is derived from the pinned Inter TTFs' measured average advance width. Across the type scale the
 * renderer's own getAdvanceWidth gives ≈0.46–0.48·size per character in an 888px box (cpl: 58px→32, 33px→59,
 * 116px→16, 42px→44); 0.48 is the slightly conservative mean, so a computed chars/line never exceeds what Inter
 * actually renders. This is the metric-derived constant, not a guess.
 */
import type { CanvasSpec, TypeScale, CopyBudget } from './contracts';

const INTER_AVG_ADVANCE = 0.48;

// DESIGN line counts + design char targets (deliberately below the fit ceiling — shorter is better).
const DESIGN = {
  kicker:       { lines: 1, target: 40 },
  headline:     { lines: 2, target: 55 },
  headlineHero: { lines: 2, target: 32 },
  body:         { lines: 3, target: 180 },
  cta:          { lines: 1, target: 45 },
} as const;

const charsPerLine = (sizePx: number, boxW: number): number => Math.max(1, Math.floor(boxW / (INTER_AVG_ADVANCE * sizePx)));

/** Compute the per-role budget = min(design target, chars/line at the role's design size × design line count). The
 * geometric term tightens the budget when the canvas/type scale shrinks; the design target caps it otherwise. */
export function computeCopyBudgets(canvas: CanvasSpec, ts: TypeScale): CopyBudget {
  const boxW = canvas.width - canvas.margin * 2;
  const cap = (sizePx: number, d: { lines: number; target: number }): number => Math.min(d.target, charsPerLine(sizePx, boxW) * d.lines);
  // A kicker's design size (≈22px) is below the 28px gate floor, so the renderer forces it up to 28px; measure cpl at
  // the size it actually renders so the budget matches the render.
  const kickerSize = Math.max(ts.kicker, canvas.minFontPx);
  return {
    kicker: cap(kickerSize, DESIGN.kicker),
    headline: cap(ts.headline, DESIGN.headline),
    headlineHero: cap(ts.display, DESIGN.headlineHero),
    body: cap(ts.body, DESIGN.body),
    cta: cap(ts.cta, DESIGN.cta),
  };
}
