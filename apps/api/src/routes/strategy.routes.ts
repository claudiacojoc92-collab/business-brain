import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createKyselyClient } from '@bb/infrastructure';
import { PgIdentityRepository } from '../session/pg-identity.repository';
import { readCookie, SESSION_COOKIE } from '../session/cookie';
import { resolveSession } from '../session/session.service';
import { PgUnderstandingRepository } from '../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../business-model/pg-market-review.repository';
import { PgStrategicSessionRepository } from '../business-model/pg-strategic-session.repository';
import { PgStrategicResponseRepository } from '../business-model/pg-strategic-response.repository';
import { PgStrategicDecisionRepository } from '../business-model/pg-strategic-decision.repository';
import { PgStrategicCommitmentRepository } from '../business-model/pg-strategic-commitment.repository';
import { PgStrategicPlanRepository } from '../business-model/pg-strategic-plan.repository';
import { PgStrategicPlanReviewRepository } from '../business-model/pg-strategic-plan-review.repository';
import { PgStrategicLearningRepository } from '../business-model/pg-strategic-learning.repository';
import { PgFounderStrategicContextRepository } from '../business-model/pg-founder-strategic-context.repository';
import { assertDecisionAdmissible, toDecisionView, DecisionValidationError, type DecisionInput } from '../business-model/strategic-decision';
import { assertCommitmentAdmissible, toCommitmentView, linkedDecisionStatus, CommitmentValidationError, type CommitmentInput, type ResourceEnvelopeItem, type AcceptedCost } from '../business-model/strategic-commitment';
import { assertPlanAdmissible, toPlanView, linkedCommitmentStatus, PlanValidationError, type PlanInput, type Milestone, type Assumption, type Dependency } from '../business-model/strategic-plan';
import { assertReviewAdmissible, toReviewView, linkedCommitmentStatusForReview, ReviewValidationError, type PlanReviewInput, type ReviewObservation, type EvidenceReference, type ContextChange } from '../business-model/strategic-plan-review';
import { assertLearningAdmissible, toLearningView, LearningValidationError, deriveLifecycleStatus, type LearningInput, type ObservationSource, type LearningLifecycleAction } from '../business-model/strategic-learning';
import { LearningLifecycleError, type LifecycleTransitionInput } from '../business-model/strategic-learning-lifecycle';
import { PgLearningPromotionRepository } from '../business-model/pg-learning-promotion.repository';
import { toPromotionView, PromotionValidationError, type PromotionInput, type PromotionAction, type PromotionTarget } from '../business-model/strategic-learning-promotion';
import { composeEffectiveBusinessUnderstanding, composeEffectiveFounderStrategicContext, toPromotedLearningItem, type EffectiveContextItem } from '../business-model/effective-context';
import { PgContextSnapshotRepository } from '../business-model/pg-context-snapshot.repository';
import { captureEffectiveContext } from '../business-model/context-snapshot.capture';
import { toSnapshotView } from '../business-model/context-snapshot';
import { PgExecutionReportRepository } from '../business-model/pg-execution-report.repository';
import { toExecutionReportView, toEffectiveExecutionView, effectiveFromHead, chainHead as executionChainHead, ExecutionReportError, type ExecutionReportInput, type ReportKind, type ExecutionSubjectType } from '../business-model/execution-report';
import { AnthropicStrategyModel } from '../business-model/anthropic-strategy.model';
import { strategyModelConfig } from '../business-model/model-config';
import { startStrategicSessionWorker } from '../business-model/strategic-session.worker';
import { classifyStrategicJob } from '../business-model/strategy-classifier';
import { toSessionView, annotateReferenceHistory, boundaryResponse, STRATEGIC_RESPONSE_TYPES, type StrategicResponseType } from '../business-model/strategy';

/**
 * Wave 4 — Founder Strategy API (first vertical slice). One bounded job (PRIORITY_DECISION) reasoned from the
 * stable Waves 1–3 outputs via a durable session lifecycle. Cookie-only session. Out-of-scope questions get a
 * founder-safe boundary response (no durable job). Raw model output is never exposed.
 */
export function registerStrategyRoutes(server: FastifyInstance): void {
  const db = createKyselyClient(process.env['DATABASE_URL'] ?? '');
  const identity = new PgIdentityRepository(db);
  const sessionRepo = new PgStrategicSessionRepository(db);
  const responseRepo = new PgStrategicResponseRepository(db);
  const decisionRepo = new PgStrategicDecisionRepository(db);
  const commitmentRepo = new PgStrategicCommitmentRepository(db);
  const planRepo = new PgStrategicPlanRepository(db);
  const planReviewRepo = new PgStrategicPlanReviewRepository(db);
  const learningRepo = new PgStrategicLearningRepository(db);
  const promotionRepo = new PgLearningPromotionRepository(db);
  const snapshotRepo = new PgContextSnapshotRepository(db);
  const executionRepo = new PgExecutionReportRepository(db);
  const assembler = {
    understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db),
    entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db),
    findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db),
    strategicContext: new PgFounderStrategicContextRepository(db),
  };
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  const LEASE_MS = 5 * 60 * 1000;

  async function sessionFounder(request: FastifyRequest): Promise<string | null> {
    const sid = readCookie(request.headers['cookie'], SESSION_COOKIE);
    return sid ? resolveSession(sid, identity, new Date()) : null;
  }

  // Durable strategy worker (off under test; tests drive processSession). DB is authoritative.
  if (process.env['NODE_ENV'] !== 'test') {
    startStrategicSessionWorker({ sessionRepo, assembler, model: new AnthropicStrategyModel(apiKey), leaseMs: LEASE_MS, now: () => new Date(), snapshotRepo });
  }

  // POST /strategy/sessions — classify; out-of-scope → 200 boundary (no job); in-scope → create (idempotent) 202.
  server.post('/strategy/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const question = String((request.body as Record<string, unknown> | undefined)?.['question'] ?? '').trim();
    if (!question) { await reply.code(400).send({ error: 'a question is required' }); return; }
    const cls = classifyStrategicJob(question);
    if (cls.job === 'OUT_OF_SCOPE') { await reply.code(200).send({ outOfScope: true, boundary: boundaryResponse() }); return; }
    // ADR-014 remediation — MANDATORY Consumption Gate: every new in-scope recommendation generation REQUIRES a
    // founder-owned immutable snapshot. Missing → 400 CONTEXT_SNAPSHOT_REQUIRED; foreign/nonexistent → 404. There is no
    // live-context fallback. The client cannot supply snapshot content, hashes, or provenance — the server resolves them.
    const rawSnap = String((request.body as Record<string, unknown> | undefined)?.['contextSnapshotId'] ?? '').trim();
    if (!rawSnap) { await reply.code(400).send({ error: { code: 'CONTEXT_SNAPSHOT_REQUIRED', message: 'Create a context snapshot and generate from it.' }, reason: 'CONTEXT_SNAPSHOT_REQUIRED' }); return; }
    if (!(await snapshotRepo.getById(founderId, rawSnap))) { await reply.code(404).send({ error: { code: 'CONTEXT_SNAPSHOT_NOT_FOUND', message: 'context snapshot not found' }, reason: 'CONTEXT_SNAPSHOT_NOT_FOUND' }); return; }
    const contextSnapshotId = rawSnap;
    const cfg = strategyModelConfig();
    const s = await sessionRepo.create(founderId, { strategicJob: cls.job, subtype: cls.subtype, questionText: question, modelId: cfg.modelId, promptVersion: cfg.promptVersion, schemaVersion: cfg.schemaVersion, contextSnapshotId }, new Date());
    await reply.code(202).send(toSessionView(s));
  });

  server.get('/strategy/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ sessions: (await sessionRepo.listByFounder(founderId)).map(toSessionView) });
  });

  server.get('/strategy/sessions/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const s = await sessionRepo.getById(founderId, (request.params as { id: string }).id);
    if (!s) { await reply.code(404).send({ error: 'not found' }); return; }
    const effective = await responseRepo.effectiveBySession(founderId, s.id);
    // Read-time historical reference status: compare each grounded FSC reference to the founder's CURRENT effective
    // context (the persisted recommendation is untouched; historical VALIDATION already used the stored manifest).
    const effectiveByLogical = new Map<string, number>((await assembler.strategicContext.listActive(founderId)).map((i) => [i.logicalItemId, i.version]));
    const view = annotateReferenceHistory(toSessionView(s), effectiveByLogical);
    await reply.send({ ...view, effectiveResponse: effective });
  });

  server.post('/strategy/sessions/:id/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    // ADR-014 remediation: a legacy (contract v0, null-snapshot) session cannot regenerate live. It must not be re-queued;
    // the founder must create a new snapshot and generate anew. Governed (v1) sessions retry against their bound snapshot.
    const existing = await sessionRepo.getById(founderId, (request.params as { id: string }).id);
    if (existing && (existing.generationContractVersion < 1 || !existing.contextSnapshotId)) {
      await reply.code(400).send({ error: { code: 'CONTEXT_SNAPSHOT_REQUIRED', message: 'This is a legacy session with no snapshot — create a new snapshot and generate a new recommendation.' }, reason: 'CONTEXT_SNAPSHOT_REQUIRED' }); return;
    }
    const s = await sessionRepo.retry(founderId, (request.params as { id: string }).id, new Date());
    if (!s) { await reply.code(409).send({ error: 'this result can’t be retried' }); return; }
    await reply.code(202).send(toSessionView(s));
  });

  // Append-only founder response to a recommendation (ACCEPT/REJECT/QUALIFY/NEEDS_MORE_EVIDENCE/NOT_RELEVANT_NOW).
  server.post('/strategy/sessions/:id/responses', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const id = (request.params as { id: string }).id;
    const s = await sessionRepo.getById(founderId, id);
    if (!s) { await reply.code(404).send({ error: 'not found' }); return; }
    const b = (request.body ?? {}) as Record<string, unknown>;
    const responseType = String(b['responseType'] ?? '');
    if (!STRATEGIC_RESPONSE_TYPES.has(responseType)) { await reply.code(400).send({ error: 'a valid response is required' }); return; }
    const qualification = b['qualification'] ? String(b['qualification']).slice(0, 2000) : null;
    if (responseType === 'QUALIFY' && !qualification?.trim()) { await reply.code(400).send({ error: 'tell me what you’d qualify' }); return; }
    const rec = await responseRepo.record({ founderId, sessionId: id, responseType: responseType as StrategicResponseType, qualification, now: new Date() });
    await reply.send({ response: rec });
  });

  server.get('/strategy/sessions/:id/responses', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const id = (request.params as { id: string }).id;
    const owned = await sessionRepo.getById(founderId, id);
    if (!owned) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ responses: await responseRepo.listBySession(founderId, id) });
  });

  // ── Strategic Decision Records (founder-explicit; append-only; NOT recommendation feedback) ──────────────
  // Parse the founder's explicit decision input from the request body (nothing here is inferred by the model).
  const decisionInput = (b: Record<string, unknown>): DecisionInput => {
    const co = (b['chosenOption'] ?? {}) as Record<string, unknown>;
    const alts = Array.isArray(b['alternativesConsidered']) ? (b['alternativesConsidered'] as Array<Record<string, unknown>>) : [];
    return {
      chosenOption: { label: String(co['label'] ?? ''), source: String(co['source'] ?? '') as DecisionInput['chosenOption']['source'], statement: co['statement'] != null ? String(co['statement']) : null },
      decisionStatement: String(b['decisionStatement'] ?? ''),
      rationale: b['rationale'] != null ? String(b['rationale']) : null,
      alternativesConsidered: alts.map((a) => ({ label: String(a['label'] ?? ''), source: String(a['source'] ?? 'FOUNDER_AUTHORED') as DecisionInput['alternativesConsidered'][number]['source'], disposition: String(a['disposition'] ?? '') as DecisionInput['alternativesConsidered'][number]['disposition'], reason: a['reason'] != null ? String(a['reason']) : null })),
      tradeOffsAccepted: Array.isArray(b['tradeOffsAccepted']) ? (b['tradeOffsAccepted'] as unknown[]).map((t) => String(t)) : [],
      acknowledgedInsufficientEvidence: b['acknowledgedInsufficientEvidence'] === true,
      scope: b['scope'] != null ? (String(b['scope']) as DecisionInput['scope']) : undefined,
      reversibility: b['reversibility'] != null ? (String(b['reversibility']) as DecisionInput['reversibility']) : undefined,
      reviewAt: b['reviewAt'] != null ? String(b['reviewAt']) : null,
      reviewTrigger: b['reviewTrigger'] != null ? String(b['reviewTrigger']) : null,
      idempotencyKey: String(b['idempotencyKey'] ?? ''),
    };
  };

  // Create ONE Strategic Decision Record from an explicit founder action on a terminal session (idempotent).
  server.post('/strategy/sessions/:sessionId/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = await sessionRepo.getById(founderId, sessionId); // founder-owned only → cross-founder = 404
    if (!session) { await reply.code(404).send({ error: 'not found' }); return; }
    const input = decisionInput((request.body ?? {}) as Record<string, unknown>);
    try { assertDecisionAdmissible(session, input); }
    catch (e) { if (e instanceof DecisionValidationError) { await reply.code(400).send({ error: e.message, reason: e.reason }); return; } throw e; }
    const decision = await decisionRepo.create(founderId, session, input, new Date());
    await reply.code(201).send({ decision: toDecisionView(decision) });
  });

  server.get('/strategy/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ decisions: (await decisionRepo.listByFounder(founderId)).map(toDecisionView) });
  });

  // A single logical decision: its full append-only revision history + the (immutable) linked recommendation.
  server.get('/strategy/decisions/:logicalDecisionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalDecisionId = (request.params as { logicalDecisionId: string }).logicalDecisionId;
    const history = await decisionRepo.getHistory(founderId, logicalDecisionId);
    if (!history.length) { await reply.code(404).send({ error: 'not found' }); return; }
    const effective = history[history.length - 1]!;
    // resolve the linked session for stable historical display (still founder-owned; may be null if never linked)
    const session = effective.recommendationSessionId ? await sessionRepo.getById(founderId, effective.recommendationSessionId) : null;
    await reply.send({ decision: toDecisionView(effective), history: history.map(toDecisionView), linkedSession: session ? toSessionView(session) : null });
  });

  // Append-only lifecycle. supersede = a new choice; reverse/retire = terminal.
  server.post('/strategy/decisions/:logicalDecisionId/supersede', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalDecisionId = (request.params as { logicalDecisionId: string }).logicalDecisionId;
    const b = (request.body ?? {}) as Record<string, unknown>;
    const sessionId = String(b['sessionId'] ?? '');
    const session = await sessionRepo.getById(founderId, sessionId);
    if (!session) { await reply.code(404).send({ error: 'not found' }); return; }
    const input = decisionInput(b);
    try { assertDecisionAdmissible(session, input); }
    catch (e) { if (e instanceof DecisionValidationError) { await reply.code(400).send({ error: e.message, reason: e.reason }); return; } throw e; }
    const decision = await decisionRepo.supersede(founderId, logicalDecisionId, session, input, new Date());
    if (!decision) { await reply.code(409).send({ error: 'this decision can’t be superseded' }); return; }
    await reply.code(201).send({ decision: toDecisionView(decision) });
  });

  for (const action of ['reverse', 'retire'] as const) {
    server.post(`/strategy/decisions/:logicalDecisionId/${action}`, async (request: FastifyRequest, reply: FastifyReply) => {
      const founderId = await sessionFounder(request);
      if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
      const logicalDecisionId = (request.params as { logicalDecisionId: string }).logicalDecisionId;
      const b = (request.body ?? {}) as Record<string, unknown>;
      const note = b['note'] != null ? String(b['note']) : null;
      const key = String(b['idempotencyKey'] ?? `${action}:${logicalDecisionId}`);
      const decision = action === 'reverse'
        ? await decisionRepo.reverse(founderId, logicalDecisionId, note, key, new Date())
        : await decisionRepo.retire(founderId, logicalDecisionId, note, key, new Date());
      if (!decision) { await reply.code(409).send({ error: `this decision can’t be ${action}d` }); return; }
      await reply.code(201).send({ decision: toDecisionView(decision) });
    });
  }

  // ── Strategic Commitment Records (founder-explicit; append-only; a decision does NOT auto-become a commitment) ──
  const commitmentInput = (b: Record<string, unknown>): CommitmentInput => {
    const arr = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).map((x) => String(x)) : []);
    const costs = Array.isArray(b['acceptedCosts']) ? (b['acceptedCosts'] as Array<Record<string, unknown>>) : [];
    const envelope = Array.isArray(b['resourceEnvelope']) ? (b['resourceEnvelope'] as Array<Record<string, unknown>>) : [];
    return {
      statement: String(b['statement'] ?? ''), scope: String(b['scope'] ?? '') as CommitmentInput['scope'], exclusivity: String(b['exclusivity'] ?? '') as CommitmentInput['exclusivity'],
      governedBehavior: arr('governedBehavior'), unknownCosts: arr('unknownCosts'), exitConditions: arr('exitConditions'), reconsiderationConditions: arr('reconsiderationConditions'),
      resourceEnvelope: envelope.map((r): ResourceEnvelopeItem => ({ kind: String(r['kind'] ?? '') as ResourceEnvelopeItem['kind'], availability: String(r['availability'] ?? 'UNKNOWN') as ResourceEnvelopeItem['availability'], boundaryType: String(r['boundaryType'] ?? 'MAXIMUM') as ResourceEnvelopeItem['boundaryType'], amount: r['amount'] != null ? String(r['amount']) : null })),
      acceptedCosts: costs.map((c): AcceptedCost => ({ statement: String(c['statement'] ?? ''), source: String(c['source'] ?? 'FOUNDER_CONFIRMED') as AcceptedCost['source'], confirmed: c['confirmed'] === true })),
      acknowledgedInsufficientEvidence: b['acknowledgedInsufficientEvidence'] === true,
      startsAt: b['startsAt'] != null ? String(b['startsAt']) : null, reviewAt: b['reviewAt'] != null ? String(b['reviewAt']) : null,
      reviewTrigger: b['reviewTrigger'] != null ? String(b['reviewTrigger']) : null, expiresAt: b['expiresAt'] != null ? String(b['expiresAt']) : null,
      idempotencyKey: String(b['idempotencyKey'] ?? ''),
    };
  };

  // Create ONE Strategic Commitment from an explicit founder action on an EFFECTIVE, non-terminal decision (idempotent).
  server.post('/strategy/decisions/:logicalDecisionId/commitments', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalDecisionId = (request.params as { logicalDecisionId: string }).logicalDecisionId;
    const decision = await decisionRepo.getEffective(founderId, logicalDecisionId); // founder-owned effective revision only
    if (!decision) { await reply.code(404).send({ error: 'not found' }); return; }
    const input = commitmentInput((request.body ?? {}) as Record<string, unknown>);
    try { assertCommitmentAdmissible(decision, input); }
    catch (e) { if (e instanceof CommitmentValidationError) { await reply.code(400).send({ error: e.message, reason: e.reason }); return; } throw e; }
    const commitment = await commitmentRepo.create(founderId, decision, input, new Date());
    await reply.code(201).send({ commitment: toCommitmentView(commitment, 'CURRENT') });
  });

  server.get('/strategy/commitments', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ commitments: (await commitmentRepo.listByFounder(founderId, new Date())).map((c) => toCommitmentView(c)) });
  });

  server.get('/strategy/commitments/:logicalCommitmentId', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalCommitmentId = (request.params as { logicalCommitmentId: string }).logicalCommitmentId;
    const history = await commitmentRepo.getHistory(founderId, logicalCommitmentId, new Date());
    if (!history.length) { await reply.code(404).send({ error: 'not found' }); return; }
    const effective = history[history.length - 1]!;
    // neutral notice if the linked decision changed since (never auto-terminates the commitment)
    const effDecision = await decisionRepo.getEffective(founderId, effective.decisionLogicalId);
    const linked = linkedDecisionStatus(effDecision, effective.decisionRecordId);
    await reply.send({ commitment: toCommitmentView(effective, linked), history: history.map((c) => toCommitmentView(c)) });
  });

  server.post('/strategy/commitments/:logicalCommitmentId/supersede', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalCommitmentId = (request.params as { logicalCommitmentId: string }).logicalCommitmentId;
    const b = (request.body ?? {}) as Record<string, unknown>;
    const decision = await decisionRepo.getEffective(founderId, String(b['logicalDecisionId'] ?? ''));
    if (!decision) { await reply.code(404).send({ error: 'not found' }); return; }
    const input = commitmentInput(b);
    try { assertCommitmentAdmissible(decision, input); }
    catch (e) { if (e instanceof CommitmentValidationError) { await reply.code(400).send({ error: e.message, reason: e.reason }); return; } throw e; }
    const commitment = await commitmentRepo.supersede(founderId, logicalCommitmentId, decision, input, new Date());
    if (!commitment) { await reply.code(409).send({ error: 'this commitment can’t be superseded' }); return; }
    await reply.code(201).send({ commitment: toCommitmentView(commitment, 'CURRENT') });
  });

  for (const action of ['release', 'retire'] as const) {
    server.post(`/strategy/commitments/:logicalCommitmentId/${action}`, async (request: FastifyRequest, reply: FastifyReply) => {
      const founderId = await sessionFounder(request);
      if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
      const logicalCommitmentId = (request.params as { logicalCommitmentId: string }).logicalCommitmentId;
      const b = (request.body ?? {}) as Record<string, unknown>;
      const note = b['note'] != null ? String(b['note']) : null;
      const key = String(b['idempotencyKey'] ?? `${action}:${logicalCommitmentId}`);
      const commitment = action === 'release'
        ? await commitmentRepo.release(founderId, logicalCommitmentId, note, key, new Date())
        : await commitmentRepo.retire(founderId, logicalCommitmentId, note, key, new Date());
      if (!commitment) { await reply.code(409).send({ error: `this commitment can’t be ${action}d` }); return; }
      await reply.code(201).send({ commitment: toCommitmentView(commitment) });
    });
  }

  // ── Strategic Plan Records (founder-explicit; append-only; a commitment does NOT auto-become a plan; no model drafts) ──
  const planInput = (b: Record<string, unknown>): PlanInput => {
    const arr = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).map((x) => String(x)) : []);
    const ms = Array.isArray(b['milestones']) ? (b['milestones'] as Array<Record<string, unknown>>) : [];
    const as = Array.isArray(b['assumptions']) ? (b['assumptions'] as Array<Record<string, unknown>>) : [];
    const ds = Array.isArray(b['dependencies']) ? (b['dependencies'] as Array<Record<string, unknown>>) : [];
    return {
      title: String(b['title'] ?? ''), strategicIntent: String(b['strategicIntent'] ?? ''), scope: String(b['scope'] ?? '') as PlanInput['scope'],
      planningHorizon: b['planningHorizon'] != null ? String(b['planningHorizon']) : null,
      milestones: ms.map((m): Omit<Milestone, 'id' | 'statusAtPlanning'> & { id?: string } => ({ id: m['id'] != null ? String(m['id']) : undefined, label: String(m['label'] ?? ''), intendedState: String(m['intendedState'] ?? ''), sequence: Number(m['sequence'] ?? 0), confirmationCondition: m['confirmationCondition'] != null ? String(m['confirmationCondition']) : null, targetWindow: m['targetWindow'] != null ? String(m['targetWindow']) : null, dependencies: Array.isArray(m['dependencies']) ? (m['dependencies'] as unknown[]).map((x) => String(x)) : [], uncertainty: m['uncertainty'] != null ? String(m['uncertainty']) : null })),
      assumptions: as.map((a): Assumption => ({ statement: String(a['statement'] ?? ''), status: String(a['status'] ?? 'UNKNOWN') as Assumption['status'] })),
      dependencies: ds.map((d): Dependency => ({ statement: String(d['statement'] ?? ''), kind: String(d['kind'] ?? 'EXTERNAL') as Dependency['kind'], availability: String(d['availability'] ?? 'UNKNOWN') as Dependency['availability'] })),
      resourceConstraints: arr('resourceConstraints'), reviewConditions: arr('reviewConditions'), exitConditions: arr('exitConditions'),
      noMilestoneRationale: b['noMilestoneRationale'] != null ? String(b['noMilestoneRationale']) : null,
      acknowledgedInsufficientEvidence: b['acknowledgedInsufficientEvidence'] === true, expiresAt: b['expiresAt'] != null ? String(b['expiresAt']) : null,
      idempotencyKey: String(b['idempotencyKey'] ?? ''),
    };
  };

  // Create + ACTIVATE ONE Strategic Plan from an explicit founder action on an EFFECTIVE, ACTIVE commitment (idempotent).
  server.post('/strategy/commitments/:logicalCommitmentId/plans', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalCommitmentId = (request.params as { logicalCommitmentId: string }).logicalCommitmentId;
    const now = new Date();
    const commitment = await commitmentRepo.getEffective(founderId, logicalCommitmentId, now); // founder-owned effective only
    if (!commitment) { await reply.code(404).send({ error: 'not found' }); return; }
    const input = planInput((request.body ?? {}) as Record<string, unknown>);
    let conflicts;
    try { conflicts = assertPlanAdmissible(commitment, input, now); }
    catch (e) { if (e instanceof PlanValidationError) { await reply.code(400).send({ error: e.message, reason: e.reason, conflicts: e.conflicts ?? [] }); return; } throw e; }
    const plan = await planRepo.create(founderId, commitment, input, conflicts, now);
    await reply.code(201).send({ plan: toPlanView(plan, 'CURRENT') });
  });

  server.get('/strategy/plans', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ plans: (await planRepo.listByFounder(founderId, new Date())).map((p) => toPlanView(p)) });
  });

  server.get('/strategy/plans/:logicalPlanId', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalPlanId = (request.params as { logicalPlanId: string }).logicalPlanId;
    const now = new Date();
    const history = await planRepo.getHistory(founderId, logicalPlanId, now);
    if (!history.length) { await reply.code(404).send({ error: 'not found' }); return; }
    const effective = history[history.length - 1]!;
    const effCommitment = await commitmentRepo.getEffective(founderId, effective.commitmentLogicalId, now);
    const linked = linkedCommitmentStatus(effCommitment, effective.commitmentRecordId);
    await reply.send({ plan: toPlanView(effective, linked), history: history.map((p) => toPlanView(p)) });
  });

  server.post('/strategy/plans/:logicalPlanId/supersede', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalPlanId = (request.params as { logicalPlanId: string }).logicalPlanId;
    const b = (request.body ?? {}) as Record<string, unknown>;
    const now = new Date();
    const commitment = await commitmentRepo.getEffective(founderId, String(b['logicalCommitmentId'] ?? ''), now);
    if (!commitment) { await reply.code(404).send({ error: 'not found' }); return; }
    const input = planInput(b);
    let conflicts;
    try { conflicts = assertPlanAdmissible(commitment, input, now); }
    catch (e) { if (e instanceof PlanValidationError) { await reply.code(400).send({ error: e.message, reason: e.reason, conflicts: e.conflicts ?? [] }); return; } throw e; }
    const plan = await planRepo.supersede(founderId, logicalPlanId, commitment, input, conflicts, now);
    if (!plan) { await reply.code(409).send({ error: 'this plan can’t be superseded' }); return; }
    await reply.code(201).send({ plan: toPlanView(plan, 'CURRENT') });
  });

  for (const action of ['retire', 'cancel'] as const) {
    server.post(`/strategy/plans/:logicalPlanId/${action}`, async (request: FastifyRequest, reply: FastifyReply) => {
      const founderId = await sessionFounder(request);
      if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
      const logicalPlanId = (request.params as { logicalPlanId: string }).logicalPlanId;
      const b = (request.body ?? {}) as Record<string, unknown>;
      const note = b['note'] != null ? String(b['note']) : null;
      const key = String(b['idempotencyKey'] ?? `${action}:${logicalPlanId}`);
      const plan = action === 'retire'
        ? await planRepo.retire(founderId, logicalPlanId, note, key, new Date())
        : await planRepo.cancel(founderId, logicalPlanId, note, key, new Date());
      if (!plan) { await reply.code(409).send({ error: `this plan can’t be ${action === 'cancel' ? 'cancelled' : 'retired'}` }); return; }
      await reply.code(201).send({ plan: toPlanView(plan) });
    });
  }

  // ── Strategic Plan Review Records (founder-explicit; append-only; creates NO lifecycle mutation) ──────────
  const reviewInput = (b: Record<string, unknown>): PlanReviewInput => {
    const obs = Array.isArray(b['observations']) ? (b['observations'] as Array<Record<string, unknown>>) : [];
    const ev = Array.isArray(b['evidenceReferences']) ? (b['evidenceReferences'] as Array<Record<string, unknown>>) : [];
    const aa = Array.isArray(b['assumptionAssessments']) ? (b['assumptionAssessments'] as Array<Record<string, unknown>>) : [];
    const da = Array.isArray(b['dependencyAssessments']) ? (b['dependencyAssessments'] as Array<Record<string, unknown>>) : [];
    const ma = Array.isArray(b['milestoneAssessments']) ? (b['milestoneAssessments'] as Array<Record<string, unknown>>) : [];
    const cc = Array.isArray(b['contextChanges']) ? (b['contextChanges'] as Array<Record<string, unknown>>) : [];
    return {
      reviewStatement: b['reviewStatement'] != null ? String(b['reviewStatement']) : null,
      reviewPeriodStart: b['reviewPeriodStart'] != null ? String(b['reviewPeriodStart']) : null, reviewPeriodEnd: b['reviewPeriodEnd'] != null ? String(b['reviewPeriodEnd']) : null,
      observations: obs.map((o): NonNullable<PlanReviewInput['observations']>[number] => ({ statement: String(o['statement'] ?? ''), sourceType: String(o['sourceType'] ?? 'FOUNDER_REPORTED') as ReviewObservation['sourceType'], evidenceRef: o['evidenceRef'] != null ? String(o['evidenceRef']) : null, observedAt: o['observedAt'] != null ? String(o['observedAt']) : null, certainty: (o['certainty'] != null ? String(o['certainty']) : 'UNKNOWN') as ReviewObservation['certainty'] })),
      evidenceReferences: ev.map((e): EvidenceReference => ({ space: String(e['space'] ?? '') as EvidenceReference['space'], id: String(e['id'] ?? '') })),
      assumptionAssessments: aa.map((a) => ({ originalIndex: Number(a['originalIndex'] ?? -1), assessment: String(a['assessment'] ?? '') as NonNullable<PlanReviewInput['assumptionAssessments']>[number]['assessment'], explanation: a['explanation'] != null ? String(a['explanation']) : null })),
      dependencyAssessments: da.map((d) => ({ originalIndex: Number(d['originalIndex'] ?? -1), assessment: String(d['assessment'] ?? '') as NonNullable<PlanReviewInput['dependencyAssessments']>[number]['assessment'], explanation: d['explanation'] != null ? String(d['explanation']) : null })),
      milestoneAssessments: ma.map((m) => ({ milestoneId: String(m['milestoneId'] ?? ''), assessment: String(m['assessment'] ?? '') as NonNullable<PlanReviewInput['milestoneAssessments']>[number]['assessment'], explanation: m['explanation'] != null ? String(m['explanation']) : null })),
      contextChanges: cc.map((c): ContextChange => ({ category: String(c['category'] ?? 'OTHER') as ContextChange['category'], statement: String(c['statement'] ?? '') })),
      unresolvedUnknowns: Array.isArray(b['unresolvedUnknowns']) ? (b['unresolvedUnknowns'] as unknown[]).map((x) => String(x)) : [],
      reviewConclusion: String(b['reviewConclusion'] ?? '') as PlanReviewInput['reviewConclusion'], selectedDisposition: String(b['selectedDisposition'] ?? '') as PlanReviewInput['selectedDisposition'],
      idempotencyKey: String(b['idempotencyKey'] ?? ''),
    };
  };

  // Create ONE Strategic Plan Review of an EXACT plan revision (explicit; creates NO plan/commitment lifecycle change).
  server.post('/strategy/plans/:logicalPlanId/reviews', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalPlanId = (request.params as { logicalPlanId: string }).logicalPlanId;
    const now = new Date();
    const history = await planRepo.getHistory(founderId, logicalPlanId, now); // founder-owned only → cross-founder = 404
    if (!history.length) { await reply.code(404).send({ error: 'not found' }); return; }
    const b = (request.body ?? {}) as Record<string, unknown>;
    const targetId = b['planRecordId'] != null ? String(b['planRecordId']) : null;
    const plan = targetId ? history.find((p) => p.id === targetId) : history[history.length - 1]; // any revision may be reviewed
    if (!plan) { await reply.code(404).send({ error: 'not found' }); return; }
    const input = reviewInput(b);
    try { assertReviewAdmissible(plan, input); }
    catch (e) { if (e instanceof ReviewValidationError) { await reply.code(400).send({ error: e.message, reason: e.reason }); return; } throw e; }
    const review = await planReviewRepo.create(founderId, plan, input, now);
    await reply.code(201).send({ review: toReviewView(review, { linkedCommitment: 'CURRENT' }) });
  });

  server.get('/strategy/plans/:logicalPlanId/reviews', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalPlanId = (request.params as { logicalPlanId: string }).logicalPlanId;
    const owned = await planRepo.getEffective(founderId, logicalPlanId, new Date());
    if (!owned) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ reviews: (await planReviewRepo.listByPlan(founderId, logicalPlanId)).map((r) => toReviewView(r)) });
  });

  // EXECUTION BOUNDARY (ADR-015). Append-only ledger of FOUNDER TESTIMONY about execution against a plan milestone/plan.
  // The product performs NOTHING and verifies NOTHING (UNVERIFIED_FOUNDER_REPORT / NOT_PERFORMED_BY_PRODUCT). No plan/
  // decision/commitment/review mutation; no downstream artifacts; no external action. Evidence is stored, never fetched.
  const execErr = (reply: FastifyReply, e: ExecutionReportError) => {
    const code = e.reason === 'STALE_HEAD' ? 'EXECUTION_REPORT_STALE_HEAD'
      : e.reason === 'LINEAGE_INVALID' ? 'EXECUTION_REPORT_LINEAGE_INVALID'
      : (e.reason === 'ALREADY_ACTIVE' || e.reason === 'NO_ACTIVE_REPORT') ? 'EXECUTION_REPORT_INVALID_TRANSITION' : e.reason;
    const status = e.reason === 'STALE_HEAD' || e.reason === 'LINEAGE_INVALID' || e.reason === 'ALREADY_ACTIVE' || e.reason === 'NO_ACTIVE_REPORT' ? 409 : 400;
    return reply.code(status).send({ error: { code, message: e.message }, reason: e.reason });
  };
  // ADR-015 remediation: execution identity is the EXACT immutable Plan revision. The routes take `:planId` (the plan
  // revision record id), NOT the logical plan — so each revision has an independent execution chain and effective state.
  async function resolveExecutionSubject(founderId: string, planId: string, b: Record<string, unknown>) {
    const plan = await planRepo.getByRevisionId(founderId, planId, new Date());
    if (!plan) return { error: 'PLAN_NOT_FOUND' as const };
    const subjectType = String(b['subjectType'] ?? 'MILESTONE') as ExecutionSubjectType;
    const subjectId = subjectType === 'PLAN' ? plan.logicalPlanId : String(b['subjectId'] ?? '');
    if (subjectType === 'MILESTONE' && !plan.milestones.some((m) => m.id === subjectId)) return { error: 'PLAN_ITEM_NOT_FOUND' as const };
    return { plan, subjectType, subjectId };
  }
  function execInputFrom(b: Record<string, unknown>, subjectType: ExecutionSubjectType, subjectId: string): ExecutionReportInput {
    return { subjectType, subjectId, executionState: String(b['executionState'] ?? '') as ExecutionReportInput['executionState'], founderStatement: String(b['founderStatement'] ?? ''), occurredAt: b['occurredAt'] ? String(b['occurredAt']) : null, evidenceReferences: Array.isArray(b['evidenceReferences']) ? (b['evidenceReferences'] as ExecutionReportInput['evidenceReferences']) : [], idempotencyKey: String(b['idempotencyKey'] ?? '') };
  }

  server.post('/strategy/plans/:planId/execution-reports', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const b = (request.body ?? {}) as Record<string, unknown>;
    const r = await resolveExecutionSubject(founderId, (request.params as { planId: string }).planId, b);
    if ('error' in r) { await reply.code(404).send({ error: { code: r.error, message: 'not found' }, reason: r.error }); return; }
    try {
      const ev = await executionRepo.record(founderId, 'REPORT', r.plan, execInputFrom(b, r.subjectType, r.subjectId), new Date());
      await reply.code(201).send({ report: toExecutionReportView(ev) });
    } catch (e) { if (e instanceof ExecutionReportError) { await execErr(reply, e); return; } throw e; }
  });

  const executionTransition = (kind: Extract<ReportKind, 'CORRECT' | 'WITHDRAW'>) => async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const { planId, reportId } = request.params as { planId: string; reportId: string };
    const b = (request.body ?? {}) as Record<string, unknown>;
    const plan = await planRepo.getByRevisionId(founderId, planId, new Date()); // the EXACT revision being acted on
    if (!plan) { await reply.code(404).send({ error: { code: 'PLAN_NOT_FOUND', message: 'not found' }, reason: 'PLAN_NOT_FOUND' }); return; }
    const referenced = await executionRepo.getReportById(founderId, reportId); // founder-owned only
    // The referenced report must belong to THIS EXACT plan revision — a cross-revision correction/withdrawal is rejected.
    if (!referenced || referenced.planId !== planId) { await reply.code(404).send({ error: { code: 'EXECUTION_REPORT_NOT_FOUND', message: 'not found (or belongs to a different plan revision)' }, reason: 'EXECUTION_REPORT_NOT_FOUND' }); return; }
    const input = execInputFrom(b, referenced.subjectType, referenced.subjectId);
    try {
      const ev = await executionRepo.record(founderId, kind, plan, input, new Date(), referenced.id); // expectedHead = the referenced report
      await reply.code(201).send({ report: toExecutionReportView(ev) });
    } catch (e) { if (e instanceof ExecutionReportError) { await execErr(reply, e); return; } throw e; }
  };
  server.post('/strategy/plans/:planId/execution-reports/:reportId/correct', executionTransition('CORRECT'));
  server.post('/strategy/plans/:planId/execution-reports/:reportId/withdraw', executionTransition('WITHDRAW'));

  server.get('/strategy/plans/:planId/execution-reports', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const planId = (request.params as { planId: string }).planId;
    const owned = await planRepo.getByRevisionId(founderId, planId, new Date());
    if (!owned) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ reports: (await executionRepo.listForRevision(founderId, planId)).map(toExecutionReportView) });
  });

  // Canonical effective founder-reported execution for ONE EXACT plan revision, composed per milestone (never flattened
  // into the plan record). A different revision's reports never appear here.
  server.get('/strategy/plans/:planId/effective-execution', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const planId = (request.params as { planId: string }).planId;
    const plan = await planRepo.getByRevisionId(founderId, planId, new Date());
    if (!plan) { await reply.code(404).send({ error: 'not found' }); return; }
    const events = await executionRepo.listForRevision(founderId, planId); // ONLY this revision's events
    const milestones = plan.milestones.map((m) => ({ milestoneId: m.id, label: m.label, execution: toEffectiveExecutionView(effectiveFromHead(executionChainHead(events, plan.id, 'MILESTONE', m.id), 'MILESTONE', m.id)) }));
    const planLevel = toEffectiveExecutionView(effectiveFromHead(executionChainHead(events, plan.id, 'PLAN', plan.logicalPlanId), 'PLAN', plan.logicalPlanId));
    await reply.send({ planIntention: { planId: plan.id, logicalPlanId: plan.logicalPlanId, revision: plan.revision, status: plan.status }, milestones, planLevel, notExecution: true, productExecutionStatus: 'NOT_PERFORMED_BY_PRODUCT' });
  });

  server.get('/strategy/plan-reviews/:reviewId', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const review = await planReviewRepo.getById(founderId, (request.params as { reviewId: string }).reviewId);
    if (!review) { await reply.code(404).send({ error: 'not found' }); return; }
    const now = new Date();
    // neutral read-time notices — never mutate anything
    const effCommitment = await commitmentRepo.getEffective(founderId, review.commitmentLogicalId, now);
    const linked = linkedCommitmentStatusForReview(effCommitment?.status ?? null, effCommitment?.id ?? null, review.commitmentRecordId);
    const effPlan = await planRepo.getEffective(founderId, review.planLogicalId, now);
    const planHistory = await planRepo.getHistory(founderId, review.planLogicalId, now);
    const reviewedPlanStatusNow = planHistory.find((p) => p.id === review.planRecordId)?.status;
    await reply.send({ review: toReviewView(review, { linkedCommitment: linked, newerPlanRevisionExists: !!effPlan && effPlan.revision > review.planRevision, planStatusNow: reviewedPlanStatusNow }) });
  });

  // ── Strategic Learning Records (founder-explicit; created/kept FROM a review; append-only; mutates NOTHING else) ──
  // Keep ONE durable strategic learning from an EXACT owned review. Writes only the learning; NEVER touches BU/FSC.
  // (This is creation, not "promotion" — promotion into BU/FSC is a separate future gate, Law 14.)
  server.post('/strategy/plan-reviews/:reviewId/learnings', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const review = await planReviewRepo.getById(founderId, (request.params as { reviewId: string }).reviewId); // founder-owned only → cross-founder = 404
    if (!review) { await reply.code(404).send({ error: 'not found' }); return; }
    const b = (request.body ?? {}) as Record<string, unknown>;
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    const input: LearningInput = {
      learningStatement: String(b['learningStatement'] ?? ''),
      learningCategory: String(b['learningCategory'] ?? '') as LearningInput['learningCategory'],
      confidence: String(b['confidence'] ?? '') as LearningInput['confidence'],
      priorUnderstanding: String(b['priorUnderstanding'] ?? ''),
      revisedUnderstanding: String(b['revisedUnderstanding'] ?? ''),
      changeStatement: String(b['changeStatement'] ?? ''),
      learningScope: String(b['learningScope'] ?? '') as LearningInput['learningScope'],
      broadScopeAcknowledged: b['broadScopeAcknowledged'] === true,
      isCausalHypothesis: b['isCausalHypothesis'] === true,
      boundaryConditions: arr(b['boundaryConditions']), counterEvidence: arr(b['counterEvidence']), unresolvedUnknowns: arr(b['unresolvedUnknowns']),
      observations: Array.isArray(b['observations']) ? (b['observations'] as Array<Record<string, unknown>>).map((o) => ({ statement: String(o?.['statement'] ?? ''), sourceType: String(o?.['sourceType'] ?? 'FOUNDER_REPORTED') as ObservationSource })) : [],
      evidenceReferences: Array.isArray(b['evidenceReferences']) ? (b['evidenceReferences'] as Array<Record<string, unknown>>).map((e) => ({ space: String(e?.['space'] ?? ''), id: String(e?.['id'] ?? '') })) : [],
      idempotencyKey: String(b['idempotencyKey'] ?? ''),
    };
    try { assertLearningAdmissible(review, input); }
    catch (e) { if (e instanceof LearningValidationError) { await reply.code(400).send({ error: { code: e.reason, message: e.message }, reason: e.reason }); return; } throw e; }
    const learning = await learningRepo.create(founderId, review, input, new Date());
    await reply.code(201).send({ learning: toLearningView(learning) });
  });

  server.get('/strategy/learnings', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ learnings: (await learningRepo.listByFounder(founderId)).map(toLearningView) });
  });

  server.get('/strategy/learnings/:logicalLearningId', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const revisions = await learningRepo.getThread(founderId, (request.params as { logicalLearningId: string }).logicalLearningId);
    if (!revisions.length) { await reply.code(404).send({ error: 'not found' }); return; }
    const effective = revisions[revisions.length - 1]!;
    await reply.send({ learning: toLearningView(effective), history: revisions.map(toLearningView) });
  });

  // ── Strategic Learning Lifecycle (ADR-012, single-thread; NO inter-thread relationship) ──────────────────
  // Founder-directed change within ONE logical thread: REFINE/CONTEST/SUPERSEDE/RETIRE, each an explicit immutable
  // revision. Mutates NOTHING downstream (BU/FSC/review/plan/commitment/decision); creates no relationship object.
  const lifecycleFlags = { doesNotModifyBusinessUnderstanding: true as const, doesNotModifyFounderStrategicContext: true as const, doesNotModifyReview: true as const, doesNotModifyPlan: true as const, doesNotModifyCommitment: true as const, doesNotModifyDecision: true as const, createsRecommendation: false as const, createsExecution: false as const, createsRelationship: false as const };
  function lifecycleInput(b: Record<string, unknown>): LifecycleTransitionInput {
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
    return {
      sourceRevisionId: String(b['sourceRevisionId'] ?? ''), expectedRevision: Number(b['expectedRevision'] ?? -1), idempotencyKey: String(b['idempotencyKey'] ?? ''),
      lifecycleReason: String(b['lifecycleReason'] ?? ''), confirmSameLearning: b['confirmSameLearning'] === true,
      learningStatement: b['learningStatement'] as string | undefined, learningCategory: b['learningCategory'] as LearningInput['learningCategory'] | undefined, confidence: b['confidence'] as LearningInput['confidence'] | undefined,
      priorUnderstanding: b['priorUnderstanding'] as string | undefined, revisedUnderstanding: b['revisedUnderstanding'] as string | undefined, changeStatement: b['changeStatement'] as string | undefined,
      learningScope: b['learningScope'] as LearningInput['learningScope'] | undefined, broadScopeAcknowledged: b['broadScopeAcknowledged'] === true ? true : (b['broadScopeAcknowledged'] === false ? false : undefined), isCausalHypothesis: b['isCausalHypothesis'] === true ? true : (b['isCausalHypothesis'] === false ? false : undefined),
      boundaryConditions: b['boundaryConditions'] !== undefined ? arr(b['boundaryConditions']) : undefined, counterEvidence: b['counterEvidence'] !== undefined ? arr(b['counterEvidence']) : undefined, unresolvedUnknowns: b['unresolvedUnknowns'] !== undefined ? arr(b['unresolvedUnknowns']) : undefined,
      observations: Array.isArray(b['observations']) ? (b['observations'] as Array<Record<string, unknown>>).map((o) => ({ statement: String(o?.['statement'] ?? ''), sourceType: String(o?.['sourceType'] ?? 'FOUNDER_REPORTED') as ObservationSource })) : undefined,
      evidenceReferences: Array.isArray(b['evidenceReferences']) ? (b['evidenceReferences'] as Array<Record<string, unknown>>).map((e) => ({ space: String(e?.['space'] ?? ''), id: String(e?.['id'] ?? '') })) : undefined,
      contestBasisExplanation: b['contestBasisExplanation'] as string | undefined,
      replacementSummary: b['replacementSummary'] as string | undefined, retainedValidity: b['retainedValidity'] as string | undefined,
      counterevidenceResolution: b['counterevidenceResolution'] as string | undefined, unknownsResolution: b['unknownsResolution'] as string | undefined,
    };
  }
  const lifecycleHandler = (action: Exclude<LearningLifecycleAction, 'CREATE'>) => async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const logicalLearningId = (request.params as { learningId: string }).learningId;
    const existingThread = await learningRepo.getThread(founderId, logicalLearningId);
    if (!existingThread.length) { await reply.code(404).send({ error: 'not found' }); return; } // founder-owned only → cross-founder = 404
    const input = lifecycleInput((request.body ?? {}) as Record<string, unknown>);
    let revision;
    try { revision = await learningRepo.appendRevision(founderId, logicalLearningId, action, input, new Date()); }
    catch (e) {
      if (e instanceof LearningLifecycleError) { await reply.code(e.conflict ? 409 : 400).send({ error: { code: e.reason, message: e.message }, reason: e.reason }); return; }
      throw e;
    }
    await reply.code(201).send({ learning: toLearningView(revision), lifecycleStatus: deriveLifecycleStatus(revision.lifecycleAction), ...lifecycleFlags });
  };
  server.post('/strategy/learnings/:learningId/refine', lifecycleHandler('REFINE'));
  server.post('/strategy/learnings/:learningId/contest', lifecycleHandler('CONTEST'));
  server.post('/strategy/learnings/:learningId/supersede', lifecycleHandler('SUPERSEDE'));
  server.post('/strategy/learnings/:learningId/retire', lifecycleHandler('RETIRE'));

  server.get('/strategy/learning-threads', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ threads: (await learningRepo.listThreads(founderId)).map(toLearningView) });
  });
  server.get('/strategy/learning-threads/:logicalLearningId', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const revisions = await learningRepo.getThread(founderId, (request.params as { logicalLearningId: string }).logicalLearningId);
    if (!revisions.length) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ effective: toLearningView(revisions[revisions.length - 1]!), revisions: revisions.map(toLearningView) });
  });
  server.get('/strategy/learnings/revision/:revisionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const rev = await learningRepo.getRevisionById(founderId, (request.params as { revisionId: string }).revisionId);
    if (!rev) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ learning: toLearningView(rev) });
  });

  // ── Strategic Learning Promotion Gate (ADR-013) — the ONLY explicit path a learning influences BU/FSC ──────
  // Founder-explicit PROMOTE/REPLACE/REMOVE of an EXACT learning revision into a target. Writes to NEITHER
  // business.understanding NOR founder_strategic_context_item; edits no chain record; regenerates nothing.
  const promotionHandler = (action: PromotionAction) => async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const revision = await learningRepo.getRevisionById(founderId, (request.params as { revisionId: string }).revisionId); // founder-owned only → 404
    if (!revision) { await reply.code(404).send({ error: 'not found' }); return; }
    const b = (request.body ?? {}) as Record<string, unknown>;
    const input: PromotionInput = { target: String(b['target'] ?? '') as PromotionTarget, scope: String(b['scope'] ?? '') as PromotionInput['scope'], rationale: String(b['rationale'] ?? ''), idempotencyKey: String(b['idempotencyKey'] ?? '') };
    let event;
    try { event = await promotionRepo.record(founderId, action, revision, input, new Date()); }
    catch (e) {
      if (e instanceof PromotionValidationError) { const conflict = e.reason === 'ALREADY_PROMOTED' || e.reason === 'NOT_PROMOTED'; await reply.code(conflict ? 409 : 400).send({ error: { code: e.reason, message: e.message }, reason: e.reason }); return; }
      throw e;
    }
    await reply.code(201).send({ promotion: toPromotionView(event) });
  };
  server.post('/strategy/learnings/revision/:revisionId/promote', promotionHandler('PROMOTE'));
  server.post('/strategy/learnings/revision/:revisionId/replace-promotion', promotionHandler('REPLACE'));
  server.post('/strategy/learnings/revision/:revisionId/remove-promotion', promotionHandler('REMOVE'));

  async function effectivePromotions(founderId: string, target: PromotionTarget) {
    const events = await promotionRepo.getEffective(founderId, target);
    return Promise.all(events.map(async (e) => {
      const rev = await learningRepo.getRevisionById(founderId, e.learningRevisionId);
      return { ...toPromotionView(e), learning: { ...toPromotionView(e).learning, statement: rev?.learningStatement ?? null, confidence: rev?.confidence ?? null, lifecycleAction: rev?.lifecycleAction ?? null } };
    }));
  }
  server.get('/strategy/promotions/business-understanding', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ target: 'BUSINESS_UNDERSTANDING', promoted: await effectivePromotions(founderId, 'BUSINESS_UNDERSTANDING') });
  });
  server.get('/strategy/promotions/founder-strategic-context', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ target: 'FOUNDER_STRATEGIC_CONTEXT', promoted: await effectivePromotions(founderId, 'FOUNDER_STRATEGIC_CONTEXT') });
  });
  server.get('/strategy/promotions', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ promotions: (await promotionRepo.listEvents(founderId)).map(toPromotionView) });
  });

  // CANONICAL effective-context reads (ADR-013 remediation; contract C-2/C-3). Compose the NATIVE records with the
  // effective promoted learning revisions (each pinned to its EXACT revision, derived from the sequence chain — never
  // createdAt, never the latest learning revision). GET-only; writes nothing; regenerates no recommendation; provenance
  // preserved (NATIVE_* vs PROMOTED_LEARNING). These are AUTHORITATIVE for "current effective BU/FSC"; the
  // /strategy/promotions[/*] routes above remain available for audit.
  async function promotedItemsFor(founderId: string, target: PromotionTarget): Promise<EffectiveContextItem[]> {
    const events = await promotionRepo.getEffective(founderId, target); // effective = chain-head, non-REMOVE
    const items = await Promise.all(events.map(async (e) => toPromotedLearningItem(e, await learningRepo.getRevisionById(founderId, e.learningRevisionId))));
    return items.filter((x): x is EffectiveContextItem => x != null);
  }
  server.get('/strategy/effective-business-understanding', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const native = await assembler.understanding.latest(founderId);
    await reply.send({ effective: composeEffectiveBusinessUnderstanding(native, await promotedItemsFor(founderId, 'BUSINESS_UNDERSTANDING')) });
  });
  server.get('/strategy/effective-founder-strategic-context', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const nativeItems = await assembler.strategicContext.listActive(founderId);
    await reply.send({ effective: composeEffectiveFounderStrategicContext(nativeItems, await promotedItemsFor(founderId, 'FOUNDER_STRATEGIC_CONTEXT')) });
  });

  // CONSUMPTION GATE (ADR-014). A Context Snapshot is an explicit, immutable freeze of the current Effective BU + FSC that
  // a recommendation may consume. Creating one is a founder act; it mutates nothing and regenerates nothing. Reasoning
  // reads the frozen snapshot (bound via POST /strategy/sessions { contextSnapshotId }), never live context.
  server.post('/strategy/context-snapshots', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const captured = await captureEffectiveContext(founderId, { assembler, promotionRepo, learningRepo });
    const snap = await snapshotRepo.create(founderId, captured.businessUnderstanding, captured.founderStrategicContext, captured.publicPositioningContext, captured.provenance, new Date());
    await reply.code(201).send({ snapshot: toSnapshotView(snap) });
  });
  server.get('/strategy/context-snapshots', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    await reply.send({ snapshots: (await snapshotRepo.list(founderId)).map(toSnapshotView) });
  });
  server.get('/strategy/context-snapshots/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const snap = await snapshotRepo.getById(founderId, (request.params as { id: string }).id);
    if (!snap) { await reply.code(404).send({ error: 'not found' }); return; }
    await reply.send({ snapshot: toSnapshotView(snap) });
  });
}
