import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createKyselyClient } from '@bb/infrastructure';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgContextSnapshotRepository } from '../../business-model/pg-context-snapshot.repository';
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgStrategicSessionRepository } from '../../business-model/pg-strategic-session.repository';
import { PgStrategicLearningRepository } from '../../business-model/pg-strategic-learning.repository';
import { PgLearningPromotionRepository } from '../../business-model/pg-learning-promotion.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import { PgMarketEntityRepository, PgMarketFindingRepository } from '../../business-model/pg-market.repository';
import { PgMarketFindingResponseRepository } from '../../business-model/pg-market-finding-response.repository';
import { PgMarketReviewRepository } from '../../business-model/pg-market-review.repository';
import { captureEffectiveContext } from '../../business-model/context-snapshot.capture';
import { PgClarityStore } from '../../business-model/pg-clarity.repository';
import { PgUnderstandingItemRepository } from '../../business-model/pg-understanding-item.repository';
import { composeEffectiveUnderstanding } from '../../business-model/effective-understanding';
import { assembleClarityContext } from '../../business-model/clarity-context';
import { ClarityService, crystallizeConcern } from '../../business-model/clarity.service';
import { FixtureClarityModel, ContextEchoClarityModel, advertisingScenarioResult, type ClarityModel } from '../../business-model/clarity-model';
import { normalizeClarityResult, type ClarityResult } from '../../business-model/clarity-result';

/**
 * Clarity / Sensemaking §LIVE — proves the actual engine end-to-end against the real DB with a DETERMINISTIC fixture model.
 * The founder brings the advertising tension; Business Brain audits (does NOT recommend ads), separates known/assumed/
 * unknown/conflict, proposes (never saves) an Understanding update, and only crystallizes a Strategy Thread on explicit
 * confirmation. The confirmation boundary and founder isolation are enforced. Skip-guarded on a dev DB.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const EA = 'clarity.a@loop.test'; const EB = 'clarity.b@loop.test'; const EC = 'clarity.c@loop.test'; const ED = 'clarity.d@loop.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
let db: AnyDB; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

async function purge(): Promise<void> {
  const rows = await db.selectFrom('identity.founders').select('founder_id').where('email', 'in', [EA, EB, EC, ED]).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (!ids.length) return;
  await db.transaction().execute(async (tx: AnyDB) => {
    await sql`SELECT set_config('bb.allow_concern_delete','on',true)`.execute(tx);
    await sql`SELECT set_config('bb.allow_snapshot_delete','on',true)`.execute(tx);
    await sql`SELECT set_config('bb.allow_understanding_item_delete','on',true)`.execute(tx);
    for (const t of ['business.proposed_understanding_change', 'business.understanding_item', 'business.clarity_result', 'business.concern_message', 'business.concern', 'business.context_snapshot', 'business.strategic_session', 'business.founder_strategic_context_item', 'business.conclusion_response', 'business.understanding', 'identity.sessions', 'identity.founder_credentials']) {
      await tx.deleteFrom(t).where('founder_id', 'in', ids).execute();
    }
  });
  await db.deleteFrom('identity.founders').where('email', 'in', [EA, EB, EC, ED]).execute();
}
async function signup(email: string): Promise<string> {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'claritypass-12' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'claritypass-12' } });
  return l.json<{ founder_id: string }>().founder_id;
}
/** The acceptance-scenario Understanding: specialist service, receives inquiries, some don't convert, drop-off unknown. */
async function seedUnderstanding(founderId: string): Promise<void> {
  await new PgUnderstandingRepository(db).save({
    id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'clarity-seed', sourceFragmentIds: ['f'],
    conclusions: [
      { id: 'c-what', type: 'what_it_is', statement: 'A specialist service business that receives inbound inquiries.', epistemicStatus: 'OBSERVED', evidenceRefs: ['f'], confidence: 'high', confirmationState: 'confirmed', founderCorrection: null },
      { id: 'c-drop', type: 'missing_information', statement: 'Where prospects drop off in the path from inquiry to purchase is not known.', epistemicStatus: 'NEEDS_MORE_EVIDENCE', evidenceRefs: [], confidence: 'low', confirmationState: 'pending', founderCorrection: null },
    ], createdAt: new Date().toISOString(),
  });
}
function store(): PgClarityStore { return new PgClarityStore(db); }
function itemRepo(): PgUnderstandingItemRepository { return new PgUnderstandingItemRepository(db); }
function service(model: ClarityModel = new FixtureClarityModel()): ClarityService {
  return new ClarityService({ store: store(), model, understanding: new PgUnderstandingRepository(db), strategicContext: new PgFounderStrategicContextRepository(db), understandingItems: itemRepo(), db });
}
async function countRows(founderId: string, table: string): Promise<number> {
  return (await db.selectFrom(table).select('id').where('founder_id', '=', founderId).execute()).length;
}
async function understandingFingerprint(founderId: string): Promise<string> {
  const u = await new PgUnderstandingRepository(db).latest(founderId);
  return JSON.stringify({ version: u?.version ?? null, conclusions: (u?.conclusions ?? []).map((c) => [c.id, c.statement, c.confirmationState, c.founderCorrection]) });
}

let A = ''; let B = '';

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['DATABASE_URL'] = DB_URL;
  db = createKyselyClient(DB_URL);
  try { await sql`select 1`.execute(db); dbUp = true; } catch { dbUp = false; return; }
  app = Fastify();
  await app.register(async (api) => { registerSessionRoutes(api); registerAuthCredentialRoutes(api, {}); }, { prefix: '/api' });
  await app.ready();
  await purge();
  A = await signup(EA); B = await signup(EB);
  await seedUnderstanding(A);
}, 120_000);
afterAll(async () => {
  if (dbUp) { await purge(); await app?.close(); await db?.destroy(); }
  process.env['NODE_ENV'] = prev.node; process.env['DATABASE_URL'] = prev.db;
});

const d = describe.skipIf(!process.env['GATE_DB_URL'] && process.env['RUN_LIVE'] !== '1');

d('Clarity — the advertising scenario, end-to-end', () => {
  it('T13 audits the tension without recommending ads; names the unconfirmed bottleneck; proposes (not saves) an update', async () => {
    const before = await understandingFingerprint(A);
    const turn = await service().turn(A, 'Everyone tells me I should run ads because I need more customers, but I don’t know if ads are really the answer.', null);
    expect(turn.ok).toBe(true);
    const r = turn.result!;
    // does NOT jump to run-ads / don't-run-ads; the clarified issue is that traffic is not yet the proven problem
    expect(r.clarifiedIssue).toMatch(/not yet proven|not yet.*traffic|isn’t yet known|is not yet/i);
    expect(r.smallestUsefulNextMove).toMatch(/where prospects.*stop/i);
    expect(r.alternativeInterpretation).toMatch(/ads may be appropriate/i);
    expect(r.whatWouldChangeThisReading.length).toBeGreaterThan(0);
    // a proposed (pending) understanding update exists — never auto-saved
    expect(turn.proposedChanges).toHaveLength(1);
    expect(turn.proposedChanges[0]!.status).toBe('pending');
    expect(turn.proposedChanges[0]!.statement).toMatch(/bottleneck is unconfirmed/i);
    // confirmed Understanding is byte-identical: the conversation changed nothing
    expect(await understandingFingerprint(A)).toEqual(before);
  });
});

d('Clarity — the constitutional boundaries', () => {
  it('T1 a clarity turn does not mutate confirmed Understanding', async () => {
    const before = await understandingFingerprint(A);
    await service().turn(A, 'Another way to look at my customer problem?', null);
    expect(await understandingFingerprint(A)).toEqual(before);
  });
  it('T2 proposed changes stay pending until explicitly accepted', async () => {
    const t = await service().turn(A, 'ads again?', null);
    const pc = await store().listProposedChanges(A, t.concernId);
    expect(pc.every((c) => c.status === 'pending')).toBe(true);
  });
  it('T3 rejecting a proposal leaves confirmed Understanding unchanged AND marks it rejected', async () => {
    const svc = service();
    const t = await svc.turn(A, 'should I just run ads?', null);
    const before = await understandingFingerprint(A);
    const ok = await svc.rejectProposedChange(A, t.proposedChanges[0]!.id);
    expect(ok).toBe(true);
    const after = await store().getProposedChange(A, t.proposedChanges[0]!.id);
    expect(after!.status).toBe('rejected');
    expect(await understandingFingerprint(A)).toEqual(before); // nothing written to Understanding
  });
  it('T4 an accepted change is stored distinctly (its own table + truth label), not merged into synthesized conclusions', async () => {
    const svc = service();
    const t = await svc.turn(A, 'is it really a traffic problem?', null);
    const beforeU = await understandingFingerprint(A);
    const item = await svc.acceptProposedChange(A, t.proposedChanges[0]!.id);
    expect(item).not.toBeNull();
    expect(item!.truthLabel).toBe('unconfirmed_or_disagree'); // carries a truth label, distinct from a Business-Brain inference
    const acc = (await svc.confirmedFromClarity(A, t.concernId));
    expect(acc).toHaveLength(1);
    // the synthesized Understanding version + conclusions are untouched — accepted clarity items live separately
    expect(await understandingFingerprint(A)).toEqual(beforeU);
  });
  it('T5 a founder claim conflicting with evidence coexists (both preserved)', async () => {
    const conflicted: ClarityResult = { ...advertisingScenarioResult(), conflicts: [{ founderClaim: 'We are the market leader.', evidence: 'Public evidence does not confirm a leadership position.' }] };
    const t = await service(new FixtureClarityModel(conflicted)).turn(A, 'we are the market leader, so I should run ads', null);
    const cr = await store().listClarityResults(A, t.concernId);
    const last = cr[cr.length - 1]!.result;
    expect(last.conflicts).toHaveLength(1);
    expect(last.conflicts[0]!.founderClaim).toMatch(/market leader/i);
    expect(last.conflicts[0]!.evidence).toMatch(/does not confirm/i);
  });
  it('T6 unknowns remain visible in the persisted result', async () => {
    const t = await service().turn(A, 'what don’t we know here?', null);
    const cr = await store().listClarityResults(A, t.concernId);
    expect(cr[cr.length - 1]!.result.unknowns.some((u) => /where prospects.*stop/i.test(u))).toBe(true);
  });
});

d('Clarity — ending, crystallization, and immutability', () => {
  it('T7 a clarity conversation may end with clarity only — no Strategy Thread is created', async () => {
    const t = await service().turn(A, 'just thinking out loud about ads', null);
    expect(await countRows(A, 'business.strategic_session')).toBe(0);
    const concern = await store().getConcern(A, t.concernId);
    expect(concern!.status).not.toBe('crystallized');
  });
  it('T8 a Strategy Thread is created ONLY after explicit crystallization', async () => {
    const t = await service().turn(A, 'ok, help me decide on ads', null);
    expect(await countRows(A, 'business.strategic_session')).toBe(0); // still none
    const sessionId = await crystallizeConcern(A, t.concernId, 'Should I invest in ads now, or first find where prospects drop off?', {
      store: store(), sessionRepo: new PgStrategicSessionRepository(db), snapshotRepo: new PgContextSnapshotRepository(db),
      captureContext: (fid) => captureEffectiveContext(fid, { assembler: assemblerDeps(), promotionRepo: new PgLearningPromotionRepository(db), learningRepo: new PgStrategicLearningRepository(db) }),
    });
    expect(sessionId).toBeTruthy();
    expect(await countRows(A, 'business.strategic_session')).toBe(1);
    const concern = await store().getConcern(A, t.concernId);
    expect(concern!.status).toBe('crystallized');
    expect(concern!.crystallizedSessionId).toBe(sessionId);
  });
  it('T9 crystallizing creates only the thread — no decision is recorded', async () => {
    expect(await countRows(A, 'business.strategic_decision_record')).toBe(0);
  });
  it('T10 the clarity result offers an alternative — the founder is never pushed to a single answer', async () => {
    const r = advertisingScenarioResult();
    expect(r.alternativeInterpretation.length).toBeGreaterThan(0);
    expect(r.possibleStrategicQuestion).toBeTruthy(); // a question is offered, not a verdict
  });
  it('T11 accepting a proposed change leaves strategy sessions/decisions untouched (only Understanding is affected)', async () => {
    const svc = service();
    const sessionsBefore = await countRows(A, 'business.strategic_session');
    const decisionsBefore = await countRows(A, 'business.strategic_decision_record');
    const t = await svc.turn(A, 'accept-immutability check', null);
    await svc.acceptProposedChange(A, t.proposedChanges[0]!.id);
    expect(await countRows(A, 'business.strategic_session')).toBe(sessionsBefore);
    expect(await countRows(A, 'business.strategic_decision_record')).toBe(decisionsBefore);
  });
});

d('Clarity — founder isolation + fail-closed contract', () => {
  it('T12 founder B cannot read founder A’s concern; B’s turn creates B’s own concern', async () => {
    const tA = await service().turn(A, 'A private concern about ads', null);
    expect(await store().getConcern(B, tA.concernId)).toBeNull();
    const tB = await service().turn(B, 'B has a different concern', null);
    expect(tB.concernId).not.toBe(tA.concernId);
    expect((await store().getConcern(A, tB.concernId))).toBeNull();
  });
  it('T14 a malformed model output fails closed: no assistant turn or proposed state persisted; founder text preserved', async () => {
    const svc = service(new FixtureClarityModel(null)); // model returns nothing usable
    const before = await countRows(A, 'business.clarity_result');
    const t = await svc.turn(A, 'this message must be preserved even when the model fails', null);
    expect(t.ok).toBe(false);
    expect(t.retry).toBe(true);
    expect(await countRows(A, 'business.clarity_result')).toBe(before); // no clarity result persisted
    const msgs = await store().listMessages(A, t.concernId);
    expect(msgs.some((m) => m.actor === 'FOUNDER' && /must be preserved/.test(m.content))).toBe(true); // founder text kept
    expect(msgs.some((m) => m.actor === 'BUSINESS_BRAIN')).toBe(false); // no assistant turn
  });
  it('T15 the validator fails closed on missing required fields (no half-built clarity)', () => {
    expect(normalizeClarityResult({ reflectedConcern: 'x' })).toBeNull();       // missing alt/next-move/limitation
    expect(normalizeClarityResult({})).toBeNull();
    expect(normalizeClarityResult(null)).toBeNull();
    const ok = normalizeClarityResult(advertisingScenarioResult());
    expect(ok).not.toBeNull();
    expect(ok!.clarifiedIssue).toBeTruthy();
  });
});

d('Clarity → Confirmed Understanding → Reused Context (accumulation loop)', () => {
  async function acceptOnce(founderId: string): Promise<{ concernId: string; itemId: string }> {
    const svc = service();
    const t = await svc.turn(founderId, 'ads pressure — is that the real issue?', null);
    const item = await svc.acceptProposedChange(founderId, t.proposedChanges[0]!.id);
    return { concernId: t.concernId, itemId: item!.id };
  }

  it('U1 accepting a proposal creates a durable, founder-governed Understanding item', async () => {
    const { itemId } = await acceptOnce(A);
    const item = await itemRepo().get(A, itemId);
    expect(item).toBeTruthy();
    expect(item!.origin).toBe('clarity_acceptance');
    expect(item!.statement).toMatch(/bottleneck is unconfirmed/i);
  });
  it('U2 acceptance is atomic — the proposal is accepted AND the item exists, linked both ways', async () => {
    const svc = service();
    const t = await svc.turn(A, 'atomic accept check', null);
    const changeId = t.proposedChanges[0]!.id;
    const item = await svc.acceptProposedChange(A, changeId);
    const change = await store().getProposedChange(A, changeId);
    expect(change!.status).toBe('accepted');
    expect((item)!.originProposedChangeId).toBe(changeId);   // item → proposal
    // proposal → item (resulting_understanding_item_id)
    const linked = await db.selectFrom('business.proposed_understanding_change').select('resulting_understanding_item_id').where('id', '=', changeId).executeTakeFirst();
    expect(linked!.resulting_understanding_item_id).toBe(item!.id);
  });
  it('U3 rejection creates NO Understanding item', async () => {
    const svc = service();
    const before = await countRows(A, 'business.understanding_item');
    const t = await svc.turn(A, 'reject this one', null);
    await svc.rejectProposedChange(A, t.proposedChanges[0]!.id);
    expect(await countRows(A, 'business.understanding_item')).toBe(before);
  });
  it('U4 the accepted item appears in the effective current Understanding', async () => {
    const { itemId } = await acceptOnce(A);
    const eff = composeEffectiveUnderstanding(await new PgUnderstandingRepository(db).latest(A), await itemRepo().listAll(A));
    expect(eff.current.some((i) => i.id === itemId)).toBe(true);
  });
  it('U5 the effective item carries the correct founder-facing truth label', async () => {
    const { itemId } = await acceptOnce(A);
    const eff = composeEffectiveUnderstanding(await new PgUnderstandingRepository(db).latest(A), await itemRepo().listAll(A));
    expect(eff.current.find((i) => i.id === itemId)!.label).toBe('unconfirmed_or_disagree');
  });
  it('U6 an accepted UNRESOLVED statement stays a disagreement — acceptance does not convert it to fact', async () => {
    const { itemId } = await acceptOnce(A);
    const eff = composeEffectiveUnderstanding(await new PgUnderstandingRepository(db).latest(A), await itemRepo().listAll(A));
    expect(eff.disagreements.some((i) => i.id === itemId)).toBe(true); // surfaced as unresolved, not asserted truth
  });
  it('U7 the original unknown ("where prospects stop") remains visible after acceptance', async () => {
    await acceptOnce(A);
    const eff = composeEffectiveUnderstanding(await new PgUnderstandingRepository(db).latest(A), await itemRepo().listAll(A));
    expect(eff.unknowns.some((u) => /where prospects.*(drop|stop)/i.test(u))).toBe(true);
  });
  it('U8 a founder correction supersedes a prior item WITHOUT deleting it (both in history)', async () => {
    const { itemId } = await acceptOnce(A);
    const svc = service();
    const corrected = await svc.correctUnderstanding(A, { supersedesItemId: itemId, statement: 'On reflection: inquiries clearly stall at the proposal stage.' });
    expect(corrected!.truthLabel).toBe('you_corrected_this');
    const chain = await itemRepo().history(A, corrected!.id);
    expect(chain.map((c) => c.id)).toContain(itemId);     // the superseded original is preserved in history
    expect(chain[chain.length - 1]!.id).toBe(corrected!.id);
    // the superseded item is no longer current; the correction is
    const current = await itemRepo().listCurrent(A);
    expect(current.some((i) => i.id === itemId)).toBe(false);
    expect(current.some((i) => i.id === corrected!.id)).toBe(true);
  });
  it('U9 historical Understanding items are immutable (append-only; no in-place UPDATE)', async () => {
    const { itemId } = await acceptOnce(A);
    await expect(db.updateTable('business.understanding_item').set({ statement: 'tampered' }).where('id', '=', itemId).execute())
      .rejects.toThrow(/append-only/i);
  });
  it('U10 later context retrieval uses the CORRECTED effective item, not the superseded one', async () => {
    const D = await signup(ED); await seedUnderstanding(D);   // fresh founder — clean, uncontaminated context
    const { itemId } = await acceptOnce(D);
    await service().correctUnderstanding(D, { supersedesItemId: itemId, statement: 'Corrected: the bottleneck is at the proposal stage.' });
    const ctx = await assembleClarityContextForTest(D);
    expect(ctx.conclusions.some((c) => /proposal stage/i.test(c.statement))).toBe(true);
    expect(ctx.conclusions.some((c) => c.statement === 'The current acquisition bottleneck is unconfirmed.')).toBe(false);
  });
  it('U11/U15 TWO-SESSION CONTINUITY — a second concern visibly draws on the accepted item from the first', async () => {
    const C = await signup(EC); await seedUnderstanding(C);
    // Session 1 — founder accepts "the acquisition bottleneck is unconfirmed"
    const s1 = service();
    const t1 = await s1.turn(C, 'Everyone says I need ads, but I don’t know whether ads are really the answer.', null);
    await s1.acceptProposedChange(C, t1.proposedChanges[0]!.id);
    // Session 2 — a marketer says double the ad budget; the model reflects the retrieved accepted understanding
    const s2 = service(new ContextEchoClarityModel());
    const t2 = await s2.turn(C, 'A marketer is now recommending that I double my ad budget. Should I?', null);
    const r = t2.result!;
    expect(r.relevantContextUsed.some((c) => /acquisition bottleneck is unconfirmed/i.test(c.statement))).toBe(true); // does not start from zero
    expect(r.clarifiedIssue).toMatch(/premature/i);            // doubling spend is premature
    expect(r.clarifiedIssue!.toLowerCase()).not.toMatch(/ads are wrong|don’t run ads|do not run ads/); // never claims ads are wrong
    expect(r.smallestUsefulNextMove).toMatch(/where prospects.*stop/i);
  });
  it('U12 cross-founder isolation for Understanding items + history', async () => {
    const { itemId } = await acceptOnce(A);
    expect(await itemRepo().get(B, itemId)).toBeNull();
    expect(await itemRepo().history(B, itemId)).toHaveLength(0);
    expect((await itemRepo().listCurrent(B)).some((i) => i.id === itemId)).toBe(false);
  });
  it('U13 a FAILED Understanding write does not leave the proposal accepted (atomic rollback)', async () => {
    // stub: reads (listCurrent, used by context retrieval) work; the WRITE (create) fails inside the acceptance tx.
    const failing = { listCurrent: async () => [], create: async () => { throw new Error('boom: understanding write failed'); } } as unknown as PgUnderstandingItemRepository;
    const svc = new ClarityService({ store: store(), model: new FixtureClarityModel(), understanding: new PgUnderstandingRepository(db), strategicContext: new PgFounderStrategicContextRepository(db), understandingItems: failing, db });
    const t = await svc.turn(A, 'this acceptance will fail to write', null);
    const changeId = t.proposedChanges[0]!.id;
    const itemsBefore = await countRows(A, 'business.understanding_item');
    await expect(svc.acceptProposedChange(A, changeId)).rejects.toThrow(/boom/);
    const change = await store().getProposedChange(A, changeId);
    expect(change!.status).toBe('pending');                     // proposal NOT accepted
    expect(await countRows(A, 'business.understanding_item')).toBe(itemsBefore); // no item created
  });
  it('U14 later Understanding updates do not change existing strategy sessions/decisions', async () => {
    const sessions = await countRows(A, 'business.strategic_session');
    const decisions = await countRows(A, 'business.strategic_decision_record');
    await acceptOnce(A);
    await service().correctUnderstanding(A, { statement: 'A brand-new founder-declared fact.' });
    expect(await countRows(A, 'business.strategic_session')).toBe(sessions);
    expect(await countRows(A, 'business.strategic_decision_record')).toBe(decisions);
  });
});

function assembleClarityContextForTest(founderId: string) {
  return assembleClarityContext(founderId, { understanding: new PgUnderstandingRepository(db), strategicContext: new PgFounderStrategicContextRepository(db), understandingItems: itemRepo() });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assemblerDeps(): any {
  return { understanding: new PgUnderstandingRepository(db), conclusionResponses: new PgConclusionResponseRepository(db), entities: new PgMarketEntityRepository(db), findings: new PgMarketFindingRepository(db), findingResponses: new PgMarketFindingResponseRepository(db), reviews: new PgMarketReviewRepository(db), strategicContext: new PgFounderStrategicContextRepository(db) };
}
