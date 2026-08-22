import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { ResvgCarouselRenderer } from '../../render/resvg-carousel.renderer';
import { structuralVisualGates, canonicalDefaultVisualSystem } from '@bb/application';
import type { Slide, CanvasSpec, RenderComposition } from '@bb/application';

const CANVAS: CanvasSpec = { width: 1080, height: 1350, margin: 96, minFontPx: 28 };
const VS = canonicalDefaultVisualSystem();

function slide(id: string, order: number, role: Slide['semanticRole'], headline: string, body?: string): Slide {
  const tb: Slide['textBlocks'] = [{ blockId: id + '-h', role: 'headline', text: headline, authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: null }, locked: false }];
  if (body) tb.push({ blockId: id + '-b', role: 'body', text: body, authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: null }, locked: false });
  if (role === 'cta') tb.push({ blockId: id + '-c', role: 'cta', text: 'Book a 20-minute diagnostic call', authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: 'book_call' }, locked: false });
  return { slideId: id, order, semanticRole: role, textBlocks: tb, mediaSlots: [], layoutFamily: role === 'hook' ? 'hero_hook' : role === 'cta' ? 'cta_close' : 'editorial_text', layoutParams: {}, lockedFields: [], sourceRefIds: [] };
}
const comp = (slides: Slide[]): RenderComposition => ({ canvasSpec: CANVAS, visualSystem: VS, slides, media: {} });
const hash = (b: Buffer): string => createHash('sha256').update(b).digest('hex').slice(0, 16);

describe('Slice 6 — deterministic carousel renderer', () => {
  const r = new ResvgCarouselRenderer();
  const good: Slide[] = [
    slide('s1', 0, 'hook', 'The SaaS founder who cut burn 30%'),
    slide('s2', 1, 'proof', 'What actually changed', 'Runway pressure post-raise, three finance moves, a documented 30% burn reduction.'),
    slide('s3', 2, 'cta', 'Want the same finance clarity?'),
  ];

  it('renders real 1080×1350 PNGs and passes structural gates', async () => {
    const out = await r.render(comp(good));
    expect(out).toHaveLength(3);
    for (const s of out) { expect(s.widthPx).toBe(1080); expect(s.heightPx).toBe(1350); expect(s.png.length).toBeGreaterThan(1000); expect(s.png.subarray(1, 4).toString()).toBe('PNG'); }
    const report = structuralVisualGates(out, good, CANVAS);
    expect(report.valid).toBe(true);
  });

  it('is deterministic: same composition → identical PNG hashes', async () => {
    const a = await r.render(comp(good)); const b = await r.render(comp(good));
    expect(a.map((s) => hash(s.png))).toEqual(b.map((s) => hash(s.png)));
    expect(r.rendererVersion()).toMatch(/^resvg2\.6\.2\+inter5\+/);
  });

  it('catches text overflow (unfittable copy) as a blocking gate', async () => {
    const huge = 'X'.repeat(400); // a single unbreakable token cannot wrap → overflow even at min font
    const bad = [slide('o1', 0, 'hook', huge), good[1]!, good[2]!];
    const out = await r.render(comp(bad));
    const report = structuralVisualGates(out, bad, CANVAS);
    expect(report.valid).toBe(false);
    expect(report.findings.some((f) => f.code === 'text_overflow' || f.code === 'below_min_font')).toBe(true);
  });

  it('renders Romanian/Italian diacritics without missing glyphs', async () => {
    const ro = [slide('r1', 0, 'hook', 'Redu risipa acțiunilor și câștigă timp'), slide('r2', 1, 'proof', 'Perché è più efficace', 'Così ottieni però risultati veri.'), slide('r3', 2, 'cta', 'Începe astăzi')];
    const out = await r.render(comp(ro));
    expect(structuralVisualGates(out, ro, CANVAS).findings.some((f) => f.code === 'missing_glyphs')).toBe(false);
  });
});
