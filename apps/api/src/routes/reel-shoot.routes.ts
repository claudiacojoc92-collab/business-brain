import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ServerDeps } from '../server';
import { generateId } from '@bb/shared';
import { AuthenticationError, NotFoundError, ValidationError } from '@bb/shared';
import type { ReelConcept, ShootingPlanVersion, FulfillmentReport, ExecutionConstraint, ReelJob } from '@bb/application';

interface AuthedUser { sub: string }
function founderOf(request: FastifyRequest): string {
  const user = (request as unknown as { user?: AuthedUser }).user;
  if (!user?.sub) throw new AuthenticationError('MISSING_AUTH_TOKEN', 'Authentication required.');
  return user.sub;
}
const tok = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []));
const jaccard = (a: string, b: string): number => { const A = tok(a), B = tok(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n); };

// Founder-safe projections — NEVER expose conceptSeed/roleHints/motionIntensity/editingEnergy/matchTokens/scores/EDL/enums/DB ids beyond routing.
function projectPlanShots(plan: ShootingPlanVersion) {
  return plan.shotRequests.filter((s) => s.founderFilms).map((s, i) => ({ n: i + 1, instruction: s.founderProse, ...(s.exactSpokenLine ? { sayThis: s.exactSpokenLine } : {}) }));
}
function projectConcept(concept: ReelConcept, plan: ShootingPlanVersion, anotherAngleAvailable: boolean) {
  return {
    conceptId: concept.reelConceptId, planId: plan.versionId, idea: concept.communicationJob, whyNow: concept.strategicReason,
    accomplishes: concept.narrativeArc, effort: plan.estimatedEffort, guidance: plan.generalGuidance, shots: projectPlanShots(plan), anotherAngleAvailable,
  };
}
function projectFulfillment(report: FulfillmentReport | null) {
  if (!report) return { status: 'processing' as const, missing: null };
  return { status: report.sufficiency, missing: report.smallestMissing ? report.smallestMissing.founderAsk : null, canCreate: report.sufficiency !== 'insufficient' };
}

/**
 * Slice 7 (Vertical 2) — "Tell me what to film". Additive; upstream of the FROZEN V1 reel engine, into which it
 * converges via a single conceptSeed. Reuses the frozen reel object-store/upload path + BullMQ queues (REEL_PROCESS,
 * REEL_RENDER) + frozen asset/playback/revision/export endpoints. /v1 (JWT via global preHandler); membership enforced.
 */
export function registerReelShootRoutes(server: FastifyInstance, deps: ServerDeps): void {
  if (!deps.reelShootService || !deps.reelShootRepo || !deps.reelObjectStore || !deps.reelRepo) return; // optional wiring
  const shoot = deps.reelShootService; const shootRepo = deps.reelShootRepo; const store = deps.reelObjectStore; const repo = deps.reelRepo;
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
  const uploadSetOf = (planId: string) => `shoot-${planId}`;   // one deterministic upload set per plan
  const jobBase = (jobId: string) => ({ jobId, correlationId: jobId, traceId: jobId, founderId: null, enqueuedAt: new Date().toISOString() });

  // 1) propose the ONE reel worth making next + its shooting plan
  server.post('/v1/businesses/:id/reel/concepts', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const body = (request.body ?? {}) as { uiLanguage?: string };
    const r = await shoot.proposeConcept(business.id, { ...(body.uiLanguage ? { uiLanguage: body.uiLanguage } : {}) });
    if (r.status !== 'proposed') throw new NotFoundError('NO_STRATEGY', 'No current strategy to plan from.');
    return projectConcept(r.concept, r.plan, false);
  });

  // resume/deep-link by plan — founder-safe: the plan, the current fulfillment state, and (once created) the asset id
  server.get('/v1/businesses/:id/reel/plans/:planId', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { planId } = request.params as { planId: string };
    const plan = await shootRepo.getPlanVersion(business.id, planId);
    if (!plan) throw new NotFoundError('PLAN_NOT_FOUND', 'Plan not found.');
    const concept = await shootRepo.getConcept(business.id, plan.reelConceptId);
    if (!concept) throw new NotFoundError('CONCEPT_NOT_FOUND', 'Concept not found.');
    const report = await shootRepo.getFulfillmentReport(business.id, planId);
    const ctx = await shootRepo.getShootContextByPlan(business.id, planId);
    // fulfillment is null until the founder has uploaded + processed — the page then shows the PLAN, not "checking…"
    return { ...projectConcept(concept, plan, false), fulfillment: report ? projectFulfillment(report) : null, assetId: ctx?.assetId ?? null };
  });

  // only when a materially different, strategy-valid angle exists — never a slot-machine variant
  server.post('/v1/businesses/:id/reel/concepts/:conceptId/another-angle', async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const { conceptId } = request.params as { conceptId: string };
    const prior = await shootRepo.getConcept(business.id, conceptId);
    if (!prior) throw new NotFoundError('CONCEPT_NOT_FOUND', 'Concept not found.');
    const r = await shoot.proposeConcept(business.id, { avoidConcept: prior.communicationJob });
    if (r.status !== 'proposed') throw new NotFoundError('NO_STRATEGY', 'No current strategy to plan from.');
    if (jaccard(r.concept.communicationJob, prior.communicationJob) > 0.5) {
      return reply.code(409).send({ error: { code: 'NO_OTHER_ANGLE', message: 'There isn’t a genuinely different reel to make right now.' } });
    }
    return projectConcept(r.concept, r.plan, false);
  });

  // execution constraint → immutable plan N+1 (the founder just sees the plan update)
  server.post('/v1/businesses/:id/reel/plans/:planId/constrain', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { planId } = request.params as { planId: string };
    const body = (request.body ?? {}) as { constraint?: string; detail?: string; uiLanguage?: string };
    const KINDS: ExecutionConstraint['kind'][] = ['no_talking_head', 'no_clients', 'location_only', 'make_it_easier', 'no_product_today', 'other'];
    const kind = KINDS.includes(body.constraint as ExecutionConstraint['kind']) ? (body.constraint as ExecutionConstraint['kind']) : 'other';
    const r = await shoot.constrain(business.id, planId, { kind, ...(body.detail ? { detail: body.detail } : {}) }, body.uiLanguage);
    if (r.status !== 'proposed') throw new NotFoundError('PLAN_NOT_FOUND', 'Plan not found.');
    return projectConcept(r.concept, r.plan, false);
  });

  // 2) uploads — reuse the frozen reel object-store path, scoped to this plan's upload set
  server.post('/v1/businesses/:id/reel/plans/:planId/uploads', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { planId } = request.params as { planId: string };
    const body = (request.body ?? {}) as { clips?: { filename?: string; contentType?: string }[] };
    const clips = (body.clips ?? []).slice(0, 20);
    if (clips.length < 1) throw new ValidationError('CLIPS_REQUIRED', 'At least one clip is required.');
    const uploadSetId = uploadSetOf(planId);
    const uploads = [];
    for (const c of clips) {
      const sourceRefId = generateId();
      const objectKey = `reel/${business.id}/${uploadSetId}/${sourceRefId}`;
      const presigned = await store.presignPut(objectKey, c.contentType || 'video/mp4', 300 * 1024 * 1024);
      uploads.push({ sourceRefId, ...presigned, filename: c.filename ?? null });
    }
    return { uploadSetId, uploads };
  });
  server.put('/v1/businesses/:id/reel/plans/:planId/blob/*', { bodyLimit: 300 * 1024 * 1024 }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { business } = await requireBusiness(request);
    const key = decodeURIComponent((request.params as Record<string, string>)['*'] ?? '');
    if (!key.startsWith(`reel/${business.id}/`)) throw new ValidationError('BAD_KEY', 'Key outside your business scope.');
    const buf = request.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) throw new ValidationError('EMPTY_BODY', 'No bytes uploaded.');
    await store.put(key, buf, 'video/mp4');
    return reply.code(204).send();
  });
  server.post('/v1/businesses/:id/reel/plans/:planId/register', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { planId } = request.params as { planId: string };
    const body = (request.body ?? {}) as { clips?: { sourceRefId: string; objectKey: string; filename?: string; bytes?: number }[] };
    let registered = 0;
    for (const c of body.clips ?? []) {
      const head = await store.head(c.objectKey);
      if (!head?.exists) continue;
      await repo.saveSource(business.id, { sourceRefId: c.sourceRefId, objectKey: c.objectKey, reuseRight: 'founder_uploaded', filename: c.filename, bytes: c.bytes ?? head.bytes, uploadSetId: uploadSetOf(planId) });
      registered += 1;
    }
    if (!registered) throw new ValidationError('NO_CLIPS', 'No uploaded clips found.');
    return { registered };
  });

  // 3) process — ENQUEUE observe+match (worker), return before the vision work. reelJobId = planId ⇒ worker runs V2.
  const enqueueProcess = async (businessId: string, planId: string) => {
    if (deps.reelQueue) { await deps.reelQueue.enqueueReelProcess({ jobType: 'REEL_PROCESS', businessId, uploadSetId: uploadSetOf(planId), reelJobId: planId, ...jobBase(planId) }); return true; }
    await shoot.matchUploads(businessId, planId, uploadSetOf(planId)); return false;   // inline fallback (no queue)
  };
  server.post('/v1/businesses/:id/reel/plans/:planId/process', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { planId } = request.params as { planId: string };
    await enqueueProcess(business.id, planId);
    return { status: 'processing' };
  });
  server.post('/v1/businesses/:id/reel/plans/:planId/add-shot', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { planId } = request.params as { planId: string };
    await enqueueProcess(business.id, planId);   // the new clip was uploaded+registered; re-run matching
    return { status: 'processing' };
  });
  server.get('/v1/businesses/:id/reel/plans/:planId/fulfillment', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { planId } = request.params as { planId: string };
    return projectFulfillment(await shootRepo.getFulfillmentReport(business.id, planId));
  });

  // 4) create-reel — seeded frozen recommend()+accept() (sync, like V1), then ENQUEUE the frozen REEL_RENDER
  server.post('/v1/businesses/:id/reel/plans/:planId/create-reel', async (request: FastifyRequest) => {
    const { business } = await requireBusiness(request);
    const { planId } = request.params as { planId: string };
    const conv = await shoot.converge(business.id, planId, { deferRender: Boolean(deps.reelQueue) });
    if (conv.status === 'insufficient') return { status: 'insufficient' };
    if (conv.status === 'not_found') throw new NotFoundError('PLAN_NOT_FOUND', 'Plan not found.');
    if (conv.status !== 'created') return { status: 'blocked', reason: conv.reason };
    if (deps.reelQueue) {
      const asset = await repo.getAsset(business.id, conv.assetId);
      const versionId = asset?.currentVersionId ?? '';
      const rj: ReelJob = { jobId: generateId(), businessId: business.id, uploadSetId: versionId, stage: 'render_queued', assetId: conv.assetId, videoSetUnderstandingId: null, opportunityId: null, failureReason: null, updatedAt: new Date().toISOString() };
      await repo.saveJob(rj);
      await deps.reelQueue.enqueueReelRender({ jobType: 'REEL_RENDER', businessId: business.id, versionId, reelJobId: rj.jobId, ...jobBase(rj.jobId) });
      return { status: 'created', assetId: conv.assetId, ready: false };   // frozen worker renders; poll the frozen asset endpoint
    }
    return { status: 'created', assetId: conv.assetId, ready: true };
  });
}
