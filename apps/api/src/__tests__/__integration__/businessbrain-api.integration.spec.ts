/**
 * LIVE Business Brain V1 public API integration (Phase 6) — real HTTP over Fastify
 * inject against real Postgres. Env-gated on BB_IT_DATABASE_URL (throwaway DB).
 *
 *   docker compose -f docker-compose.test.yml up -d postgres-test
 *   docker compose -f docker-compose.test.yml run --rm migrate-test
 *   BB_IT_DATABASE_URL=postgresql://bbuser:bbpassword@localhost:5433/businessbrain_test \
 *     npm run test:integration:businessbrain
 *
 * Builds a minimal but REAL server: the app's own error-handler plugin + the real
 * Business Brain routes + real JwtService + real Kysely db. No mocked repository.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { generateId } from '@bb/shared';
import {
  createKyselyClient,
  type KyselyDB,
  JwtService,
  PgBusinessBrainRepository,
} from '@bb/infrastructure';
import {
  BusinessBrainCoordinator,
  deterministicImport,
  constructEvidence,
  deterministicDiagnosis,
} from '@bb/application';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { registerBusinessBrainRoutes } from '../../routes/businessbrain.routes';

const URL = process.env.BB_IT_DATABASE_URL;
const suite = URL ? describe : describe.skip;
const P = '/v1/businessbrain';

suite('LIVE Business Brain V1 public API', () => {
  let pool: Pool;
  let db: KyselyDB;
  let server: FastifyInstance;
  let jwt: JwtService;
  const seeded: string[] = [];

  const logger = { warn() {}, info() {}, error() {}, debug() {} } as unknown as never;

  async function seedFounder(): Promise<{ id: string; token: string }> {
    const id = generateId();
    await pool.query(
      `INSERT INTO founder.founders (id, email, name, business_name) VALUES ($1,$2,$3,$4)`,
      [id, `${id}@it.test`, 'IT', 'IT'],
    );
    seeded.push(id);
    const token = jwt.sign({ sub: id, role: 'founder', scopes: [] }).accessToken;
    return { id, token };
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const get = (url: string, token: string) => server.inject({ method: 'GET', url, headers: auth(token) });
  const post = (url: string, token: string, body?: unknown, extra?: Record<string, string>) =>
    server.inject({ method: 'POST', url, headers: { ...auth(token), ...(extra ?? {}) }, payload: body ?? {} });
  const body = (r: { body: string }) => JSON.parse(r.body);

  async function connect(token: string) {
    return post(`${P}/connection/connect`, token);
  }
  async function pollTerminal(token: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < 100; i += 1) {
      const s = body(await get(`${P}/refresh`, token));
      if (['completed', 'failed', 'cancelled'].includes(s.refreshState)) return s;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error('refresh did not reach a terminal state');
  }
  async function runHappyOverHttp(token: string): Promise<string> {
    await connect(token);
    await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    const term = await pollTerminal(token);
    expect(term.refreshState).toBe('completed');
    const cur = body(await get(`${P}/current`, token));
    return cur.versionId as string;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    db = createKyselyClient(URL!);
    const priv = readFileSync(join(process.cwd(), 'jwt-dev-private.pem'), 'utf8');
    const pub = readFileSync(join(process.cwd(), 'jwt-dev-public.pem'), 'utf8');
    jwt = new JwtService(priv, pub);
    server = Fastify();
    registerErrorHandler(server, logger);
    registerBusinessBrainRoutes(server, { db, jwtService: jwt, logger } as never);
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    if (seeded.length) await pool.query(`DELETE FROM founder.founders WHERE id = ANY($1)`, [seeded]);
    await db.destroy();
    await pool.end();
  });

  let founderId: string;
  let token: string;
  beforeEach(async () => {
    const f = await seedFounder();
    founderId = f.id;
    token = f.token;
  });

  it('1. Unauthenticated Get Current returns an authentication error (401)', async () => {
    const r = await server.inject({ method: 'GET', url: `${P}/current` });
    expect(r.statusCode).toBe(401);
    expect(body(r).error.code).toMatch(/AUTH/);
  });

  it('2. Authenticated Founder with no Current receives no_current_version', async () => {
    const r = await get(`${P}/current`, token);
    expect(r.statusCode).toBe(200);
    expect(body(r)).toEqual({ state: 'no_current_version' });
  });

  it('3. Start Refresh while disconnected returns INSTAGRAM_REQUIRED', async () => {
    const r = await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    expect(r.statusCode).toBe(409);
    expect(body(r).error.code).toBe('INSTAGRAM_REQUIRED');
  });

  it('4. Development Connect produces connected status', async () => {
    const r = await connect(token);
    expect(r.statusCode).toBe(200);
    expect(body(r).connectionState).toBe('connected');
  });

  it('5. Start Refresh with an idempotency token returns accepted (in_progress)', async () => {
    await connect(token);
    const r = await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    expect(r.statusCode).toBe(200);
    const s = body(r);
    expect(s.refreshState).toBe('in_progress');
    expect(s.refreshReference).toBeTruthy();
    await pollTerminal(token);
  });

  it('6. Repeating the same Start Refresh with the same token returns the same refresh_reference', async () => {
    await connect(token);
    const tok = generateId();
    const a = body(await post(`${P}/refresh`, token, { idempotencyToken: tok }));
    const b = body(await post(`${P}/refresh`, token, { idempotencyToken: tok }));
    expect(b.refreshReference).toBe(a.refreshReference);
    await pollTerminal(token);
  });

  it('7. Reusing the token with conflicting semantics returns IDEMPOTENCY_CONFLICT', async () => {
    await connect(token);
    const tok = generateId();
    await post(`${P}/refresh`, token, { idempotencyToken: tok, importMode: 'sufficient' });
    const r = await post(`${P}/refresh`, token, { idempotencyToken: tok, importMode: 'insufficient' });
    expect(r.statusCode).toBe(409);
    expect(body(r).error.code).toBe('IDEMPOTENCY_CONFLICT');
    await pollTerminal(token);
  });

  it('8. Concurrent duplicate Start Refresh calls create one Candidate/Current', async () => {
    await connect(token);
    const tok = generateId();
    const [a, b] = await Promise.all([
      post(`${P}/refresh`, token, { idempotencyToken: tok }),
      post(`${P}/refresh`, token, { idempotencyToken: tok }),
    ]);
    expect(body(a).refreshReference).toBe(body(b).refreshReference);
    await pollTerminal(token);
    const n = await pool.query(
      `SELECT count(*)::int n FROM businessbrain.bb_version WHERE founder_id=$1 AND lifecycle_status='current'`,
      [founderId],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it('9. Get Refresh Progress returns only a coherent allowed snapshot', async () => {
    await connect(token);
    await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    const s = body(await get(`${P}/refresh`, token));
    const allowed = new Set(['refreshReference', 'refreshState', 'importState', 'diagnosisState', 'validationState', 'failureCategory', 'transitionMarker']);
    for (const k of Object.keys(s)) expect(allowed.has(k)).toBe(true);
    await pollTerminal(token);
  });

  it('10. Start Refresh response contains no Candidate/Job/artifact/persistence IDs', async () => {
    await connect(token);
    const r = await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    const raw = r.body;
    for (const marker of ['candidateVersionId', 'versionId', 'importJobId', '-ei-', '-rc-', '-dv-', '-epv']) {
      expect(raw.includes(marker)).toBe(false);
    }
    await pollTerminal(token);
  });

  it('11. Get Current never exposes Candidate content (a non-promoting refresh never yields a Current)', async () => {
    // A Candidate exists transiently during this refresh, but validation fails so it is
    // never promoted. Get Current must remain no_current_version throughout and after —
    // the Candidate is never readable as a Current. (Deterministic: no promote race.)
    await connect(token);
    await post(`${P}/refresh`, token, { idempotencyToken: generateId(), flaw: 'omit_cannot_yet_know' });
    const term = await pollTerminal(token);
    expect(term.refreshState).toBe('failed');
    expect(body(await get(`${P}/current`, token))).toEqual({ state: 'no_current_version' });
  });

  it('12. Completed pipeline produces exactly one Current Version', async () => {
    const vid = await runHappyOverHttp(token);
    expect(vid).toBeTruthy();
    const n = await pool.query(
      `SELECT count(*)::int n FROM businessbrain.bb_version WHERE founder_id=$1 AND lifecycle_status='current'`,
      [founderId],
    );
    expect(n.rows[0].n).toBe(1);
  });

  it('13. Get Current returns the complete fixed-order public Version', async () => {
    await runHappyOverHttp(token);
    const cur = body(await get(`${P}/current`, token));
    expect(cur.businessReality).toBeTruthy();
    expect(cur.businessConsequences.length).toBeGreaterThanOrEqual(1);
    expect(cur.evidence.claims.length).toBeGreaterThanOrEqual(1);
    expect(cur.cannotYetKnow).toBeTruthy();
    expect(cur.rootCauses.length).toBeGreaterThanOrEqual(1);
    expect(cur.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(cur.executionPlan.length).toBeGreaterThanOrEqual(1);
    expect(cur.executionPlan[0].actions[0].sequence).toBe(1);
  });

  it('14. Get Current exposes Version ID but no internal artifact identifiers', async () => {
    const vid = await runHappyOverHttp(token);
    const raw = (await get(`${P}/current`, token)).body;
    expect(raw.includes(vid)).toBe(true); // versionId IS public
    for (const marker of ['-ei-', '-rc-', '-rec-', '-a-', '-ev', '-dv', '-bc-', '-ec-', '-epv', 'evidenceItemId', 'rootCauseId', 'diagnosisVersionId']) {
      expect(raw.includes(marker)).toBe(false);
    }
  });

  it('15. Failed Validation preserves the previous Current', async () => {
    const v1 = await runHappyOverHttp(token);
    await post(`${P}/refresh`, token, { idempotencyToken: generateId(), flaw: 'omit_cannot_yet_know' });
    const term = await pollTerminal(token);
    expect(term.refreshState).toBe('failed');
    expect(term.failureCategory).toBe('diagnosis_unavailable');
    expect(body(await get(`${P}/current`, token)).versionId).toBe(v1);
  });

  it('16. Cancel Refresh preserves Current', async () => {
    const v1 = await runHappyOverHttp(token);
    await post(`${P}/refresh/cancel`, token);
    expect(body(await get(`${P}/current`, token)).versionId).toBe(v1);
  });

  it('17. Cancel Refresh with no active Refresh is a harmless success', async () => {
    const r = await post(`${P}/refresh/cancel`, token);
    expect(r.statusCode).toBe(200);
  });

  it('18. Disconnect preserves Current', async () => {
    const v1 = await runHappyOverHttp(token);
    const d = await post(`${P}/connection/disconnect`, token);
    expect(body(d).connectionState).toBe('revoked');
    expect(body(await get(`${P}/current`, token)).versionId).toBe(v1);
  });

  it('20. Founder A cannot read Founder B’s Current', async () => {
    await runHappyOverHttp(token); // A has a Current
    const b = await seedFounder();
    const curB = body(await get(`${P}/current`, b.token));
    expect(curB).toEqual({ state: 'no_current_version' }); // B sees only its own (none)
  });

  it('21. Founder A cannot read or cancel Founder B’s Refresh', async () => {
    await connect(token);
    await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    const b = await seedFounder();
    const refreshB = body(await get(`${P}/refresh`, b.token));
    expect(refreshB.refreshState).toBe('none'); // not A's in-progress
    await post(`${P}/refresh/cancel`, b.token); // cannot affect A
    await pollTerminal(token); // A's refresh still completes on its own
  });

  it('23. Public API errors contain no SQL/internal diagnostic details', async () => {
    const r = await post(`${P}/refresh`, token); // disconnected -> INSTAGRAM_REQUIRED
    const raw = r.body.toLowerCase();
    for (const leak of ['select', 'insert', 'businessbrain.', 'pg', 'syntax', 'constraint', 'stack', 'at object']) {
      expect(raw.includes(leak)).toBe(false);
    }
  });

  // ---- Real-DB (non-HTTP) coordinator/repo assertions for inherently in-flight guarantees ----

  it('19. Disconnect during an active Refresh reconciles to connection_lost and preserves Current (repo, real DB)', async () => {
    const repo = new PgBusinessBrainRepository(db);
    const at = new Date().toISOString();
    // Establish a Current via a manual coordinator (inline runner, real DB).
    const coord = new BusinessBrainCoordinator(repo, { now: () => new Date(), nowISO: () => at, nowUnix: () => 0 }, 'inline');
    await repo.connect(founderId, at);
    await coord.startRefresh(founderId, { idempotencyToken: generateId() });
    const v1 = (await repo.getCurrentAggregate(founderId))!.versionId;
    // Start a fresh Candidate WITHOUT running its pipeline, then disconnect mid-flight.
    const versionId = generateId();
    await repo.startRefresh({ founderId, versionId, refreshReference: generateId(), importJobId: generateId(), at });
    await repo.disconnect(founderId, at);
    const snap = await repo.getRefreshProgress(founderId);
    expect(snap.refreshState).toBe('failed');
    expect(snap.failureCategory).toBe('connection_lost');
    expect((await repo.getCurrentAggregate(founderId))!.versionId).toBe(v1); // Current preserved
    expect(await repo.getActiveCandidateVersionId(founderId)).toBeNull(); // Candidate discarded
  });

  // ---- Runnable HTTP demonstration (§11). Opt-in: BB_DEMO=1 prints the public flow. ----
  it('DEMO. full public HTTP lifecycle over real Postgres', async () => {
    /* eslint-disable no-console */
    const log = process.env.BB_DEMO === '1' ? console.log : () => {};
    log('\n--- Business Brain V1 — public HTTP lifecycle ---');
    log('1. Get Session   :', body(await get(`${P}/session`, token)));
    log('2. Connect       :', body(await connect(token)));
    log('3. Get Current   :', body(await get(`${P}/current`, token)), '(no_current_version expected)');
    const accepted = body(await post(`${P}/refresh`, token, { idempotencyToken: generateId() }));
    log('4. Start Refresh :', accepted, '(accepted; not a Version)');
    log('5. Progress      :', body(await get(`${P}/refresh`, token)));
    const term = await pollTerminal(token);
    log('6. Terminal      :', term);
    const cur = body(await get(`${P}/current`, token));
    log('7. Get Current   : versionId =', cur.versionId, '| reality =', String(cur.businessReality).slice(0, 60) + '…');
    const raw = (await get(`${P}/current`, token)).body;
    const leaked = ['-ei-', '-rc-', '-dv', '-epv', 'evidenceItemId', 'candidateVersionId'].filter((m) => raw.includes(m));
    log('8. Internal ids leaked?:', leaked.length === 0 ? 'NONE' : leaked);
    expect(term.refreshState).toBe('completed');
    expect(cur.versionId).toBeTruthy();
    expect(leaked).toEqual([]);
    /* eslint-enable no-console */
  });

  it('22. Stale pipeline completion after Cancel writes nothing (repo, real DB)', async () => {
    const repo = new PgBusinessBrainRepository(db);
    const at = new Date().toISOString();
    const versionId = generateId();
    await repo.startRefresh({ founderId, versionId, refreshReference: generateId(), importJobId: generateId(), at });
    const ev = constructEvidence(versionId, founderId, deterministicImport('sufficient')).evidence!;
    await repo.commitImportSufficient({ founderId, versionId, evidence: ev, importJobId: generateId(), at });
    await repo.cancelAndDiscard(founderId, at); // discard the Candidate
    const diagnosis = deterministicDiagnosis(versionId, ev, 'none');
    const wrote = await repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis, diagnosisJobId: generateId(), at });
    expect(wrote).toBe(false); // stale guard: nothing written
    const n = await pool.query(`SELECT count(*)::int n FROM businessbrain.bb_diagnosis_version WHERE version_id=$1`, [versionId]);
    expect(n.rows[0].n).toBe(0);
  });
});
