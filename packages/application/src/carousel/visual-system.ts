/**
 * Slice 6 — AssetDesignDirection resolution + composition planner. Colour has TWO modes for MVP, over the ONE
 * frozen CanonicalCarouselTemplate v1 geometry (geometry never varies):
 *   MODE A — KNOWN CLIENT BRAND: sufficiently-grounded client tokens (see resolveBrandContext) drive the palette
 *            via brand-consistent tonal variants; contrast/readability preserved; geometry unchanged.
 *   MODE B — BRAND UNKNOWN / INSUFFICIENT: the frozen CANONICAL DEFAULT PALETTE v1 (a warm dusk / terracotta
 *            field, cream focal circle, warm dark-brown ground, warm muted lower-circle, restrained clay accent).
 * BB DOES have a canonical default visual treatment for businesses whose brand is unknown — that is intentional
 * for MVP and is NEVER presented as the client's brand. It is not grey/blue, not monochrome, not a "neutral"
 * aesthetic, and no client brand is invented. When grounded client tokens exist, the default is replaced by them.
 */
import type { VisualSystem, AssetDesignDirection, BrandContext, Slide, Concept, LayoutFamily, LayoutParams, GateFinding, HeadWeight, ImageTreatment, ColorRoles, CompositionStyle, BgStyle } from './contracts';

const ALL_FAMILIES: LayoutFamily[] = ['hero_hook', 'editorial_text', 'statement', 'proof_stat', 'split_media', 'photo_led', 'structured_list', 'contrast_reframe', 'cta_close'];

/** Coordinated semantic color roles derived from the brand palette (or brand-consistent tonal variants of
 * it) — never invented hues. A monochrome brand yields monochrome roles (a brand decision, not a limit). */
function colorRolesFrom(bg: string, ink: string, muted: string, accent: string | null, palette?: string[]): ColorRoles {
  const secondary = palette?.[4] ?? (accent ? mix(accent, bg, 0.58) : mix(bg, ink, isDark(bg) ? 0.2 : 0.09));
  const contrast = palette?.[5] ?? (accent ?? ink);
  const panel = mix(bg, ink, isDark(bg) ? 0.16 : 0.07);
  const on = (s: string) => (isDark(s) ? '#ffffff' : '#141414');
  return { base: bg, ink, muted, secondary, contrast, accent, panel, onSecondary: on(secondary), onContrast: on(contrast), onAccent: accent ? on(accent) : (isDark(bg) ? ink : bg) };
}

/** CANONICAL DEFAULT PALETTE v1 — FROZEN. The MODE B default colour family for the CanonicalCarouselTemplate v1
 * when the client brand is unknown/insufficient. Warm dusk / terracotta field, cream focal circle, warm dark-
 * brown ground, restrained clay accent. NOT grey, NOT blue, NOT monochrome; not the client's brand. */
export const CANONICAL_DEFAULT_PALETTE_V1 = { bg: '#f3ecdf', ink: '#251d15', muted: '#867868', accent: '#bd7d54' } as const;

/** MODE B — the frozen Canonical Default Palette v1 applied over the fixed geometry (brand unknown/insufficient).
 * Not a "neutral fallback" and not presented as the client's brand: it is BB's intentional MVP default treatment. */
export function canonicalDefaultVisualSystem(): AssetDesignDirection {
  const { bg, ink, muted, accent } = CANONICAL_DEFAULT_PALETTE_V1;
  return {
    visualSystemRef: 'canonical-default-v1', mode: 'restrained_default',
    bg, ink, muted, accent, panel: mix(bg, ink, 0.08), onAccent: '#f3ecdf',
    colorRoles: colorRolesFrom(bg, ink, muted, accent), compositionStyle: 'typographic_minimal', compositionVariant: 'a', irregular: true,
    headFamily: 'Inter', bodyFamily: 'Inter',
    typeScale: { display: 116, headline: 58, body: 33, kicker: 22, cta: 42 },
    headWeight: '700', headCase: 'none', tracking: 0,
    spacingUnit: 22, alignmentTendency: 'left', mediaTreatment: 'rounded', radius: 20,
    shapeTreatment: 'rule', shapeLanguage: 'rules', graphicEmphasis: 'bold', imageTreatment: 'framed',
    emphasis: 'bold', pageIndex: true, footer: null, logoRef: null, donts: [],
    compatibleFamilies: ALL_FAMILIES,
  };
}

const isDark = (hex: string): boolean => {
  const n = parseInt(hex.replace('#', ''), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 140;
};
const mix = (hex: string, toward: string, t: number): string => {
  const a = parseInt(hex.replace('#', ''), 16); const b = parseInt(toward.replace('#', ''), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255; const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return '#' + [c(ar, br), c(ag, bg), c(ab, bb)].map((v) => v.toString(16).padStart(2, '0')).join('');
};

/**
 * Resolve the AssetDesignDirection from a BrandContext. MODE A (known brand): its real palette / typography feel
 * / imagery style / don'ts drive typography, shape language, graphic emphasis, and image treatment (not just
 * color). MODE B (unknown / insufficient tokens): the frozen Canonical Default Palette v1.
 */
export function resolveDesignDirection(brand: BrandContext): AssetDesignDirection {
  if (brand.mode !== 'known' || !brand.constraints?.palette?.length) return canonicalDefaultVisualSystem();
  const c = brand.constraints; const p = c.palette!;
  const bg = p[0] ?? '#ffffff'; const ink = p[1] ?? (isDark(bg) ? '#ffffff' : '#141414'); const muted = p[2] ?? mix(ink, bg, 0.45); const accent = p[3] ?? null;
  const dark = isDark(bg);
  const typePref = (c.typePreference ?? '').toLowerCase();
  const bold = /geometric|grotesk|mono|tech|bold|display|condensed/.test(typePref);
  const imagery = (c.imageryStyle ?? '').toLowerCase();
  const imageTreatment: ImageTreatment = /photo|portrait|lifestyle|editorial/.test(imagery) ? 'full_bleed' : /product|screenshot|ui/.test(imagery) ? 'framed' : 'framed';
  const headWeight: HeadWeight = bold ? '700' : '700';
  // Brand composition: a real palette (accent + 4+ colors) → multi-surface; a bold/tech brand → high-contrast
  // statement; a monochrome brand (no accent) → monochrome. BB chooses; never a founder picker.
  const compositionStyle: CompositionStyle = !accent ? 'monochrome' : (bold ? 'high_contrast_statement' : 'multi_surface');
  return {
    visualSystemRef: `brand-${brand.brandContextVersion}`, mode: 'brand',
    bg, ink, muted, accent, panel: mix(bg, ink, dark ? 0.16 : 0.08), onAccent: accent ? (isDark(accent) ? '#ffffff' : '#141414') : (dark ? ink : bg),
    colorRoles: colorRolesFrom(bg, ink, muted, accent, p), compositionStyle, compositionVariant: 'a', irregular: true,
    headFamily: 'Inter', bodyFamily: 'Inter',
    typeScale: bold ? { display: 122, headline: 60, body: 33, kicker: 22, cta: 44 } : { display: 112, headline: 56, body: 33, kicker: 22, cta: 42 },
    headWeight, headCase: bold ? 'upper' : 'none', tracking: bold ? 0.02 : 0,
    spacingUnit: bold ? 20 : 24, alignmentTendency: 'left', mediaTreatment: /soft|round|warm/.test(typePref + imagery) ? 'rounded' : 'square', radius: bold ? 6 : 18,
    shapeTreatment: accent ? 'pill' : 'rule', shapeLanguage: accent ? 'panels' : 'rules', graphicEmphasis: bold ? 'statement' : 'bold',
    imageTreatment, emphasis: 'bold', pageIndex: true, footer: null, logoRef: c.logoRef ?? null, donts: c.explicitDonts ?? [],
    compatibleFamilies: ALL_FAMILIES,
  };
}
/** Back-compat alias used across the service. */
export const visualSystemFor = resolveDesignDirection;

// ── composition planner ──
const slideText = (s: Slide): string => s.textBlocks.map((b) => b.text).join(' ');
function density(s: Slide): LayoutParams['density'] { const n = slideText(s).replace(/\s+/g, ' ').trim().length; return n < 46 ? 'airy' : n < 120 ? 'medium' : 'dense'; }
const hasMedia = (s: Slide): boolean => s.mediaSlots.some((m) => m.kind === 'image' && m.sourceRefId);

function candidates(role: Slide['semanticRole'], media: boolean): LayoutFamily[] {
  const byRole: Record<string, LayoutFamily[]> = {
    hook: ['hero_hook', 'statement'], context: ['editorial_text', 'contrast_reframe'], proof: ['proof_stat', 'statement'],
    insight: ['statement', 'editorial_text'], reframe: ['contrast_reframe', 'split_media'], step: ['structured_list', 'editorial_text'], cta: ['cta_close'],
  };
  const base = byRole[role] ?? ['editorial_text'];
  if (media && role !== 'cta') return ['photo_led', 'split_media', ...base];
  return base;
}

/** Per-slide graphic composition, derived from the direction's emphasis + shape language + the slide role. */
function composeParams(family: LayoutFamily, role: Slide['semanticRole'], dir: AssetDesignDirection, media: boolean, dens: LayoutParams['density'], hasBody: boolean): LayoutParams {
  const A = dir.alignmentTendency;
  const base: Record<LayoutFamily, Omit<LayoutParams, 'surface' | 'accentBar' | 'bgStyle'>> = {
    hero_hook: { anchor: 'center', align: A, emphasis: 'display', mediaMode: media ? dir.imageTreatment : 'none', density: dens },
    statement: { anchor: 'center', align: 'center', emphasis: 'display', mediaMode: media ? 'background' : 'none', density: dens },
    editorial_text: { anchor: 'top', align: 'left', emphasis: 'headline', mediaMode: media ? 'top' : 'none', density: dens },
    proof_stat: { anchor: 'center', align: 'left', emphasis: 'stat', mediaMode: 'none', density: dens },
    split_media: { anchor: 'center', align: 'left', emphasis: 'headline', mediaMode: 'split', density: dens },
    photo_led: { anchor: 'bottom', align: 'left', emphasis: 'headline', mediaMode: 'full_bleed', density: dens },
    structured_list: { anchor: 'top', align: 'left', emphasis: 'headline', mediaMode: 'none', density: dens },
    contrast_reframe: { anchor: 'center', align: 'left', emphasis: 'display', mediaMode: 'none', density: dens },
    cta_close: { anchor: 'center', align: 'center', emphasis: 'headline', mediaMode: 'none', density: dens, shape: dir.shapeTreatment === 'none' ? 'rule' : dir.shapeTreatment },
  };
  const p = base[family];
  // a big DISPLAY/STAT headline eats the card when there is also a body → step it down so both fit
  let emphasis = p.emphasis;
  if (hasBody && emphasis !== 'headline' && dens !== 'airy') emphasis = 'headline';

  // surface: statement-emphasis brands use filled hook/CTA; proof gets a panel; bold uses panels sparingly
  let surface: LayoutParams['surface'] = 'default';
  if (dir.graphicEmphasis === 'statement') { if (role === 'hook' || role === 'cta') surface = 'filled'; else if (role === 'proof') surface = 'panel'; }
  else if (dir.graphicEmphasis === 'bold') { if (role === 'proof') surface = 'panel'; else if (role === 'cta' && dir.accent) surface = 'panel'; }
  if (media && (p.mediaMode === 'full_bleed' || p.mediaMode === 'background' || p.mediaMode === 'overlay')) surface = 'default'; // media provides the ground

  // bgStyle is authoritative over the ground: a graphic move (split/block/arc/…) means text sits on the base,
  // so a solid surface fill would hide the composition — fall back to 'default'. 'panel' keeps its panel.
  const bg = bgStyle(dir.compositionStyle, role, media);
  if (bg === 'panel') surface = 'panel';
  else if (bg !== 'solid' && bg !== 'contrast') surface = 'default';
  const accentBar = (dir.shapeLanguage === 'rules' || dir.shapeLanguage === 'panels') && (role === 'hook' || role === 'context' || role === 'reframe' || role === 'insight') && surface !== 'filled' && bg === 'solid';
  return { ...p, emphasis, surface, accentBar, bgStyle: bg };
}

/** Bounded, deterministic background graphic move per role, chosen by the asset's composition style. */
function bgStyle(style: CompositionStyle, role: Slide['semanticRole'], media: boolean): BgStyle {
  if (media) return 'solid'; // media provides the ground; no competing color graphic
  if (style === 'single_surface' || style === 'typographic_minimal' || style === 'monochrome' || style === 'photo_led') return 'solid';
  if (style === 'high_contrast_statement') return role === 'hook' || role === 'cta' ? 'contrast' : role === 'proof' ? 'panel' : 'solid';
  if (style === 'structured_graphic') return role === 'hook' ? 'blocks' : role === 'proof' ? 'panel' : role === 'cta' ? 'contrast' : 'block_side';
  // multi_surface: a coordinated layered look across the carousel
  switch (role) {
    case 'hook': return 'split_h';
    case 'proof': return 'panel';
    case 'context': return 'block_side';
    case 'insight': return 'arc';
    case 'reframe': return 'blocks';
    case 'cta': return 'contrast';
    default: return 'block_side';
  }
}

/** Assign each slide a coherent composition within the direction. Returns re-composed slides + ADVISORY
 * rhythm signals (never blocking; a safe carousel is never failed for aesthetic monotony). */
export function planLayouts(slides: Slide[], _concept: Concept, dir: AssetDesignDirection): { slides: Slide[]; advisories: GateFinding[] } {
  const compatible = new Set(dir.compatibleFamilies);
  const chosen: LayoutFamily[] = [];
  const out = slides.map((s) => {
    const media = hasMedia(s);
    const cands = candidates(s.semanticRole, media).filter((f) => compatible.has(f));
    let fam = cands[0] ?? 'editorial_text';
    if (chosen.length >= 2 && chosen[chosen.length - 1] === fam && chosen[chosen.length - 2] === fam) { const alt = cands.find((f) => f !== fam); if (alt) fam = alt; }
    chosen.push(fam);
    const hasBody = s.textBlocks.some((b) => b.role === 'body' && b.text.trim());
    const params = composeParams(fam, s.semanticRole, dir, media, density(s), hasBody);
    return { ...s, layoutFamily: fam, layoutParams: { ...params } as unknown as Record<string, string | number> };
  });
  const advisories: GateFinding[] = [];
  if (out.length >= 4 && new Set(chosen).size === 1) advisories.push({ code: 'visual_monotony_family', severity: 'advisory', slideId: null, detail: 'every slide uses the same layout family' });
  const anchors = new Set(out.map((s) => String((s.layoutParams as Record<string, unknown>)['anchor'])));
  if (out.length >= 4 && anchors.size === 1) advisories.push({ code: 'visual_monotony_anchor', severity: 'advisory', slideId: null, detail: 'every slide anchors text identically' });
  if (out.length >= 3 && chosen[0] === chosen[chosen.length - 1]) advisories.push({ code: 'visual_hook_cta_indistinct', severity: 'advisory', slideId: null, detail: 'hook and CTA read with the same composition' });
  return { slides: out, advisories };
}

/**
 * "Keep the copy, change the design" — MVP: a materially different composition WITHIN the SAME frozen base
 * design family (never a different visual system). It flips the composition variant (mirrors the focal-form
 * ↔ content-plane relationship and shifts field proportions) and toggles the headline case as a typographic
 * adaptation. Palette, depth language, and the base system stay fixed. Reversible (toggles the "-alt" ref).
 */
export function alternateVisualSystem(dir: AssetDesignDirection): AssetDesignDirection {
  const isAlt = dir.visualSystemRef.endsWith('-alt');
  if (isAlt) return { ...dir, visualSystemRef: dir.visualSystemRef.replace(/-alt$/, ''), compositionVariant: 'a', headCase: dir.headCase === 'upper' ? 'none' : 'upper' };
  return {
    ...dir, visualSystemRef: dir.visualSystemRef + '-alt',
    compositionVariant: dir.compositionVariant === 'b' ? 'a' : 'b',
    headCase: dir.headCase === 'upper' ? 'none' : 'upper', tracking: dir.headCase === 'upper' ? 0 : 0.02,
  };
}

export const systemAlignment = (s: VisualSystem): LayoutParams['align'] => s.alignmentTendency;
