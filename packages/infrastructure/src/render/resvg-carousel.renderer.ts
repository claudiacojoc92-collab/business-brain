/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Slice 6 — deterministic carousel renderer (IRenderPort). A bounded but REAL graphic-composition engine:
 * the AssetDesignDirection drives palette, typography (scale / weight / case / tracking), shape language
 * (hairline rules / filled panels), graphic emphasis (surface fills, big stat treatment), a sequence marker,
 * a corner logo, and image treatments (top / split / full-bleed / framed / inset / background / overlay).
 * Determinism: pinned Inter TTFs (loadSystemFonts:false) + same composition → byte-stable PNG. Text is
 * measured with opentype; the returned SlideMeasure feeds the HARD structural gates.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import * as opentype from 'opentype.js';
import { planComposition } from '@bb/application';
import type { IRenderPort, RenderComposition, RenderedSlide, SlideMeasure, Slide, VisualSystem, CanvasSpec, TextBlock } from '@bb/application';

const FONT_DIR = join(__dirname, '..', '..', 'assets', 'fonts');
const FONT_FILES: Record<string, string> = { '400': 'Inter-400Regular.ttf', '500': 'Inter-500Medium.ttf', '600': 'Inter-600SemiBold.ttf', '700': 'Inter-700Bold.ttf' };

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const chan = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function luminance(hex: string): number { const n = parseInt(hex.replace('#', ''), 16); return 0.2126 * chan((n >> 16) & 255) + 0.7152 * chan((n >> 8) & 255) + 0.0722 * chan(n & 255); }
function contrast(a: string, b: string): number { const l1 = luminance(a), l2 = luminance(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); }

type Weight = '400' | '500' | '600' | '700';
type Align = 'left' | 'center';
type Emphasis = 'headline' | 'display' | 'stat';
interface Line { text: string; sizePx: number; weight: Weight; color: string; bg: string; x: number; y: number; align: Align; track: number }

export class ResvgCarouselRenderer implements IRenderPort {
  private readonly fontPaths: string[];
  private readonly metrics: Record<Weight, opentype.Font>;
  private readonly buildId: string;

  constructor(fontDir = FONT_DIR) {
    this.fontPaths = []; this.metrics = {} as Record<Weight, opentype.Font>;
    const hash = createHash('sha256');
    for (const [w, f] of Object.entries(FONT_FILES)) {
      const path = join(fontDir, f); const buf = readFileSync(path);
      this.fontPaths.push(path); hash.update(buf);
      this.metrics[w as Weight] = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    }
    this.buildId = 'resvg2.6.2+inter5+design1+' + hash.digest('hex').slice(0, 12);
  }
  rendererVersion(): string { return this.buildId; }

  private advance(text: string, sizePx: number, weight: Weight, track: number): number {
    return this.metrics[weight].getAdvanceWidth(text, sizePx) + Math.max(0, text.length - 1) * track * sizePx;
  }
  private wrap(text: string, sizePx: number, weight: Weight, boxW: number, track: number): string[] {
    const words = text.split(/\s+/).filter(Boolean); const lines: string[] = []; let cur = '';
    for (const word of words) { const trial = cur ? cur + ' ' + word : word; if (this.advance(trial, sizePx, weight, track) <= boxW || !cur) cur = trial; else { lines.push(cur); cur = word; } }
    if (cur) lines.push(cur); return lines;
  }
  private fitBlock(text: string, weight: Weight, startSize: number, minFontPx: number, boxW: number, maxH: number, lh: number, track: number): { lines: string[]; sizePx: number; heightPx: number; overflow: boolean } {
    for (let size = startSize; size >= minFontPx; size -= 2) {
      const lines = this.wrap(text, size, weight, boxW, track);
      const widest = Math.max(0, ...lines.map((l) => this.advance(l, size, weight, track)));
      const height = lines.length * size * lh;
      if (height <= maxH && widest <= boxW) return { lines, sizePx: size, heightPx: height, overflow: false };
    }
    const lines = this.wrap(text, minFontPx, weight, boxW, track);
    return { lines, sizePx: minFontPx, heightPx: lines.length * minFontPx * lh, overflow: true };
  }
  private missingGlyphs(text: string): boolean { for (const ch of text) { if (ch === ' ' || ch === '\n') continue; if (this.metrics['400'].charToGlyphIndex(ch) <= 0) return true; } return false; }

  private startSize(role: TextBlock['role'], vs: VisualSystem, emphasis: Emphasis): { weight: Weight; size: number; lh: number } {
    const ts = vs.typeScale;
    switch (role) {
      case 'kicker': return { weight: '600', size: ts.kicker, lh: 1.2 };
      case 'headline': return { weight: vs.headWeight, size: emphasis === 'headline' ? ts.headline : ts.display, lh: emphasis === 'headline' ? 1.1 : 1.04 };
      case 'cta': return { weight: '600', size: ts.cta, lh: 1.16 };
      case 'caption': return { weight: '400', size: Math.round(ts.body * 0.82), lh: 1.35 };
      default: return { weight: '400', size: ts.body, lh: 1.36 };
    }
  }

  private layoutSlide(slide: Slide, vs: VisualSystem, canvas: CanvasSpec, media: Record<string, Buffer>, index: number, total: number): { svg: string; measure: SlideMeasure } {
    const { width, height, margin, minFontPx } = canvas;
    const plan = planComposition(slide, vs);
    const upper = vs.headCase === 'upper';
    const track = vs.tracking;
    const slot = slide.mediaSlots.find((s) => s.kind === 'image' && s.sourceRefId && media[s.sourceRefId!]);
    const hasMedia = Boolean(slot);
    const mediaSlotRequested = slide.mediaSlots.some((s) => s.kind === 'image');

    // ── CANONICAL LAYERS: dark ground → gradient sky (top field) → split focal circle → decorative panel. ──
    let defs = ''; let layers = '';
    const horizonY = plan.secondary ? Math.round(height * plan.secondary.frac) : 0;
    if (plan.skyFrom && plan.skyTo) {
      defs += `<linearGradient id="sky" x1="0" y1="0" x2="1" y2="0.6"><stop offset="0" stop-color="${plan.skyFrom}"/><stop offset="1" stop-color="${plan.skyTo}"/></linearGradient>`;
      layers += `<rect x="0" y="0" width="${width}" height="${horizonY}" fill="url(#sky)"/>`;
    } else if (plan.secondary) {
      const f = plan.secondary; let x = 0, y = 0, w = width, h = height;
      if (f.edge === 'top') h = Math.round(height * f.frac);
      else if (f.edge === 'bottom') { y = Math.round(height * (1 - f.frac)); h = height - y; }
      else if (f.edge === 'left') w = Math.round(width * f.frac);
      else { x = Math.round(width * (1 - f.frac)); w = width - x; }
      layers += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f.color}"/>`;
    }
    if (plan.focal?.kind === 'media' && slot) {
      const b64 = (media[slot.sourceRefId!] ?? Buffer.alloc(0)).toString('base64');
      layers += `<image href="data:image/png;base64,${b64}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`;
    } else if (plan.focal?.kind === 'disc') {
      const r = Math.round(width * plan.focal.scaleW / 2); const cx = Math.round(width * plan.focal.cxFrac); const cy = Math.round(height * plan.focal.cyFrac);
      if (plan.focalBelow && horizonY > 0) {
        defs += `<clipPath id="ab"><rect x="0" y="0" width="${width}" height="${horizonY}"/></clipPath><clipPath id="be"><rect x="0" y="${horizonY}" width="${width}" height="${height - horizonY}"/></clipPath>`;
        layers += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${plan.focal.color}" clip-path="url(#ab)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${plan.focalBelow}" clip-path="url(#be)"/>`;
      } else {
        layers += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${plan.focal.color}" fill-opacity="${plan.focal.opacity}"/>`;
      }
    }
    let px = 0, py = 0, pw = 0, ph = 0; const hasPlane = Boolean(plan.plane);
    if (plan.plane) {
      const pl = plan.plane;
      px = Math.round(width * pl.xFrac); py = Math.round(height * pl.yFrac); pw = Math.round(width * pl.wFrac); ph = Math.round(height * pl.hFrac);
      if (pl.elevate) layers += `<rect x="${px}" y="${py + 16}" width="${pw}" height="${ph}" rx="${pl.radius}" fill="#000000" fill-opacity="0.13"/>`;
      layers += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${pl.radius}" fill="${pl.fill}"/>`;
    }

    // ── TEXT REGION ──
    const pad = 46;
    let tx: number, tw: number, ty0: number, ty1: number, inkColor: string, mutedColor: string, bgBehind: string;
    if (plan.textOn === 'canvas_bottom') {
      // anchored bottom-left on the canvas, spanning the width, over the dark ground/panel → light text.
      tx = margin; tw = width - margin * 2; ty0 = Math.round(height * 0.5); ty1 = height - margin - (vs.footer ? 60 : 6);
      inkColor = plan.ink; mutedColor = plan.plane ? plan.plane.onFillMuted : plan.muted; bgBehind = plan.plane ? plan.plane.fill : plan.ground;
    } else if (plan.textOn === 'plane' && hasPlane) {
      tx = px + pad; tw = pw - pad * 2; ty0 = py + pad; ty1 = py + ph - pad;
      inkColor = plan.plane!.onFill; mutedColor = plan.plane!.onFillMuted; bgBehind = plan.plane!.fill;
    } else {
      tx = margin; tw = width - margin * 2; ty0 = margin + (vs.pageIndex ? 50 : 0); ty1 = height - margin - (vs.footer ? 58 : 0);
      inkColor = plan.ink; mutedColor = plan.muted; bgBehind = plan.ground;
    }
    const barH = plan.accentRule ? 30 : 0;
    const regionH = ty1 - ty0;

    // ── measure text (remaining-height aware; headline capped so a following body always fits) ──
    const orderedRoles: Array<TextBlock['role']> = ['kicker', 'headline', 'body', 'cta', 'caption'];
    const blocks = [...slide.textBlocks].filter((b) => b.text.trim()).sort((a, b) => orderedRoles.indexOf(a.role) - orderedRoles.indexOf(b.role));
    const isList = slide.layoutFamily === 'structured_list';
    const measured: Array<{ lines: string[]; sizePx: number; weight: Weight; color: string; lh: number; gap: number; track: number }> = [];
    let anyOverflow = false; let minSize = Infinity; let totalH = 0;
    const avail = regionH - barH;
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi]!;
      const st = this.startSize(b.role, vs, plan.emphasis);
      const isHead = b.role === 'headline'; const tk = isHead ? track : 0;
      const color = b.role === 'kicker' ? mutedColor : inkColor; // body stays fully legible (never dimmed below WCAG)
      const text0 = b.role === 'kicker' || (isHead && upper) ? b.text.toUpperCase() : b.text;
      if (b.role === 'body' && isList) {
        for (const it of text0.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)) {
          const fit = this.fitBlock('•  ' + it, st.weight, st.size, minFontPx, tw, Math.max(0, avail - totalH), st.lh, 0);
          if (fit.overflow) anyOverflow = true; minSize = Math.min(minSize, fit.sizePx);
          measured.push({ lines: fit.lines, sizePx: fit.sizePx, weight: st.weight, color, lh: st.lh, gap: 12, track: 0 }); totalH += fit.heightPx + 12;
        }
        continue;
      }
      const hasAfter = blocks.slice(bi + 1).some((x) => x.text.trim());
      const cap = isHead && hasAfter ? Math.min(avail - totalH, Math.round(avail * 0.6)) : avail - totalH;
      const fit = this.fitBlock(text0, st.weight, st.size, minFontPx, tw, Math.max(0, cap), st.lh, tk);
      if (fit.overflow) anyOverflow = true; minSize = Math.min(minSize, fit.sizePx);
      const gap = isHead ? Math.round(vs.spacingUnit * 0.8) : Math.round(vs.spacingUnit * 0.55);
      measured.push({ lines: fit.lines, sizePx: fit.sizePx, weight: st.weight, color, lh: st.lh, gap, track: tk }); totalH += fit.heightPx + gap;
    }
    if (measured.length) totalH -= measured[measured.length - 1]!.gap; // trailing gap isn't part of the block stack
    const anyText = measured.length > 0;
    if (totalH + barH > regionH + 1) anyOverflow = true;

    // ── place text within the region (vertical anchor), accent rule above the first line ──
    const slack = Math.max(0, regionH - totalH - barH);
    let cursorY = plan.vAnchor === 'bottom' ? Math.max(ty0, ty1 - totalH - barH)
      : plan.vAnchor === 'center' ? ty0 + Math.min(slack, Math.max(0, slack / 2 + (plan.vNudge || 0))) : ty0;
    let barSvg = '';
    if (plan.accentRule) { barSvg = `<rect x="${plan.align === 'center' ? Math.round(tx + tw / 2 - 40) : tx}" y="${Math.round(cursorY)}" width="80" height="6" rx="3" fill="${plan.accentColor}"/>`; cursorY += barH; }
    const lines: Line[] = [];
    for (const m of measured) {
      for (const ln of m.lines) {
        cursorY += m.sizePx * m.lh;
        const x = plan.align === 'center' ? Math.round(tx + tw / 2) : tx;
        lines.push({ text: ln, sizePx: m.sizePx, weight: m.weight, color: m.color, bg: bgBehind, x, y: Math.round(cursorY - m.sizePx * 0.22), align: plan.align, track: m.track });
      }
      cursorY += m.gap;
    }

    // ── chrome: sequence marker + logo + footer (consistent, framing) ──
    let chrome = '';
    const indexColor = plan.indexOnField && plan.secondary ? (luminance(plan.secondary.color) < 0.4 ? '#ffffff' : '#141414') : plan.chromeColor;
    if (vs.pageIndex && total > 1) chrome += `<text x="${margin}" y="${margin + 4}" font-family="Inter" font-weight="600" font-size="24" letter-spacing="${(0.06 * 24).toFixed(2)}" fill="${indexColor}">${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</text>`;
    if (vs.logoRef && media[vs.logoRef]) { const lw = 132; const lb = media[vs.logoRef]!.toString('base64'); chrome += `<image href="data:image/png;base64,${lb}" x="${width - margin - lw}" y="${margin - 12}" width="${lw}" height="52" preserveAspectRatio="xMidYMid meet"/>`; }
    if (vs.footer) { const fy = height - margin - 4; chrome += `<rect x="${margin}" y="${fy - 30}" width="52" height="4" rx="2" fill="${plan.accentColor}"/><text x="${margin}" y="${fy}" font-family="Inter" font-weight="500" font-size="23" letter-spacing="1.6" fill="${plan.chromeColor}">${esc(vs.footer.toUpperCase())}</text>`; }

    const textSvg = lines.map((l) => `<text x="${l.x}" y="${l.y}" font-family="Inter" font-weight="${l.weight}" font-size="${l.sizePx}"${l.track ? ` letter-spacing="${(l.track * l.sizePx).toFixed(2)}"` : ''} fill="${l.color}"${l.align === 'center' ? ' text-anchor="middle"' : ''}>${esc(l.text)}</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<defs>${defs}</defs><rect width="${width}" height="${height}" fill="${plan.ground}"/>` +
      layers + barSvg + chrome + textSvg + `</svg>`;

    const measure: SlideMeasure = {
      overflow: anyOverflow,
      minFontPx: anyText ? (minSize === Infinity ? 0 : minSize) : canvas.minFontPx,
      withinMargins: !anyOverflow,
      clipped: false,
      minContrast: lines.length ? Math.min(...lines.map((l) => contrast(l.bg, l.color))) : contrast(plan.ground, inkColor),
      missingGlyphs: lines.some((l) => this.missingGlyphs(l.text)),
      mediaPresent: mediaSlotRequested ? hasMedia : true,
    };
    return { svg, measure };
  }

  async render(comp: RenderComposition): Promise<RenderedSlide[]> {
    const out: RenderedSlide[] = [];
    const slides = [...comp.slides].sort((a, b) => a.order - b.order);
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i]!;
      const { svg, measure } = this.layoutSlide(slide, comp.visualSystem, comp.canvasSpec, comp.media, i, slides.length);
      const png = new Resvg(svg, {
        background: comp.visualSystem.bg,
        font: { loadSystemFonts: false, fontFiles: this.fontPaths, defaultFontFamily: 'Inter' },
        fitTo: { mode: 'width', value: comp.canvasSpec.width },
      }).render().asPng();
      out.push({ slideId: slide.slideId, order: slide.order, png: Buffer.from(png), widthPx: comp.canvasSpec.width, heightPx: comp.canvasSpec.height, measure });
    }
    return out;
  }
}
