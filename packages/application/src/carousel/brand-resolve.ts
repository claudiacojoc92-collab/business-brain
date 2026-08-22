/**
 * Slice 6 — HONEST brand resolution (discover-first projection over REAL BB data only).
 *
 * AUDIT FINDING: Business Brain does NOT derive any visual brand identity automatically. GovernedUnderstanding
 * carries no colour/logo/typography fields and the website-ingestion adapter captures none, so there is no
 * website colour/logo discovery to project from. This is therefore NOT a "brand discovery" crawler. The only
 * REAL brand signals BB holds are:
 *   1. Founder-uploaded BRAND ASSETS — media in the pool whose sourceType is 'brand_asset' (a founder marking an
 *      upload as their logo). The first such asset becomes the logo. This is the one genuinely discovered signal.
 *   2. Explicit founder brand constraints persisted via PUT /carousel/brand (palette / type / imagery / don'ts).
 *
 * Everything else stays UNKNOWN — we never invent a palette, font, or style from weak evidence. The result tints
 * the FROZEN canonical geometry (MODE A); absent any real signal, the frozen Canonical Default Palette v1 (MODE B)
 * is used — BB's intentional MVP default treatment, never presented as the client's brand.
 */
import type { BrandConstraints, BrandContext, CarouselSourceRef } from './contracts';

export function resolveBrandContext(businessId: string, explicit: BrandConstraints | null, mediaPool: CarouselSourceRef[]): BrandContext {
  const brandAsset = mediaPool.find((m) => m.sourceType === 'brand_asset' && m.mediaRef);
  const logoRef = explicit?.logoRef ?? brandAsset?.mediaRef;

  // union the real signals; omit unknowns entirely (no invented hues/fonts/styles)
  const constraints: BrandConstraints = {
    ...(logoRef ? { logoRef } : {}),
    ...(explicit?.palette?.length ? { palette: explicit.palette } : {}),
    ...(explicit?.typePreference ? { typePreference: explicit.typePreference } : {}),
    ...(explicit?.imageryStyle ? { imageryStyle: explicit.imageryStyle } : {}),
    ...(explicit?.explicitDonts?.length ? { explicitDonts: explicit.explicitDonts } : {}),
  };

  const hasSignal = Boolean(constraints.logoRef || constraints.palette?.length || constraints.typePreference || constraints.imageryStyle);
  if (!hasSignal) return { brandContextVersion: 'default-v1', mode: 'restrained_default' };
  return { brandContextVersion: 'brand-' + businessId, mode: 'known', constraints };
}
