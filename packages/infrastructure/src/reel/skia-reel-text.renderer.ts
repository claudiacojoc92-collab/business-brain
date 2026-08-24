/**
 * Slice 7 — Skia caption/overlay renderer (Step 0 falsified resvg for complex scripts; this uses @napi-rs/canvas
 * = Skia + HarfBuzz + ICU). Renders a governed text block into a transparent RGBA caption strip (dark pill +
 * white text) placed in a face/subject-safe region. Script-routed bundled Noto OFL fonts; NO system fonts.
 * render-and-measure (real ink bounds), NOT advance-width. Frozen ResvgCarouselRenderer is untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';

const FONT_DIR = join(__dirname, '..', '..', 'assets', 'reel-fonts');
const FONTS: Record<string, string> = {
  'Noto Sans': 'NotoSans-Latin.ttf',
  'Noto Sans LatinExt': 'NotoSans-LatinExt.ttf',
  'Noto Sans Arabic': 'NotoSansArabic.ttf',
  'Noto Sans Devanagari': 'NotoSansDevanagari.ttf',
};

let registered = false; let buildId = 'skia-unpinned';
function ensureFonts(): void {
  if (registered) return;
  const h = createHash('sha256');
  for (const [alias, file] of Object.entries(FONTS)) {
    const p = join(FONT_DIR, file);
    GlobalFonts.registerFromPath(p, alias);
    h.update(readFileSync(p));
  }
  buildId = 'skia+noto+' + h.digest('hex').slice(0, 12);
  registered = true;
}

const RTL = /[֐-׿؀-ۿ܀-ݏ]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const ARABIC = /[؀-ۿ]/;

/** Script → bundled font stack. Latin stack covers ASCII + extended diacritics; non-Latin routes to its Noto face
 *  with the full Latin as fallback (for embedded ASCII digits/punctuation). */
function fontStack(text: string): { css: string; rtl: boolean } {
  if (ARABIC.test(text)) return { css: '"Noto Sans Arabic","Noto Sans","Noto Sans LatinExt"', rtl: true };
  if (DEVANAGARI.test(text)) return { css: '"Noto Sans Devanagari","Noto Sans","Noto Sans LatinExt"', rtl: false };
  return { css: '"Noto Sans","Noto Sans LatinExt"', rtl: RTL.test(text) };
}

export interface CaptionImage { readonly png: Buffer; readonly width: number; readonly height: number; readonly inkWidth: number }

export class SkiaReelTextRenderer {
  rendererVersion(): string { ensureFonts(); return buildId; }

  /** Render a single caption strip (transparent) sized `canvasW` × `stripH`, dark pill hugging the text, white
   *  text; the caption is horizontally centered and vertically centered within the strip. Wraps to ≤2 lines. */
  caption(text: string, canvasW: number, opts: { fontPx?: number; stripH?: number } = {}): CaptionImage {
    ensureFonts();
    const fontPx = opts.fontPx ?? 60;
    const stripH = opts.stripH ?? 240;
    const { css, rtl } = fontStack(text);
    const cv = createCanvas(canvasW, stripH);
    const cx = cv.getContext('2d');
    cx.font = `600 ${fontPx}px ${css}`;
    cx.direction = rtl ? 'rtl' : 'ltr';
    // wrap to fit width (word-wrap for spaced scripts; single line otherwise). Max 2 lines.
    const maxTextW = canvasW - 220;
    const lines = wrap(cx, text, maxTextW).slice(0, 2);
    const lineH = Math.round(fontPx * 1.28);
    const inkWidth = Math.min(maxTextW, Math.max(...lines.map((l) => cx.measureText(l).width)));
    const padX = 40, padY = 24;
    const pillW = Math.min(canvasW - 40, inkWidth + padX * 2);
    const pillH = lines.length * lineH + padY * 2;
    const px = Math.round((canvasW - pillW) / 2);
    const py = Math.round((stripH - pillH) / 2);
    // pill
    const r = 28; cx.fillStyle = 'rgba(11,11,11,0.74)';
    roundRect(cx, px, py, pillW, pillH, r); cx.fill();
    // text
    cx.fillStyle = '#ffffff'; cx.textBaseline = 'middle';
    cx.textAlign = rtl ? 'right' : 'left';
    const tx = rtl ? (px + pillW - padX) : (px + padX);
    lines.forEach((ln, i) => cx.fillText(ln, tx, py + padY + lineH * i + lineH / 2));
    return { png: cv.toBuffer('image/png'), width: canvasW, height: stripH, inkWidth };
  }
}

function wrap(cx: { measureText: (s: string) => { width: number } }, text: string, maxW: number): string[] {
  if (!/\s/.test(text)) return [text]; // CJK/space-less → single line (V1 captions are short)
  const words = text.split(/\s+/).filter(Boolean); const out: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (cx.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = w; } }
  if (cur) out.push(cur); return out;
}
function roundRect(cx: import('@napi-rs/canvas').SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  cx.beginPath(); cx.moveTo(x + r, y);
  cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath();
}
