import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { makeFragment } from '@bb/domain';
import { generateId } from '@bb/shared';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { registerUnderstandingRoutes } from '../../routes/understanding.routes';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { PgConclusionResponseRepository } from '../../business-model/pg-conclusion-response.repository';
import type { Understanding } from '../../business-model/understanding';

/** Wave 2 item 4 — correction semantics. Seeds a known understanding directly (deterministic, no LLM), then
 *  drives Confirm/Partly/Correct/Reject + supersession over HTTP. Skip-guarded on DB. */
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E = { a: 'resp.a@understand.test', b: 'resp.b@understand.test', d: 'resp.d@understand.test' };
const EMAILS = Object.values(E);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) for (const t of ['business.conclusion_response', 'business.understanding', 'business.understanding_run', 'evidence.fragments', 'identity.sessions']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', EMAILS).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', EMAILS).execute();
}
/** Seed observed evidence + a known understanding v1 with two conclusions (one OBSERVED, one HYPOTHESIS). */
async function seedUnderstanding(founderId: string): Promise<{ obsId: string; c0: string; c1: string }> {
  const ev = new PgEvidenceRepository(db);
  const f = makeFragment({ founderId, source: 'website', sourceUrl: 'https://s.example/home', confidenceKind: 'observed', visibility: 'public', payload: { text: 'we do X for Y' } });
  await ev.appendMany([f]);
  const c0 = generateId(); const c1 = generateId();
  const u: Understanding = {
    id: generateId(), founderId, version: 1, supersedesId: null, modelVersion: 'seed-1', sourceFragmentIds: [f.id],
    conclusions: [
      { id: c0, type: 'what_it_is', statement: 'A service for founders.', epistemicStatus: 'OBSERVED', evidenceRefs: [f.id], confidence: 'high', confirmationState: 'pending', founderCorrection: null },
      { id: c1, type: 'strategic_question', statement: 'Is the niche intentional?', epistemicStatus: 'HYPOTHESIS', evidenceRefs: [], confidence: 'low', confirmationState: 'pending', founderCorrection: null },
    ],
    createdAt: new Date().toISOString(),
  };
  await new PgUnderstandingRepository(db).save(u);
  return { obsId: f.id, c0, c1 };
}

beforeAll(async () => {
  process.env['DATABASE_URL'] = DB_URL; process.env['NODE_ENV'] = 'test';
  try { db = createKyselyClient(DB_URL); await purge(db); dbUp = true; } catch { dbUp = false; }
  app = Fastify();
  await app.register(async (api) => { registerSessionRoutes(api); registerAuthCredentialRoutes(api); registerAccountRoutes(api); registerUnderstandingRoutes(api); }, { prefix: '/api' });
  await app.ready();
});
afterAll(async () => {
  try { await app?.close(); } catch { /* ignore */ }
  try { if (dbUp) await purge(db); } catch { /* ignore */ }
  try { await db?.destroy(); } catch { /* ignore */ }
  if (prev.node === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prev.node;
  if (prev.db === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = prev.db;
});
function cookieOf(res: Awaited<ReturnType<FastifyInstance['inject']>>): string { const raw = res.headers['set-cookie']; const c = (Array.isArray(raw) ? raw : [raw]).find((s) => typeof s === 'string' && s.startsWith('bb_session=')); if (!c) throw new Error('no cookie'); return c.split(';')[0]!; }
async function signIn(email: string) { let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'resppass-12' } }); if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'resppass-12' } }); return { cookie: cookieOf(l), founderId: l.json<{ founder_id: string }>().founder_id }; }
const respond = (cookie: string, payload: unknown) => app.inject({ method: 'POST', url: '/api/understanding/respond', headers: { cookie }, payload: payload as object });
const getU = async (cookie: string) => (await app.inject({ method: 'GET', url: '/api/understanding', headers: { cookie } })).json<{ understanding: { version: number; conclusions: Array<{ id: string; epistemicStatus: string; statement: string; response: { type: string; acceptedText: string | null; qualificationText: string | null; correctionText: string | null } | null }> } }>().understanding;
const declaredCount = async (fid: string) => (await new PgEvidenceRepository(db).findByFounder(fid)).filter((f) => f.source === 'founder' && f.confidenceKind === 'declared' && f.payload?.['kind'] !== 'block').length;

describe('conclusion response semantics (real DB)', () => {
  it('401 without a session', async (ctx) => { if (!dbUp) { ctx.skip(); return; } expect((await respond('', { conclusionId: 'x', response: 'confirmed' })).statusCode).toBe(401); });

  it('revisedEarlier flags a conclusion whose response replaced an earlier one; false when answered once (D3)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.d); const { c0, c1 } = await seedUnderstanding(A.founderId);         // dedicated founder (own understanding)
    await respond(A.cookie, { conclusionId: c0, response: 'confirmed' });                         // first answer
    await respond(A.cookie, { conclusionId: c0, response: 'corrected', correctionText: 'sharper' }); // revision (supersedes)
    await respond(A.cookie, { conclusionId: c1, response: 'confirmed' });                         // answered once
    const u = (await app.inject({ method: 'GET', url: '/api/understanding', headers: { cookie: A.cookie } }))
      .json<{ understanding: { conclusions: Array<{ id: string; response: { type: string; revisedEarlier: boolean } | null }> } }>().understanding;
    const r0 = u.conclusions.find((x) => x.id === c0)!.response;
    const r1 = u.conclusions.find((x) => x.id === c1)!.response;
    expect(r0?.type).toBe('corrected'); expect(r0?.revisedEarlier).toBe(true);   // revised
    expect(r1?.type).toBe('confirmed'); expect(r1?.revisedEarlier).toBe(false);  // answered once → not revised
  });

  it('Confirm: records acceptance, preserves epistemic status, creates NO declared evidence, no version bump', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const { c0 } = await seedUnderstanding(A.founderId);
    const before = await declaredCount(A.founderId);
    expect((await respond(A.cookie, { conclusionId: c0, response: 'confirmed' })).statusCode).toBe(200);
    const u = await getU(A.cookie);
    const c = u.conclusions.find((x) => x.id === c0)!;
    expect(c.response!.type).toBe('confirmed');
    expect(c.epistemicStatus).toBe('OBSERVED');       // unchanged — synthesis never becomes "more true"
    expect(u.version).toBe(1);                          // no inflation
    expect(await declaredCount(A.founderId)).toBe(before); // Confirm makes no declared fact
  });

  it('Correct: requires non-empty text; persists declared; original conclusion + evidence unchanged', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const u0 = await getU(A.cookie); const c0 = u0.conclusions[0]!;
    expect((await respond(A.cookie, { conclusionId: c0.id, response: 'corrected', correctionText: '   ' })).statusCode).toBe(400); // whitespace rejected
    const before = await declaredCount(A.founderId);
    expect((await respond(A.cookie, { conclusionId: c0.id, response: 'corrected', correctionText: 'It is actually X2 for Z' })).statusCode).toBe(200);
    const u = await getU(A.cookie);
    const c = u.conclusions.find((x) => x.id === c0.id)!;
    expect(c.response!.type).toBe('corrected');
    expect(c.response!.correctionText).toContain('X2 for Z');
    expect(c.statement).toBe(c0.statement);            // ORIGINAL synthesis unchanged
    expect(c.epistemicStatus).toBe(c0.epistemicStatus);// never relabeled to OBSERVED
    expect(await declaredCount(A.founderId)).toBe(before + 1); // one declared unit fragment (block is a separate kind)
  });

  it('Partly: stores accepted + qualification SEPARATELY; needs the qualification', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const u0 = await getU(A.cookie); const c1 = u0.conclusions[1]!;
    expect((await respond(A.cookie, { conclusionId: c1.id, response: 'partly', acceptedText: 'the niche part is right' })).statusCode).toBe(400); // no qualification → 400
    expect((await respond(A.cookie, { conclusionId: c1.id, response: 'partly', acceptedText: 'niche is right', qualificationText: 'but not the audience' })).statusCode).toBe(200);
    const c = (await getU(A.cookie)).conclusions.find((x) => x.id === c1.id)!;
    expect(c.response!.type).toBe('partly');
    expect(c.response!.acceptedText).toContain('niche is right');
    expect(c.response!.qualificationText).toContain('not the audience'); // distinct fields, not one note
  });

  it('Reject: records rejection, creates no inverse claim and no declared fact', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const u0 = await getU(A.cookie); const c0 = u0.conclusions[0]!;
    const before = await declaredCount(A.founderId);
    expect((await respond(A.cookie, { conclusionId: c0.id, response: 'rejected' })).statusCode).toBe(200);
    const c = (await getU(A.cookie)).conclusions.find((x) => x.id === c0.id)!;
    expect(c.response!.type).toBe('rejected');
    expect(c.statement).toBe(c0.statement);            // no inverse claim generated
    expect(await declaredCount(A.founderId)).toBe(before); // no declared fact without founder text
  });

  it('Supersession: latest effective is deterministic; prior preserved in history; export has both; refresh stable', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const u0 = await getU(A.cookie); const c1 = u0.conclusions[1]!;
    await respond(A.cookie, { conclusionId: c1.id, response: 'confirmed' });
    await respond(A.cookie, { conclusionId: c1.id, response: 'corrected', correctionText: 'final answer' });
    const eff = (await getU(A.cookie)).conclusions.find((x) => x.id === c1.id)!.response!;
    expect(eff.type).toBe('corrected'); expect(eff.correctionText).toContain('final answer'); // deterministic latest
    // exactly one effective response for c1 in the repo
    const effMap = await new PgConclusionResponseRepository(db).effectiveByConclusion(A.founderId);
    expect(effMap.get(c1.id)!.type).toBe('corrected');
    // export includes FULL history (>=2 responses for c1, the earlier superseded)
    const exp = (await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie: A.cookie } })).json<{ conclusionResponses: Array<{ conclusionId: string; supersededBy: string | null }> }>();
    const forC1 = exp.conclusionResponses.filter((r) => r.conclusionId === c1.id);
    expect(forC1.length).toBeGreaterThanOrEqual(2);
    expect(forC1.filter((r) => r.supersededBy === null).length).toBe(1); // exactly one effective
    // refresh (fresh GET) still deterministic
    expect((await getU(A.cookie)).conclusions.find((x) => x.id === c1.id)!.response!.type).toBe('corrected');
  });

  it('Isolation: founder B cannot respond to or read A’s conclusions', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a); const u0 = await getU(A.cookie); const cA = u0.conclusions[0]!.id;
    const B = await signIn(E.b);
    expect((await respond(B.cookie, { conclusionId: cA, response: 'confirmed' })).statusCode).toBe(404); // B has no understanding with A's conclusion
    expect((await app.inject({ method: 'GET', url: '/api/understanding', headers: { cookie: B.cookie } })).statusCode).toBe(404);
  });

  it('delete removes the response history', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: A.cookie }, payload: { confirmEmail: E.a } });
    const left = await new PgConclusionResponseRepository(db).listByFounder(A.founderId);
    expect(left).toHaveLength(0);
  });
});
