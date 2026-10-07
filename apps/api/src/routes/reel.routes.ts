import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { generateId } from '@bb/shared';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import type { ReelOpportunity, ReelJob } from '@bb/application';

interface AuthedUser { sub: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}
const ACCEPT_CONTAINERS = ['mp4', 'mov', 'quicktime', 'webm', 'm4v', 'matroska'];

// Founder-safe projection — NO edl/ffmpeg/observation/enum/snapshot internals leak.
function projectOpportunity(o: ReelOpportunity) {
  return {
    opportunityId: o.opportunityId, sufficiency: o.sufficiency, recommendation: o.founderLegibleRecommendation,
    why: o.whyFootageSupports, usingClips: new Set(o.selectedRanges.map((r) => r.sourceRefId)).size,
    excludedClips: o.excludedClips.length, missing: o.missingMaterial.map((m) => m.what),
    alternativeAvailable: o.alternativeAvailable, canCreate: o.sufficiency !== 'insufficient',
  };
}

/**
 * Slice 7 (Vertical 1) — "Use my clips". Presigned direct upload → async understanding → ONE strategy-specific
 * ReelOpportunity → accept → real MP4 → swap-opening revision → export. Additive; the frozen carousel path is
 * untouched. /v1 (JWT via the global preHandler); membership enforced per request.
 */
export function registerReelRoutes(server: FastifyInstance, deps: ServerDeps): void {
  if (!deps.reelService || !deps.reelObjectStore || !deps.reelRepo) return; // reel wiring optional
  const svc = deps.reelService; const store = deps.reelObjectStore; const repo = deps.reelRepo;

  // Raw-body parser for the streamed clip ingress (the dev/local upload PUT carries the video bytes as
  // application/octet-stream — in prod the browser PUTs straight to the R2 presigned URL instead).
  if (!server.hasContentTypeParser('application/octet-stream')) {
    server.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  }

  async function requireBusiness(request: FastifyRequest) {
    const founderId = founderOf(request);
    const { id } = request.params as { id: string };
    const business = await deps.businessService.getBusiness(id, founderId);
    if (!business) throw new NotFoundError('BUSINESS_NOT_FOUND', 'Business not found.');
    return { business };
  }

  // 1) presign N clip uploads (video bytes go DIRECT to object storage, never through our JSON)
  server.post('/v1/businesses/:id/reel/uploads', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const body = (request.body ?? {}) as { clips?: { filename?: string; contentType?: string }[] };
    const clips = (body.clips ?? []).slice(0, 20);
    if (clips.length < 1) throw new ValidationError('CLIPS_REQUIRED', 'At least one clip is required.');
    const uploadSetId = generateId();
    const uploads = [];
    for (const c of clips) {
      const sourceRefId = generateId();
      const objectKey = `reel/${business.id}/${uploadSetId}/${sourceRefId}`;
      const presigned = await store.presignPut(objectKey, c.contentType || 'video/mp4', 300 * 1024 * 1024);
      uploads.push({ sourceRefId, ...presigned, filename: c.filename ?? null });
    }
    return { uploadSetId, uploads };
  });

  // dev/local ingress: stream an octet-stream body → object store (R2 prod uses the presigned URL directly)
  server.put('/v1/businesses/:id/reel/blob/*', { bodyLimit: 300 * 1024 * 1024 }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const key = decodeURIComponent((request.params as Record<string, string>)['*'] ?? '');
    if (!key.startsWith(`reel/${business.id}/`)) throw new ValidationError('BAD_KEY', 'Key outside your business scope.');
    const buf = request.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new ValidationError('EMPTY_BODY', 'No bytes uploaded.');
    await store.put(key, buf, 'video/mp4');
    return reply.code(204).send();
  });

  // 2) register the uploaded clips (validated post-upload; client MIME untrusted → container checked at observe)
  server.post('/v1/businesses/:id/reel/uploads/:uploadSetId/register', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { uploadSetId } = request.params as { uploadSetId: string };
    const body = (request.body ?? {}) as { clips?: { sourceRefId: string; objectKey: string; filename?: string; sha256?: string; bytes?: number }[] };
    const clips = body.clips ?? [];
    let registered = 0;
    for (const c of clips) {
      const head = await store.head(c.objectKey);
      if (!head?.exists) continue;
      await repo.saveSource(business.id, { sourceRefId: c.sourceRefId, objectKey: c.objectKey, reuseRight: 'founder_uploaded', filename: c.filename, bytes: c.bytes ?? head.bytes, sha256: c.sha256, uploadSetId });
      registered += 1;
    }
    if (!registered) throw new ValidationError('NO_CLIPS', 'No uploaded clips found.');
    return { uploadSetId, registered };
  });

  const jobBase = (jobId: string) => ({ jobId, correlationId: jobId, traceId: jobId, founderId: null, enqueuedAt: new Date().toISOString() });

  // 3) process: observe → recommend. Enqueues to BullMQ and returns BEFORE the heavy vision work — a worker runs
  //    it and persists the stages (poll GET /jobs/:jobId). Absent queue (unit tests) ⇒ inline fallback.
  server.post('/v1/businesses/:id/reel/uploads/:uploadSetId/process', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { uploadSetId } = request.params as { uploadSetId: string };
    const job: ReelJob = { jobId: generateId(), businessId: business.id, uploadSetId, stage: 'uploaded', assetId: null, videoSetUnderstandingId: null, opportunityId: null, failureReason: null, updatedAt: new Date().toISOString() };
    await repo.saveJob(job);
    if (deps.reelQueue) {
      await deps.reelQueue.enqueueReelProcess({ jobType: 'REEL_PROCESS', businessId: business.id, uploadSetId, reelJobId: job.jobId, ...jobBase(job.jobId) });
      return { jobId: job.jobId, stage: 'processing' }; // async: founder polls the job / resumes from persisted state
    }
    const ob = await svc.observeUploadSet(business.id, uploadSetId, job);
    if (ob.status !== 'observed') { return { jobId: job.jobId, stage: 'failed', reason: ob.status }; }
    const rec = await svc.recommend(business.id, ob.understanding.videoSetUnderstandingId, undefined, await repo.getJob(business.id, job.jobId));
    const opp = rec.status === 'recommended' ? rec.opportunity : null;
    return { jobId: job.jobId, stage: opp ? 'opportunity_ready' : 'failed', opportunity: opp ? projectOpportunity(opp) : null };
  });

  server.get('/v1/businesses/:id/reel/jobs/:jobId', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { jobId } = request.params as { jobId: string };
    const job = await repo.getJob(business.id, jobId);
    if (!job) throw new NotFoundError('JOB_NOT_FOUND', 'Job not found.');
    // founder-safe resume state: derive the coarse phase + expose only the ids routing needs.
    return { jobId: job.jobId, stage: job.stage, opportunityId: job.opportunityId, assetId: job.assetId, failed: job.stage === 'failed' };
  });

  server.get('/v1/businesses/:id/reel/opportunities/:oppId', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { oppId } = request.params as { oppId: string };
    const o = await repo.getOpportunity(business.id, oppId);
    if (!o) throw new NotFoundError('OPPORTUNITY_NOT_FOUND', 'Opportunity not found.');
    return projectOpportunity(o);
  });

  server.post('/v1/businesses/:id/reel/opportunities/:oppId/alternative', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { oppId } = request.params as { oppId: string };
    const rec = await svc.alternative(business.id, oppId);
    if (rec.status !== 'recommended') throw new NotFoundError('OPPORTUNITY_NOT_FOUND', 'Opportunity not found.');
    return projectOpportunity(rec.opportunity);
  });

  // 4) accept → asset+version, then render (inline for V1)
  server.post('/v1/businesses/:id/reel/opportunities/:oppId/accept', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { oppId } = request.params as { oppId: string };
    const acc = await svc.accept(business.id, oppId);
    if (acc.status === 'insufficient') return { status: 'insufficient' };
    if (acc.status === 'fail_closed') return { status: 'blocked', reason: acc.reason };
    if (acc.status !== 'accepted') throw new NotFoundError('OPPORTUNITY_NOT_FOUND', 'Opportunity not found.');
    if (deps.reelQueue) {
      const rj = await enqueueRender(business.id, acc.version.versionId, acc.asset.assetId);
      return { status: 'created', assetId: acc.asset.assetId, ready: false, jobId: rj }; // render runs in the worker
    }
    const rr = await svc.render(business.id, acc.version.versionId);
    return { status: 'created', assetId: acc.asset.assetId, ready: rr.status === 'rendered' };
  });

  // enqueue a render job (render_queued → worker sets rendering → ready|failed)
  async function enqueueRender(businessId: string, versionId: string, assetId: string): Promise<string> {
    const rj: ReelJob = { jobId: generateId(), businessId, uploadSetId: versionId, stage: 'render_queued', assetId, videoSetUnderstandingId: null, opportunityId: null, failureReason: null, updatedAt: new Date().toISOString() };
    await repo.saveJob(rj);
    await deps.reelQueue!.enqueueReelRender({ jobType: 'REEL_RENDER', businessId, versionId, reelJobId: rj.jobId, ...jobBase(rj.jobId) });
    return rj.jobId;
  }

  server.get('/v1/businesses/:id/reel/assets/:assetId', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { assetId } = request.params as { assetId: string };
    const got = await svc.getAsset(business.id, assetId);
    if (!got) throw new NotFoundError('REEL_NOT_FOUND', 'Reel not found.');
    return {
      assetId, versionNumber: got.version.versionNumber, durationMs: got.version.timeline.totalDurationMs,
      clips: got.version.timeline.segments.length, ready: Boolean(got.render?.gateValid),
      mp4Url: got.render ? `/v1/businesses/${business.id}/reel/versions/${got.version.versionId}/reel.mp4` : null,
      posterUrl: got.render ? `/v1/businesses/${business.id}/reel/versions/${got.version.versionId}/poster.jpg` : null,
      canSwapOpening: got.version.timeline.segments.length > 1,
    };
  });

  server.post('/v1/businesses/:id/reel/assets/:assetId/swap-opening', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { assetId } = request.params as { assetId: string };
    const rev = await svc.reviseOpening(business.id, assetId, null, { deferRender: Boolean(deps.reelQueue) });
    if (rev.status === 'no_alternative') return { status: 'no_alternative' };
    if (rev.status !== 'revised') throw new NotFoundError('REEL_NOT_FOUND', 'Reel not found.');
    if (deps.reelQueue) {
      const rj = await enqueueRender(business.id, rev.version.versionId, assetId);
      return { status: 'revised', versionNumber: rev.version.versionNumber, ready: false, jobId: rj };
    }
    return { status: 'revised', versionNumber: rev.version.versionNumber };
  });

  async function streamObject(request: FastifyRequest, reply: FastifyReply, kind: 'mp4' | 'poster') {
    await requireBusiness(request); // enforce membership
    const { versionId } = request.params as { versionId: string };
    const rv = await repo.getRender(versionId);
    if (!rv) throw new NotFoundError('RENDER_NOT_FOUND', 'Not ready.');
    const bytes = await store.getToBuffer(kind === 'mp4' ? rv.mp4Key : rv.posterKey);
    if (!bytes) throw new NotFoundError('RENDER_NOT_FOUND', 'Not ready.');
    return reply.header('content-type', kind === 'mp4' ? 'video/mp4' : 'image/jpeg').send(bytes);
  }
  server.get('/v1/businesses/:id/reel/versions/:versionId/reel.mp4', async (rq: FastifyRequest, rp: FastifyReply) => streamObject(rq, rp, 'mp4'));
  server.get('/v1/businesses/:id/reel/versions/:versionId/poster.jpg', async (rq: FastifyRequest, rp: FastifyReply) => streamObject(rq, rp, 'poster'));
  server.get('/v1/businesses/:id/reel/versions/:versionId/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const business = (await requireBusiness(request)).business;
    const { versionId } = request.params as { versionId: string };
    const bytes = await svc.exportBytes(business.id, versionId);
    if (!bytes) throw new NotFoundError('EXPORT_NOT_READY', 'Not ready.');
    return reply.header('content-type', 'video/mp4').header('content-disposition', 'attachment; filename="reel.mp4"').send(bytes);
  });
  void ACCEPT_CONTAINERS;
}
