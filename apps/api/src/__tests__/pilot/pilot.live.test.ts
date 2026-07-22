import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createKyselyClient } from '@bb/infrastructure';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { registerClarityRoutes } from '../../routes/clarity.routes';
import { registerPilotRoutes } from '../../routes/pilot.routes';
import { registerPilotAdminRoutes } from '../../routes/pilot-admin.routes';
import { deleteFounderAccount } from '../../account/delete.service';
import { PgPilotStore } from '../../pilot/pg-pilot.repository';
import { PgUnderstandingItemRepository } from '../../business-model/pg-understanding-item.repository';
import { csvCell, toCsv, classifyConcern } from '../../pilot/pilot.service';
import { assembleClarityContext } from '../../business-model/clarity-context';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgFounderStrategicContextRepository } from '../../business-model/pg-founder-strategic-context.repository';
import { PgClarityStore } from '../../business-model/pg-clarity.repository';
import { ClarityService } from '../../business-model/clarity.service';
import { FixtureClarityModel } from '../../business-model/clarity-model';

/**
 * Founder Validation Readiness §LIVE — invite/access, minimal setup, research instrumentation, feedback, facilitator notes,
 * admin authorization, safe export, and deletion/anonymization. Deterministic clarity via CLARITY_FIXTURE. Skip-guarded.
 */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const ADMIN = 'test-admin-token-123';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;
let db: AnyDB; let app: FastifyInstance; let dbUp = false; let emailN = 0;
const uniqEmail = (): string => `pilot.${++emailN}@loop.test`;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'], fix: process.env['CLARITY_FIXTURE'], adm: process.env['PILOT_ADMIN_TOKEN'], mode: process.env['PILOT_MODE'] };

async function purge(): Promise<void> {
  const rows = await db.selectFrom('identity.founders').select('founder_id').where('email', 'like', 'pilot.%@loop.test').execute();
  for (const r of rows as Array<{ founder_id: string }>) await deleteFounderAccount(r.founder_id, db).catch(() => {});
  await db.deleteFrom('pilot.invite').where('note', '=', 'BB-TEST').execute().catch(() => {});
}
async function signup(email: string): Promise<{ founderId: string; cookie: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'pilotpass-12' } });
  const founderId = res.json<{ founder_id: string }>().founder_id;
  const cookie = (res.cookies.find((c) => c.name === 'bb_session')?.value) ?? '';
  return { founderId, cookie: `bb_session=${cookie}` };
}
const store = (): PgPilotStore => new PgPilotStore(db);
async function makeInvite(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/admin/pilot/invites', headers: { 'x-pilot-admin-token': ADMIN }, payload: { cohort: 'pilot-test', count: 1, note: 'BB-TEST' } });
  return r.json<{ codes: string[] }>().codes[0]!;   // created with note 'BB-TEST' → found by purge
}
async function activatedFounder(email = uniqEmail()): Promise<{ founderId: string; cookie: string; code: string }> {
  const { founderId, cookie } = await signup(email);
  const code = await makeInvite();
  await app.inject({ method: 'POST', url: '/api/pilot/activate', headers: { cookie }, payload: { code, consentPilot: true, consentResearchReview: true } });
  return { founderId, cookie, code };
}

beforeAll(async () => {
  process.env['NODE_ENV'] = 'test'; process.env['DATABASE_URL'] = DB_URL; process.env['CLARITY_FIXTURE'] = '1'; process.env['PILOT_ADMIN_TOKEN'] = ADMIN; delete process.env['PILOT_MODE'];
  db = createKyselyClient(DB_URL);
  try { await sql`select 1`.execute(db); dbUp = true; } catch { dbUp = false; return; }
  app = Fastify();
  await app.register(async (api) => {
    registerSessionRoutes(api); registerAuthCredentialRoutes(api, {});
    registerClarityRoutes(api); registerPilotRoutes(api); registerPilotAdminRoutes(api);
  }, { prefix: '/api' });
  await app.ready();
  await purge();
}, 120_000);
afterAll(async () => {
  if (dbUp) { await purge(); await app?.close(); await db?.destroy(); }
  process.env['NODE_ENV'] = prev.node; process.env['DATABASE_URL'] = prev.db; process.env['CLARITY_FIXTURE'] = prev.fix; process.env['PILOT_ADMIN_TOKEN'] = prev.adm; if (prev.mode) process.env['PILOT_MODE'] = prev.mode; else delete process.env['PILOT_MODE'];
});

const d = describe.skipIf(!process.env['GATE_DB_URL'] && process.env['RUN_LIVE'] !== '1');

d('Pilot — validation readiness', () => {
  it('P1 invite creation, activation, and disable', async () => {
    const { cookie } = await signup(uniqEmail()); const code = await makeInvite();
    const act = await app.inject({ method: 'POST', url: '/api/pilot/activate', headers: { cookie }, payload: { code, consentPilot: true } });
    expect(act.statusCode).toBe(200);
    expect((await store().getInvite(code))!.status).toBe('activated');
    const dis = await app.inject({ method: 'POST', url: `/api/admin/pilot/invites/${code}/disable`, headers: { 'x-pilot-admin-token': ADMIN } });
    expect(dis.statusCode).toBe(200);
    expect((await store().getInvite(code))!.status).toBe('disabled');
  });
  it('P2 a disabled founder cannot access pilot data (PILOT_MODE)', async () => {
    const { founderId, cookie } = await activatedFounder();
    await store().updatePilotFounder(founderId, { accessStatus: 'disabled' }, new Date());
    process.env['PILOT_MODE'] = '1';
    const res = await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie }, payload: { input: 'should I run ads?' } });
    delete process.env['PILOT_MODE'];
    expect(res.statusCode).toBe(403);
    // data is NOT deleted — the founder row still exists
    expect(await store().getPilotFounder(founderId)).toBeTruthy();
  });
  it('P3 setup may remain incomplete', async () => {
    const { founderId, cookie } = await activatedFounder();
    const res = await app.inject({ method: 'POST', url: '/api/pilot/setup', headers: { cookie }, payload: { businessName: 'Acme', complete: false } });
    expect(res.statusCode).toBe(200);
    expect((await store().getPilotFounder(founderId))!.setupCompleted).toBe(false);
  });
  it('P4 the first concern can occur without full setup', async () => {
    const { cookie } = await activatedFounder();
    const res = await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie }, payload: { input: 'everyone says run ads but Im not sure' } });
    expect(res.statusCode).toBe(200); expect(res.json<{ ok: boolean }>().ok).toBe(true);
  });
  it('P5 research events do not modify Business Understanding', async () => {
    const { founderId, cookie } = await activatedFounder();
    const items = new PgUnderstandingItemRepository(db);
    const before = (await items.listAll(founderId)).length;
    await app.inject({ method: 'POST', url: '/api/pilot/reality', headers: { cookie }, payload: { concernId: 'x', marker: 'yes_now' } });
    await store().emitEvent(founderId, 'pilot-test', 'clarity_produced', null, {}, new Date());
    expect((await items.listAll(founderId)).length).toBe(before); // instrumentation touches no understanding
  });
  it('P6 founder feedback is optional (should-feedback advisory, never required)', async () => {
    const { cookie } = await activatedFounder();
    const t = await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie }, payload: { input: 'ads pressure again' } });
    const concernId = t.json<{ concernId: string }>().concernId;
    const due = await app.inject({ method: 'GET', url: `/api/pilot/should-feedback?concernId=${concernId}`, headers: { cookie } });
    expect(typeof due.json<{ due: boolean }>().due).toBe('boolean'); // advisory only; the turn already succeeded without it
  });
  it('P7 feedback cannot be recorded for another founder’s session', async () => {
    const a = await activatedFounder(); const b = await activatedFounder();
    const t = await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie: a.cookie }, payload: { input: 'A private concern' } });
    const aConcern = t.json<{ concernId: string }>().concernId;
    await app.inject({ method: 'POST', url: '/api/pilot/feedback', headers: { cookie: b.cookie }, payload: { concernId: aConcern, clearer: 'yes' } });
    expect(await store().getFeedback(a.founderId, aConcern)).toBeNull();       // A's session unaffected
    expect(await store().getFeedback(b.founderId, aConcern)).toBeTruthy();      // stored under B only
  });
  it('P8 facilitator notes never enter the AI context', async () => {
    const { founderId } = await activatedFounder();
    await store().addFacilitatorNote(founderId, null, 'facilitator', 'SECRET-NOTE the founder hesitated at entry', new Date());
    const ctx = await assembleClarityContext(founderId, { understanding: new PgUnderstandingRepository(db), strategicContext: new PgFounderStrategicContextRepository(db), understandingItems: new PgUnderstandingItemRepository(db) });
    expect(JSON.stringify(ctx)).not.toMatch(/SECRET-NOTE/);
  });
  it('P9 a second distinct concern is distinguished from a continuation', async () => {
    const { founderId } = await activatedFounder();
    const first = await classifyConcern(store(), founderId, true);
    await store().emitEvent(founderId, 'pilot-test', 'concern_submitted', 'c1', {}, new Date());
    const cont = await classifyConcern(store(), founderId, false);
    const second = await classifyConcern(store(), founderId, true);
    await store().emitEvent(founderId, 'pilot-test', 'concern_submitted', 'c2', {}, new Date());
    expect(first.kind).toBe('first'); expect(cont.kind).toBe('continuation'); expect(second.kind).toBe('new_distinct');
  });
  it('P10 context reuse is recorded across sessions', async () => {
    const { founderId, cookie } = await activatedFounder();
    const t1 = await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie }, payload: { input: 'run ads?' } });
    const pc = t1.json<{ proposedChanges: Array<{ id: string }> }>().proposedChanges[0]!;
    await app.inject({ method: 'POST', url: `/api/clarity/changes/${pc.id}/accept`, headers: { cookie } });
    await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie }, payload: { input: 'double the ad budget?' } });
    const reuse = await db.selectFrom('business.clarity_context_use').select('id').where('founder_id', '=', founderId).execute();
    expect((reuse as AnyDB[]).length).toBeGreaterThan(0);
  });
  it('P11 CSV export is safe from formula injection', () => {
    expect(csvCell('=cmd|calc')).toBe("'=cmd|calc");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@x')).toBe("'@x");
    expect(toCsv([{ a: '=danger', b: 'ok' }], ['a', 'b'])).toContain("'=danger");
  });
  it('P12 the default research export excludes raw business text', async () => {
    const { cookie } = await activatedFounder();
    await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie }, payload: { input: 'SENSITIVE-BUSINESS-SECRET tension about ads' } });
    const csv = await app.inject({ method: 'GET', url: '/api/admin/pilot/export.csv', headers: { 'x-pilot-admin-token': ADMIN } });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).not.toMatch(/SENSITIVE-BUSINESS-SECRET/); // raw concern text never in the research export
  });
  it('P13 admin endpoints are server-authorized', async () => {
    const noToken = await app.inject({ method: 'GET', url: '/api/admin/pilot/summary' });
    expect(noToken.statusCode).toBe(403);
    const badToken = await app.inject({ method: 'GET', url: '/api/admin/pilot/summary', headers: { 'x-pilot-admin-token': 'wrong' } });
    expect(badToken.statusCode).toBe(403);
    const ok = await app.inject({ method: 'GET', url: '/api/admin/pilot/summary', headers: { 'x-pilot-admin-token': ADMIN } });
    expect(ok.statusCode).toBe(200);
  });
  it('P14 the deliberate raw export is founder-scoped', async () => {
    const a = await activatedFounder(); const b = await activatedFounder();
    await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie: a.cookie }, payload: { input: 'AS-ONLY concern text' } });
    const raw = await app.inject({ method: 'GET', url: `/api/admin/pilot/founders/${b.founderId}/raw`, headers: { 'x-pilot-admin-token': ADMIN } });
    expect(raw.body).not.toMatch(/AS-ONLY/); // founder B's raw export contains none of founder A's content
  });
  it('P15 deletion removes personal pilot rows and anonymizes research events', async () => {
    const { founderId, cookie } = await activatedFounder();
    await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie }, payload: { input: 'delete-me concern' } });
    await store().emitEvent(founderId, 'pilot-test', 'clarity_produced', null, {}, new Date());
    await deleteFounderAccount(founderId, db);
    expect(await store().getPilotFounder(founderId)).toBeNull();                                   // personal row deleted
    const evs = await db.selectFrom('pilot.research_event').select('id').where('founder_id', '=', founderId).execute();
    expect((evs as AnyDB[]).length).toBe(0);                                                       // no events keyed to the founder
    const concerns = await db.selectFrom('business.concern').select('id').where('founder_id', '=', founderId).execute();
    expect((concerns as AnyDB[]).length).toBe(0);                                                  // clarity data deleted too
  });
  it('P16 the founder’s original concern survives an AI failure', async () => {
    // Drive the service with a model that fails (returns null) — the founder's message is preserved; no assistant turn saved.
    const { founderId } = await activatedFounder();
    const svc = new ClarityService({ store: new PgClarityStore(db), model: new FixtureClarityModel(null), understanding: new PgUnderstandingRepository(db), strategicContext: new PgFounderStrategicContextRepository(db), understandingItems: new PgUnderstandingItemRepository(db), db });
    const turn = await svc.turn(founderId, 'this must survive an AI failure', null);
    expect(turn.ok).toBe(false);
    const msgs = await db.selectFrom('business.concern_message').select(['content', 'actor']).where('founder_id', '=', founderId).execute();
    expect((msgs as AnyDB[]).some((m) => m.actor === 'FOUNDER' && /must survive/.test(m.content))).toBe(true); // founder text kept
    expect((msgs as AnyDB[]).some((m) => m.actor === 'BUSINESS_BRAIN')).toBe(false);                            // no assistant turn
  });
  it('P17 duplicate reality/feedback submission is idempotent', async () => {
    const { founderId, cookie } = await activatedFounder();
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/api/pilot/reality', headers: { cookie }, payload: { concernId: 'dup', marker: 'yes_now' } });
    const rows = await db.selectFrom('pilot.concern_reality').select('marker').where('founder_id', '=', founderId).where('concern_id', '=', 'dup').execute();
    expect((rows as AnyDB[]).length).toBe(1); // upsert → single row
  });
  it('P18 proposal acceptance remains atomic and emits an event', async () => {
    const { founderId, cookie } = await activatedFounder();
    const t = await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie }, payload: { input: 'ads?' } });
    const pc = t.json<{ proposedChanges: Array<{ id: string }> }>().proposedChanges[0]!;
    const acc = await app.inject({ method: 'POST', url: `/api/clarity/changes/${pc.id}/accept`, headers: { cookie } });
    expect(acc.statusCode).toBe(200);
    const events = await store().listEvents(founderId);
    expect(events.some((e) => e.eventType === 'proposal_accepted')).toBe(true);
  });
  it('P19 revalidation remains append-only', async () => {
    const { founderId } = await activatedFounder();
    const items = new PgUnderstandingItemRepository(db);
    const it = await items.create(founderId, { statement: 'A time-sensitive budget note', truthLabel: 'you_told_me', origin: 'clarity_acceptance' }, new Date());
    await items.recordRevalidation(founderId, it.id, 'confirmed', null, new Date());
    await items.recordRevalidation(founderId, it.id, 'unsure', null, new Date());
    expect((await items.listRevalidations(founderId)).filter((r) => r.understandingItemId === it.id)).toHaveLength(2); // append-only, both kept
  });
  it('P20 existing immutable clarity history is intact after pilot events', async () => {
    const { founderId, cookie } = await activatedFounder();
    await app.inject({ method: 'POST', url: '/api/clarity/turn', headers: { cookie }, payload: { input: 'immutability check concern' } });
    const cr = await db.selectFrom('business.clarity_result').select(['id', 'content_hash']).where('founder_id', '=', founderId).executeTakeFirst();
    await store().emitEvent(founderId, 'pilot-test', 'feedback_submitted', null, {}, new Date());
    const after = await db.selectFrom('business.clarity_result').select('content_hash').where('id', '=', cr!.id).executeTakeFirst();
    expect(after!.content_hash).toBe(cr!.content_hash);
  });
});
