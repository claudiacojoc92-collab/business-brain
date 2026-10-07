/**
 * Slice 6 — deterministic STRUCTURAL visual gates. These consume the renderer's measurements and prove
 * structural validity ONLY (not aesthetics). All findings here are BLOCKING: a carousel that trips any of
 * them may not be shown as "ready" or exported. Aesthetic quality is a separate advisory concern.
 */
import type { RenderedSlide, CanvasSpec, Slide, GateReport, GateFinding } from './contracts';

const MIN_CONTRAST = 4.5;   // WCAG AA for large text is 3:1; we hold body copy to 4.5:1
const MIN_SLIDES = 3;
const MAX_SLIDES = 8;

export function structuralVisualGates(rendered: RenderedSlide[], slides: Slide[], canvas: CanvasSpec): GateReport {
  const f: GateFinding[] = [];
  const push = (code: string, slideId: string | null, detail: string): void => { f.push({ code, severity: 'blocking', slideId, detail }); };

  if (rendered.length < MIN_SLIDES || rendered.length > MAX_SLIDES) push('slide_count_out_of_range', null, `${rendered.length} slides (allowed ${MIN_SLIDES}–${MAX_SLIDES})`);

  const headlines = new Map<string, number>(); // duplicate-headline detection across slides
  for (const r of rendered) {
    const m = r.measure;
    if (m.overflow) push('text_overflow', r.slideId, 'copy does not fit above the minimum readable size');
    if (m.minFontPx > 0 && m.minFontPx < canvas.minFontPx) push('below_min_font', r.slideId, `${m.minFontPx}px < ${canvas.minFontPx}px floor`);
    if (!m.withinMargins) push('outside_safe_margins', r.slideId, 'content exceeds the safe margin box');
    if (m.clipped) push('clipped_element', r.slideId, 'an element is clipped by the canvas');
    if (!m.mediaPresent) push('empty_media_slot', r.slideId, 'an image slot has no eligible media');
    if (m.minContrast < MIN_CONTRAST) push('low_contrast', r.slideId, `contrast ${m.minContrast.toFixed(2)} < ${MIN_CONTRAST}`);
    if (m.missingGlyphs) push('missing_glyphs', r.slideId, 'a character has no glyph in the embedded font');
    if (r.widthPx !== canvas.width || r.heightPx !== canvas.height) push('wrong_dimensions', r.slideId, `${r.widthPx}×${r.heightPx} ≠ ${canvas.width}×${canvas.height}`);
    const s = slides.find((x) => x.slideId === r.slideId);
    const head = s?.textBlocks.find((b) => b.role === 'headline')?.text.trim().toLowerCase();
    if (head) headlines.set(head, (headlines.get(head) ?? 0) + 1);
  }
  for (const [h, n] of headlines) if (n > 1) push('duplicate_text', null, `headline repeated across ${n} slides: "${h.slice(0, 40)}"`);

  // a carousel must carry a CTA somewhere (usually the last slide)
  const hasCta = slides.some((s) => s.semanticRole === 'cta' || s.textBlocks.some((b) => b.role === 'cta' && b.text.trim()));
  if (!hasCta) push('missing_cta', null, 'no CTA slide/block present');

  return { valid: f.length === 0, findings: f };
}
