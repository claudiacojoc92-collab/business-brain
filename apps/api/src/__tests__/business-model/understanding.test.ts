import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createKyselyClient, PgEvidenceRepository } from '@bb/infrastructure';
import { makeFragment } from '@bb/domain';
import { registerSessionRoutes } from '../../routes/session.routes';
import { registerAccountRoutes } from '../../routes/account.routes';
import { registerAuthCredentialRoutes } from '../../routes/auth-credentials.routes';
import { registerUnderstandingRoutes } from '../../routes/understanding.routes';
import { PgUnderstandingRepository } from '../../business-model/pg-understanding.repository';
import { generateUnderstanding, type EngineOutcome } from '../../business-model/business-understanding.service';
import { normalizeConclusions, applyFounderResponse, assertUnderstandingWellFormed, type SynthesisModel, type RawConclusion, type Understanding } from '../../business-model/understanding';

/** Wave 2 — Business Understanding. Deterministic unit tests + live-DB service/route tests with a FAKE
 *  engine + FAKE synthesis model (no live LLM). Skip-guarded on DB. Frozen engine untouched. */

// ── Unit: normalization / banding / grounding (no DB) ─────────────────────────────────────────────────
describe('normalizeConclusions — grounding + banding, fail closed', () => {
  const src = ['f1', 'f2'];
  const id = (i: number) => `c${i}`;
  it('drops unknown type/status and empty statements', () => {
    const out = normalizeConclusions([
      { type: 'nope', statement: 'x', epistemicStatus: 'OBSERVED', evidenceRefs: ['f1'] },
      { type: 'what_it_is', statement: '', epistemicStatus: 'OBSERVED', evidenceRefs: ['f1'] },
      { type: 'what_it_is', statement: 'A clear thing', epistemicStatus: 'WRONG', evidenceRefs: ['f1'] },
    ] as RawConclusion[], src, id);
    expect(out).toHaveLength(0);
  });
  it('prunes dangling evidenceRefs and drops grounded bands left ungrounded (anti-fabrication)', () => {
    const out = normalizeConclusions([
      { type: 'what_it_is', statement: 'grounded', epistemicStatus: 'OBSERVED', evidenceRefs: ['f1', 'ghost'] },
      { type: 'what_it_offers', statement: 'ungrounded observed', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', evidenceRefs: ['ghost'] },
    ] as RawConclusion[], src, id);
    expect(out).toHaveLength(1);
    expect(out[0]!.evidenceRefs).toEqual(['f1']); // ghost pruned
  });
  it('MARKET-facing types can never be OBSERVED/SYNTHESIZED — downgraded to HYPOTHESIS', () => {
    const out = normalizeConclusions([
      { type: 'market_position', statement: 'we lead the market', epistemicStatus: 'OBSERVED', evidenceRefs: ['f1'] },
    ] as RawConclusion[], src, id);
    expect(out[0]!.epistemicStatus).toBe('HYPOTHESIS');
  });
  it('keeps a NEEDS_MORE_EVIDENCE conclusion even with no refs', () => {
    const out = normalizeConclusions([
      { type: 'missing_information', statement: 'no pricing visible', epistemicStatus: 'NEEDS_MORE_EVIDENCE' },
    ] as RawConclusion[], src, id);
    expect(out).toHaveLength(1);
  });
  it('caps at 9', () => {
    const many = Array.from({ length: 15 }, () => ({ type: 'strategic_question', statement: 'q', epistemicStatus: 'HYPOTHESIS' }));
    expect(normalizeConclusions(many as RawConclusion[], src, id)).toHaveLength(9);
  });
});

describe('assertUnderstandingWellFormed + applyFounderResponse', () => {
  const base: Understanding = { id: 'u1', founderId: 'f', version: 1, supersedesId: null, modelVersion: 'm', sourceFragmentIds: ['f1'], conclusions: [{ id: 'c0', type: 'what_it_is', statement: 's', epistemicStatus: 'OBSERVED', evidenceRefs: ['f1'], confidence: 'medium', confirmationState: 'pending', founderCorrection: null }], createdAt: '2026-07-19T00:00:00Z' };
  it('accepts a well-formed understanding', () => expect(() => assertUnderstandingWellFormed(base)).not.toThrow());
  it('throws on a dangling evidenceRef', () => expect(() => assertUnderstandingWellFormed({ ...base, conclusions: [{ ...base.conclusions[0]!, evidenceRefs: ['ghost'] }] })).toThrow(/dangling/));
  it('throws on a market conclusion in a demonstrated band', () => expect(() => assertUnderstandingWellFormed({ ...base, conclusions: [{ ...base.conclusions[0]!, type: 'market_position', epistemicStatus: 'OBSERVED' }] })).toThrow(/demonstrated band/));
  it('applyFounderResponse records the response + words; confirm clears correction', () => {
    const corrected = applyFounderResponse(base.conclusions, 'c0', 'corrected', '  actually X  ');
    expect(corrected[0]!).toMatchObject({ confirmationState: 'corrected', founderCorrection: 'actually X' });
    const confirmed = applyFounderResponse(base.conclusions, 'c0', 'confirmed', 'ignored');
    expect(confirmed[0]!.founderCorrection).toBeNull();
  });
});

// ── Live DB: service + routes with FAKE engine + FAKE synthesis model ──────────────────────────────────
const DB_URL = process.env['GATE_DB_URL'] ?? 'postgresql://bbuser:bbpassword@localhost:5432/businessbrain';
const E = { a: 'w2.a@understand.test', b: 'w2.b@understand.test', del: 'w2.del@understand.test', exp: 'w2.exp@understand.test', low: 'w2.low@understand.test' };
const EMAILS = Object.values(E);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any; let app: FastifyInstance; let dbUp = false;
const prev = { node: process.env['NODE_ENV'], db: process.env['DATABASE_URL'] };

const fakeEngine = async (): Promise<EngineOutcome> => ({ modelConfidence: 'thin', inferred: [{ category: 'contradictions', statement: 'says premium but lists budget prices' }] });
// A fake model that grounds two conclusions in the seeded fragments + one market over-claim (to be downgraded).
function fakeModel(fragIds: string[]): SynthesisModel {
  return {
    version: 'fake-1',
    synthesize: async () => ([
      { type: 'what_it_is', statement: 'A boutique branding studio for founders.', epistemicStatus: 'SYNTHESIZED_FROM_OBSERVED', evidenceRefs: [fragIds[0]], confidence: 'medium' },
      { type: 'who_it_addresses', statement: 'Early-stage solo founders.', epistemicStatus: 'OBSERVED', evidenceRefs: [fragIds[1] ?? fragIds[0]], confidence: 'high' },
      { type: 'market_position', statement: 'The leading studio in its category.', epistemicStatus: 'OBSERVED', evidenceRefs: [fragIds[0]], confidence: 'high' },
      { type: 'missing_information', statement: 'No pricing or offer structure is visible.', epistemicStatus: 'NEEDS_MORE_EVIDENCE', confidence: 'low' },
    ] as RawConclusion[]),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function purge(database: any): Promise<void> {
  const rows = await database.selectFrom('identity.founders').select('founder_id').where('email', 'in', EMAILS).execute();
  const ids = rows.map((r: { founder_id: string }) => r.founder_id);
  if (ids.length) {
    for (const t of ['business.understanding', 'evidence.fragments', 'identity.sessions']) await database.deleteFrom(t).where('founder_id', 'in', ids).execute();
  }
  await database.deleteFrom('identity.magic_link_tokens').where('email', 'in', EMAILS).execute();
  await database.deleteFrom('identity.founders').where('email', 'in', EMAILS).execute();
}
async function seedWebsite(founderId: string, marker: string): Promise<string[]> {
  const ev = new PgEvidenceRepository(db);
  const f1 = makeFragment({ founderId, source: 'website', sourceUrl: `https://${marker}.example/home`, confidenceKind: 'observed', visibility: 'public', payload: { text: `${marker} we craft brand identities` } });
  const f2 = makeFragment({ founderId, source: 'website', sourceUrl: `https://${marker}.example/about`, confidenceKind: 'observed', visibility: 'public', payload: { text: `${marker} for early-stage founders` } });
  await ev.appendMany([f1, f2]);
  return [f1.id, f2.id];
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
async function signIn(email: string) {
  let l = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'understand-1' } });
  if (l.statusCode === 409) l = await app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password: 'understand-1' } }); // reuse across tests
  return { cookie: cookieOf(l), founderId: l.json<{ founder_id: string }>().founder_id };
}

describe('Wave 2 understanding — service + routes (real DB, fake engine + model)', () => {
  it('generate: persists v1 with grounded, banded conclusions; market claim never demonstrated', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const evidence = new PgEvidenceRepository(db);
    const fragIds = await seedWebsite(A.founderId, 'ACME');
    const rep = new PgUnderstandingRepository(db);
    const out = await generateUnderstanding({ founderId: A.founderId, evidence, runEngine: fakeEngine, synthesisModel: fakeModel(fragIds), understanding: rep, now: new Date() });
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    const u = out.understanding;
    expect(u.version).toBe(1);
    expect(u.conclusions.length).toBeGreaterThanOrEqual(3);
    // every evidenceRef is a real source fragment (integrity)
    const src = new Set(u.sourceFragmentIds);
    for (const c of u.conclusions) for (const r of c.evidenceRefs) expect(src.has(r)).toBe(true);
    // the market conclusion was downgraded (never OBSERVED/SYNTHESIZED)
    const market = u.conclusions.find((c) => c.type === 'market_position')!;
    expect(['HYPOTHESIS', 'NEEDS_MORE_EVIDENCE']).toContain(market.epistemicStatus);
    // conclusions are synthesized statements, not raw fragment text
    expect(u.conclusions.every((c) => !c.statement.startsWith('ACME '))).toBe(true);
  });

  it('a Correct response persists declared input WITHOUT bumping the synthesis version (see conclusion-response.test for full semantics)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const A = await signIn(E.a);
    const evidence = new PgEvidenceRepository(db);
    const rep = new PgUnderstandingRepository(db);
    const latest = await rep.latest(A.founderId);
    if (!latest) { ctx.skip(); return; }
    const target = latest.conclusions[0]!;
    const res = await app.inject({ method: 'POST', url: '/api/understanding/respond', headers: { cookie: A.cookie }, payload: { conclusionId: target.id, response: 'corrected', correctionText: 'Actually a fractional CMO service' } });
    expect(res.statusCode).toBe(200);
    // synthesis version is UNCHANGED (no inflation); the response overlays it
    expect((await rep.latest(A.founderId))!.version).toBe(latest.version);
    // declared correction persisted as founder/declared evidence
    const declared = (await evidence.findByFounder(A.founderId)).filter((f) => f.source === 'founder' && f.confidenceKind === 'declared');
    expect(JSON.stringify(declared)).toContain('fractional CMO');
  });

  it('routes: 401 without session; GET latest; respond via HTTP; on-demand evidence is founder-scoped', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    expect((await app.inject({ method: 'GET', url: '/api/understanding' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/understanding/respond', payload: {} })).statusCode).toBe(401);
    const A = await signIn(E.a);
    const get = await app.inject({ method: 'GET', url: '/api/understanding', headers: { cookie: A.cookie } });
    expect(get.statusCode).toBe(200);
    const view = get.json<{ understanding: { conclusions: Array<{ id: string; evidenceRefs: string[]; statement: string }> } }>().understanding;
    expect(view.conclusions.length).toBeGreaterThan(0);
    // on-demand evidence: a real ref returns text; a foreign id 404s
    const ref = view.conclusions.find((c) => c.evidenceRefs.length)?.evidenceRefs[0];
    if (ref) { const ev = await app.inject({ method: 'GET', url: `/api/understanding/evidence/${ref}`, headers: { cookie: A.cookie } }); expect(ev.statusCode).toBe(200); }
    expect((await app.inject({ method: 'GET', url: '/api/understanding/evidence/nonexistent', headers: { cookie: A.cookie } })).statusCode).toBe(404);
    // respond validation: bad response → 400
    expect((await app.inject({ method: 'POST', url: '/api/understanding/respond', headers: { cookie: A.cookie }, payload: { conclusionId: view.conclusions[0]!.id, response: 'nope' } })).statusCode).toBe(400);
  });

  it('two-founder isolation: B never sees A’s understanding', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const B = await signIn(E.b);
    const bGet = await app.inject({ method: 'GET', url: '/api/understanding', headers: { cookie: B.cookie } });
    expect(bGet.statusCode).toBe(404); // B has none; A’s is not visible
  });

  it('insufficient evidence → honest not-yet (no fabrication)', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const L = await signIn(E.low);
    const rep = new PgUnderstandingRepository(db);
    const out = await generateUnderstanding({ founderId: L.founderId, evidence: new PgEvidenceRepository(db), runEngine: fakeEngine, synthesisModel: fakeModel(['x']), understanding: rep, now: new Date() });
    expect(out.status).toBe('insufficient_evidence');
  });

  it('export includes understanding; delete removes it to zero', async (ctx) => {
    if (!dbUp) { ctx.skip(); return; }
    const X = await signIn(E.exp);
    const evidence = new PgEvidenceRepository(db);
    const fragIds = await seedWebsite(X.founderId, 'EXPO');
    const rep = new PgUnderstandingRepository(db);
    await generateUnderstanding({ founderId: X.founderId, evidence, runEngine: fakeEngine, synthesisModel: fakeModel(fragIds), understanding: rep, now: new Date() });
    const exp = await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie: X.cookie } });
    expect(exp.json<{ understanding: unknown[] }>().understanding.length).toBeGreaterThan(0);
    const del = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: X.cookie }, payload: { confirmEmail: E.exp } });
    expect(del.statusCode).toBe(204);
    expect(await rep.latest(X.founderId)).toBeNull();
  });
});
