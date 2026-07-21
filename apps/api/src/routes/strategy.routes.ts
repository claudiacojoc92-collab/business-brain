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
import { PgFounderStrategicContextRepository } from '../business-model/pg-founder-strategic-context.repository';
import { assertDecisionAdmissible, toDecisionView, DecisionValidationError, type DecisionInput } from '../business-model/strategic-decision';
import { assertCommitmentAdmissible, toCommitmentView, linkedDecisionStatus, CommitmentValidationError, type CommitmentInput, type ResourceEnvelopeItem, type AcceptedCost } from '../business-model/strategic-commitment';
import { assertPlanAdmissible, toPlanView, linkedCommitmentStatus, PlanValidationError, type PlanInput, type Milestone, type Assumption, type Dependency } from '../business-model/strategic-plan';
import { assertReviewAdmissible, toReviewView, linkedCommitmentStatusForReview, ReviewValidationError, type PlanReviewInput, type ReviewObservation, type EvidenceReference, type ContextChange } from '../business-model/strategic-plan-review';
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
    startStrategicSessionWorker({ sessionRepo, assembler, model: new AnthropicStrategyModel(apiKey), leaseMs: LEASE_MS, now: () => new Date() });
  }

  // POST /strategy/sessions — classify; out-of-scope → 200 boundary (no job); in-scope → create (idempotent) 202.
  server.post('/strategy/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const founderId = await sessionFounder(request);
    if (!founderId) { await reply.code(401).send({ error: 'authentication required' }); return; }
    const question = String((request.body as Record<string, unknown> | undefined)?.['question'] ?? '').trim();
    if (!question) { await reply.code(400).send({ error: 'a question is required' }); return; }
    const cls = classifyStrategicJob(question);
    if (cls.job === 'OUT_OF_SCOPE') { await reply.code(200).send({ outOfScope: true, boundary: boundaryResponse() }); return; }
    const cfg = strategyModelConfig();
    const s = await sessionRepo.create(founderId, { strategicJob: cls.job, subtype: cls.subtype, questionText: question, modelId: cfg.modelId, promptVersion: cfg.promptVersion, schemaVersion: cfg.schemaVersion }, new Date());
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
}
