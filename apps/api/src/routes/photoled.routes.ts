import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import type { CarouselOpportunity } from '@bb/application';
import { normalizeUpload } from '../media/normalize-image';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

// Founder-facing projection of the opportunity — NO internal ids / observation refs / model internals leak.
function projectOpportunity(o: CarouselOpportunity) {
  return {
    opportunityId: o.opportunityId,
    sufficiency: o.sufficiency,
    recommendation: o.founderLegibleRecommendation,
    whyPhotos: o.whyPhotosSupport,
    usingPhotos: o.usableMediaSubset.length,
    excludedPhotos: o.excludedMedia.length,
    missing: o.missingMaterial.map((m) => m.what),
    alternativeAvailable: o.alternativeAvailable,
    canCreate: o.sufficiency !== 'insufficient',
  };
}

/**
 * Slice 6.1 — Create from Photos. Upload a founder photo set → observe (literal media facts) → recommend ONE
 * strategy-specific angle → optional "another angle" → accept → emit the FROZEN CreateHandoff + immutable
 * PhotoLedCarouselContext, then the founder continues into the frozen Slice-6 carousel Preview/Export.
 * /v1 (JWT via the global preHandler); membership enforced per request.
 */
export function registerPhotoLedRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    return { business };
  }

  // Upload a photo set → observe → recommend. Body: { images: [{ dataBase64, filename? }] }.
  server.post('/v1/businesses/:id/carousel/photo-set', { bodyLimit: 40 * 1024 * 1024 }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const body = (request.body ?? {}) as { images?: { dataBase64?: string; filename?: string }[] };
    const imgs = (body.images ?? []).slice(0, 10);
    if (!imgs.length) throw new ValidationError('IMAGES_REQUIRED', 'At least one photo is required.');
    // Ingest each into the founder media pool (founder_uploaded), then observe literally. Each image is validated,
    // EXIF-rotated and re-encoded first. When one image is rejected the WHOLE set fails (predictable) — but the
    // response names WHICH image (1-based index + filename) and WHY (code), so the founder doesn't have to guess.
    const uploaded: { sourceRefId: string; bytes: Buffer; mime?: string }[] = [];
    for (let i = 0; i < imgs.length; i++) {
      const im = imgs[i]!;
      const raw = (im.dataBase64 ?? '').replace(/^data:[^;]+;base64,/, '').trim();
      if (!raw) continue; // empty slot — not a real image the founder picked; skip it
      const bytes = Buffer.from(raw, 'base64');
      // Oversized INPUT: reject before decoding (cheap DoS guard). The helper re-checks the normalized output too.
      if (bytes.length > 10 * 1024 * 1024) { await reply.status(200).send({ state: 'rejected', code: 'IMAGE_TOO_LARGE', imageIndex: i + 1, filename: im.filename ?? null }); return; }
      const norm = await normalizeUpload(bytes);
      if (!norm.ok) { await reply.status(200).send({ state: 'rejected', code: norm.code, imageIndex: i + 1, filename: im.filename ?? null }); return; }
      const ref = await deps.carouselService.addMedia(business.id, { bytes: norm.bytes, ...(im.filename ? { filename: im.filename } : {}), reuseRight: 'founder_uploaded' });
      uploaded.push({ sourceRefId: ref.sourceRefId, bytes: norm.bytes });
    }
    if (!uploaded.length) throw new ValidationError('IMAGES_REQUIRED', 'At least one photo is required.');
    const obs = await deps.photoLedService.observePhotoSet(business.id, uploaded);
    if (obs.status !== 'observed') { await reply.status(200).send({ state: 'no_images' }); return; }
    const rec = await deps.photoLedService.recommend(business.id, obs.photoSet.photoSetUnderstandingId);
    if (rec.status === 'no_strategy') { await reply.status(200).send({ state: 'no_strategy' }); return; }
    if (rec.status !== 'recommended') { await reply.status(200).send({ state: 'insufficient' }); return; }
    await reply.status(200).send({ state: 'recommended', photoSetUnderstandingId: obs.photoSet.photoSetUnderstandingId, setSignal: obs.photoSet.setSignal, opportunity: projectOpportunity(rec.opportunity) });
  });

  // "Show me another angle".
  server.post('/v1/businesses/:id/carousel/photo-opportunity/:opportunityId/alternative', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { opportunityId } = request.params as { opportunityId: string };
    const rec = await deps.photoLedService.alternative(business.id, opportunityId);
    if (rec.status === 'not_found') { await reply.status(404).send({ error: { code: 'OPPORTUNITY_NOT_FOUND', message: 'No such opportunity.' } }); return; }
    if (rec.status !== 'recommended') { await reply.status(200).send({ state: rec.status }); return; }
    await reply.status(200).send({ state: 'recommended', opportunity: projectOpportunity(rec.opportunity) });
  });

  // Accept → emit CreateHandoff + PhotoLedCarouselContext → { createHandoffId } (web navigates to the carousel).
  server.post('/v1/businesses/:id/carousel/photo-opportunity/:opportunityId/accept', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { opportunityId } = request.params as { opportunityId: string };
    const res = await deps.photoLedService.accept(business.id, opportunityId);
    if (res.status === 'not_found') { await reply.status(404).send({ error: { code: 'OPPORTUNITY_NOT_FOUND', message: 'No such opportunity.' } }); return; }
    if (res.status === 'insufficient') { await reply.status(200).send({ state: 'insufficient' }); return; }
    if (res.status === 'invalid') { await reply.status(200).send({ state: 'invalid' }); return; }
    await reply.status(200).send({ state: 'accepted', createHandoffId: res.createHandoffId });
  });
}
