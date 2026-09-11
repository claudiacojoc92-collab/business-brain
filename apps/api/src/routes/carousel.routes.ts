import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { recordFounderEvent } from '../telemetry/founder-events';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import type { CarouselAssetVersion, RenderVersion, RevisionScopeKind } from '@bb/application';

interface AuthedUser { sub: string; role: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}

// Founder-facing projection: rendered slides (image URLs) + light copy, NO layers/ids/snapshot/template internals.
function projectAsset(businessId: string, version: CarouselAssetVersion, render: RenderVersion | null) {
  const base = `/v1/businesses/${encodeURIComponent(businessId)}/carousel/render/${encodeURIComponent(version.versionId)}`;
  const bySlide = new Map((render?.slideImages ?? []).map((si) => [si.slideId, si]));
  return {
    assetId: version.assetId, versionId: version.versionId, versionNumber: version.versionNumber,
    direction: version.concept.rationale, ready: Boolean(render?.gateReport.valid),
    slides: version.slides.slice().sort((a, b) => a.order - b.order).map((s) => ({
      slideId: s.slideId, order: s.order, role: s.semanticRole,
      imageUrl: bySlide.has(s.slideId) ? `${base}/slide/${s.order}.png` : null,
      canRevise: !s.lockedFields.includes('slide'),
      headline: s.textBlocks.find((b) => b.role === 'headline')?.text ?? '',
      body: s.textBlocks.find((b) => b.role === 'body')?.text ?? '',
      cta: s.textBlocks.find((b) => b.role === 'cta')?.text ?? '',
    })),
    exportUrl: render?.gateReport.valid ? `${base}/export.zip` : null,
  };
}

/**
 * Slice 6 — carousel Create/Preview/Revise/Export (image carousel, 1080×1350, PNG + ZIP). /v1 (JWT via the
 * global preHandler); membership enforced per request. Governance is upstream in CarouselService.
 */
export function registerCarouselRoutes(server: FastifyInstance, deps: ServerDeps): void {
  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    return { founderId, business };
  }

  // Generate a carousel from an eligible CreateHandoff (idempotent-ish: reuse the existing asset if present).
  server.post('/v1/businesses/:id/carousel/generate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const createHandoffId = ((request.body as { createHandoffId?: string } | undefined)?.createHandoffId ?? '').trim();
    if (!createHandoffId) throw new ValidationError('CREATE_HANDOFF_REQUIRED', 'A create handoff id is required.');
    const existing = await deps.carouselService.getAssetByHandoff?.(business.id, createHandoffId) ?? null;
    if (existing) { const got = await deps.carouselService.getAsset(business.id, existing.assetId); if (got) { await reply.status(200).send({ state: 'ready', ...projectAsset(business.id, got.version, got.render) }); return; } }
    const res = await deps.carouselService.generate(business.id, createHandoffId);
    if (res.status === 'unavailable_format') { await reply.status(200).send({ state: 'unavailable_format', requested: res.requested }); return; }
    if (res.status === 'no_strategy') { await reply.status(200).send({ state: 'no_strategy' }); return; }
    if (res.status === 'insufficient') { recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'asset_generation_insufficient_material', surface: 'create', metadata: {} }); await reply.status(200).send({ state: 'insufficient' }); return; }
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'asset_generated', surface: 'create', metadata: { adapted: Boolean(res.version.brief.adaptedFrom), slides: res.version.slides.length } });
    await reply.status(200).send({ state: 'ready', ...projectAsset(business.id, res.version, res.render) });
  });

  server.get('/v1/businesses/:id/carousel/:assetId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { assetId } = request.params as { assetId: string };
    const got = await deps.carouselService.getAsset(business.id, assetId);
    if (!got) { await reply.status(404).send({ error: { code: 'CAROUSEL_NOT_FOUND', message: 'No such carousel.' } }); return; }
    await reply.status(200).send({ state: 'ready', ...projectAsset(business.id, got.version, got.render) });
  });

  server.post('/v1/businesses/:id/carousel/:assetId/revise', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const { assetId } = request.params as { assetId: string };
    const body = (request.body ?? {}) as { scope?: string; slideId?: string; request?: string; headline?: string; body?: string; cta?: string };
    const kind = (['copy_only', 'slide', 'visual_only', 'cta', 'source_swap', 'concept'].includes(body.scope ?? '') ? body.scope : 'copy_only') as RevisionScopeKind;
    const res = await deps.carouselService.revise(business.id, assetId,
      { kind, slideId: body.slideId, request: body.request ?? '' },
      { headline: body.headline, body: body.body, cta: body.cta });
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'asset_revision_requested', surface: 'create', metadata: { scope: kind, rejected: res.status === 'revision_rejected' } });
    if (res.status === 'revision_rejected') { await reply.status(200).send({ state: 'revision_rejected', reasons: res.findings.map((f) => f.detail) }); return; }
    const got = await deps.carouselService.getAsset(business.id, assetId);
    await reply.status(200).send({ state: 'ready', ...projectAsset(business.id, got!.version, got!.render) });
  });

  // Founder media upload (base64 JSON) → eligible source pool. BB later chooses whether/how to use it.
  server.post('/v1/businesses/:id/carousel/media', { bodyLimit: 12 * 1024 * 1024 }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const body = (request.body ?? {}) as { dataBase64?: string; filename?: string; reuseRight?: string; kind?: string };
    const raw = (body.dataBase64 ?? '').replace(/^data:[^;]+;base64,/, '').trim();
    if (!raw) throw new ValidationError('MEDIA_REQUIRED', 'Image data is required.');
    const bytes = Buffer.from(raw, 'base64');
    if (bytes.length < 8 || bytes.length > 10 * 1024 * 1024) throw new ValidationError('MEDIA_INVALID', 'Image is empty or too large (max 10MB).');
    const rr = (['owned', 'founder_uploaded', 'licensed'] as const).find((x) => x === body.reuseRight) ?? 'founder_uploaded';
    // a founder marking an upload as their logo becomes a real brand signal (see resolveBrandContext)
    const sourceType = body.kind === 'brand_asset' ? ('brand_asset' as const) : undefined;
    const ref = await deps.carouselService.addMedia(business.id, { bytes, ...(body.filename ? { filename: body.filename } : {}), reuseRight: rr, ...(sourceType ? { sourceType } : {}) });
    await reply.status(201).send({ sourceRefId: ref.sourceRefId, reuseRight: ref.reuseRight });
  });
  server.get('/v1/businesses/:id/carousel/media', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const pool = await deps.carouselService.listMedia(business.id);
    await reply.status(200).send({ media: pool.map((m) => ({ sourceRefId: m.sourceRefId, reuseRight: m.reuseRight, provenance: m.provenance })) });
  });

  // Grounded brand tokens (palette/logo/type/imagery/don'ts) that tint the frozen canonical template.
  server.put('/v1/businesses/:id/carousel/brand', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const b = (request.body ?? {}) as { palette?: string[]; logoRef?: string; typePreference?: string; imageryStyle?: string; explicitDonts?: string[]; source?: string };
    const palette = (Array.isArray(b.palette) ? b.palette : []).filter((h) => /^#[0-9a-fA-F]{6}$/.test(h)).slice(0, 6);
    await deps.carouselService.setBrand(business.id, { ...(palette.length ? { palette } : {}), ...(b.logoRef ? { logoRef: b.logoRef } : {}), ...(b.typePreference ? { typePreference: b.typePreference } : {}), ...(b.imageryStyle ? { imageryStyle: b.imageryStyle } : {}), explicitDonts: Array.isArray(b.explicitDonts) ? b.explicitDonts.slice(0, 8) : [], source: b.source ?? 'founder' });
    await reply.status(204).send();
  });

  // "Try a different angle" — concept-level revision → new version with a different communication logic.
  server.post('/v1/businesses/:id/carousel/:assetId/angle', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { assetId } = request.params as { assetId: string };
    const res = await deps.carouselService.tryDifferentAngle(business.id, assetId);
    if (res.status === 'insufficient') { await reply.status(200).send({ state: 'insufficient' }); return; }
    if (res.status === 'not_different') { await reply.status(200).send({ state: 'not_different' }); return; }
    const got = await deps.carouselService.getAsset(business.id, assetId);
    await reply.status(200).send({ state: 'ready', ...projectAsset(business.id, got!.version, got!.render) });
  });

  // Serve a rendered slide PNG.
  server.get('/v1/businesses/:id/carousel/render/:versionId/slide/:order.png', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { versionId, order } = request.params as { versionId: string; order: string };
    const png = await deps.carouselService.slidePng(business.id, versionId, parseInt(order, 10));
    if (!png) { await reply.status(404).send({ error: { code: 'SLIDE_NOT_FOUND', message: 'No such slide.' } }); return; }
    await reply.header('content-type', 'image/png').header('cache-control', 'no-store').status(200).send(png);
  });

  // Serve the export ZIP (real, publishable slides).
  server.get('/v1/businesses/:id/carousel/render/:versionId/export.zip', async (request: FastifyRequest, reply: FastifyReply) => {
    const { founderId, business } = await requireBusiness(request);
    const { versionId } = request.params as { versionId: string };
    const zip = await deps.carouselService.exportBytes(business.id, versionId);
    if (!zip) { await reply.status(409).send({ error: { code: 'EXPORT_NOT_READY', message: 'The carousel is not ready to export.' } }); return; }
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'asset_exported', surface: 'create', metadata: { versionId } });
    recordFounderEvent(deps.db, { accountId: founderId, businessId: business.id, eventType: 'strategy_to_asset_completed', surface: 'create', metadata: { versionId } });
    await reply.header('content-type', 'application/zip').header('content-disposition', 'attachment; filename="carousel.zip"').status(200).send(zip);
  });
}
