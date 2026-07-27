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
  buildDeterministicEvidence,
  computeAccountMetrics,
  computePostSignals,
  assembleGenerationContext,
  composeDiagnosisContent,
} from '@bb/application';
import type {
  DiagnosisModelPort, DiagnosisResult, GenerationContext, ImportedAccount, InstagramImportPort, ObservationRecord,
} from '@bb/application';
import { registerErrorHandler } from '../../plugins/error-handler.plugin';
import { registerBusinessBrainRoutes } from '../../routes/businessbrain.routes';
import { __resetInstagramConnectorForTest } from '../../connectors/instagram/instagram-connector.instance';

// ── Test doubles for the Phase ② ports (no real Graph / Anthropic). Behaviour is mutable per test. ──
let importPostCount = 12;                                    // controls sufficiency (>=5 sufficient)
type DiagMode = 'valid' | 'invalid' | 'fabricated' | 'throw';
let diagnosisMode: DiagMode = 'valid';

function fakeAccount(n: number): ImportedAccount {
  const base = Date.parse('2025-01-01T00:00:00.000Z');
  const posts = Array.from({ length: n }, (_, i) => ({
    postExternalId: `m${i}`,
    permalink: `https://instagram.com/p/m${i}`,
    mediaType: i % 3 === 0 ? 'VIDEO' : 'IMAGE',
    postedAt: new Date(base + i * 3 * 86_400_000).toISOString(),
    caption: i % 2 === 0 ? `A day in my life ✨ #life` : `Behind the scenes of my work. link in bio`,
    reach: 100 + i,
    likes: 10 + i,
    comments: i % 4,
  }));
  return { accountExternalId: 'ig1', username: 'founder', accountType: 'BUSINESS', followersCount: 1200, mediaCount: n, posts, importedAt: '2025-07-01T00:00:00.000Z' };
}
const fakeImport: InstagramImportPort = { async importAccount() { return fakeAccount(importPostCount); } };

// A grounded, business-language narrative (no digits/channel words), citing a real deterministic key.
function validNarrative(ctx: GenerationContext) {
  const key = ctx.evidence.find((e) => e.key === 'cta_pct')?.key ?? ctx.evidence[0]!.key;
  return {
    businessReality: 'Your business is hard for the right buyers to recognise and choose.',
    businessConsequences: ['The right customers rarely realise you can help them.', 'People who like you have no clear way to become buyers.'],
    cannotYetKnow: 'We cannot yet see your actual sales, or what your audience privately thinks.',
    rootCauses: [{ statement: 'Your offer is not made plain enough for people to act on it.', evidenceKeys: [key] }],
    recommendations: [{ statement: 'State your offer clearly and invite people to take one next step.', rootCauseIndexes: [0] }],
    executionPlan: [{ label: 'Weeks one to four: make the offer legible', actions: [{ statement: 'Introduce a recurring, clear invitation to work with you.', recommendationIndexes: [0] }] }],
  };
}
const fakeDiagnosis: DiagnosisModelPort = {
  async generate(ctx: GenerationContext): Promise<DiagnosisResult> {
    if (diagnosisMode === 'throw') throw new Error('model unavailable');
    const n = validNarrative(ctx);
    if (diagnosisMode === 'invalid') return { narrative: { ...n, cannotYetKnow: '' }, modelId: 'test-model', promptTemplateHash: 'h' };
    if (diagnosisMode === 'fabricated') return { narrative: { ...n, businessReality: 'Your business converts 87 of every hundred admirers into nothing.' }, modelId: 'test-model', promptTemplateHash: 'h' };
    return { narrative: n, modelId: 'test-model', promptTemplateHash: 'h' };
  },
};

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

  // Begin the REAL Instagram connect — returns the provider consent URL (no network; builds a URL).
  async function connect(token: string) {
    return post(`${P}/connection/connect`, token);
  }
  // Establish a REAL connected state without performing OAuth: insert an encrypted-credential row
  // exactly as the OAuth callback would. getConnectionStatus is a presence read (never decrypts),
  // so a placeholder ciphertext is sufficient to make the founder "connected" for the gate.
  async function seedConnected(fid: string): Promise<void> {
    await pool.query(
      `INSERT INTO app.oauth_credentials (founder_id, provider, encrypted_access_token, scopes, created_at, updated_at)
       VALUES ($1,'instagram','enc:placeholder','instagram_business_basic', NOW(), NOW())
       ON CONFLICT (founder_id, provider) DO UPDATE SET updated_at = NOW()`,
      [fid],
    );
  }
  async function credentialRows(fid: string): Promise<number> {
    const r = await pool.query(
      `SELECT count(*)::int n FROM app.oauth_credentials WHERE founder_id=$1 AND provider='instagram'`,
      [fid],
    );
    return r.rows[0].n as number;
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
    await seedConnected(founderId);
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
    // Configure the shared Instagram connector so /connection/connect returns a real consent URL
    // (authorize() builds a URL only — no network). disconnect() uses the credential store on the
    // test DB. These are the same env vars production reads.
    process.env['INSTAGRAM_APP_ID'] = process.env['INSTAGRAM_APP_ID'] || 'test-ig-app-id';
    process.env['INSTAGRAM_APP_SECRET'] = process.env['INSTAGRAM_APP_SECRET'] || 'test-ig-app-secret';
    process.env['INSTAGRAM_REDIRECT_URI'] = 'https://app.example.com/api/sources/instagram/callback';
    process.env['GOOGLE_OAUTH_ENCRYPTION_KEY'] = '0'.repeat(64);
    process.env['DATABASE_URL'] = URL!;
    __resetInstagramConnectorForTest();
    server = Fastify();
    registerErrorHandler(server, logger);
    registerBusinessBrainRoutes(server, { db, jwtService: jwt, logger } as never, { importPort: fakeImport, diagnosisModel: fakeDiagnosis });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    if (seeded.length) {
      await pool.query(`DELETE FROM app.oauth_credentials WHERE founder_id = ANY($1)`, [seeded]);
      await pool.query(`DELETE FROM founder.founders WHERE id = ANY($1)`, [seeded]);
    }
    await db.destroy();
    await pool.end();
    __resetInstagramConnectorForTest();
  });

  let founderId: string;
  let token: string;
  beforeEach(async () => {
    importPostCount = 12;
    diagnosisMode = 'valid';
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

  it('4. Connect returns a real Instagram Business Login consent URL (no fake connection state)', async () => {
    const r = await connect(token);
    expect(r.statusCode).toBe(200);
    const authUrl = body(r).authUrl as string;
    expect(authUrl).toContain('instagram.com/oauth/authorize');
    expect(authUrl).toContain('client_id=test-ig-app-id');
    expect(authUrl).toContain('instagram_business_basic');
    // Connect must NOT itself mark the founder connected — only the OAuth callback (real credential) does.
    expect(await credentialRows(founderId)).toBe(0);
    expect(body(await get(`${P}/connection`, token)).connectionState).toBe('not_connected');
  });

  it('4b. Get Connection reflects a real stored credential; refresh is then allowed', async () => {
    expect(body(await get(`${P}/connection`, token)).connectionState).toBe('not_connected');
    await seedConnected(founderId);
    const c = body(await get(`${P}/connection`, token));
    expect(c.connectionState).toBe('connected');
    expect(c.connectedAt).toBeTruthy();
    const r = await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    expect(r.statusCode).toBe(200); // gate passes with a real credential
    await pollTerminal(token);
  });

  it('5. Start Refresh with an idempotency token returns accepted (in_progress)', async () => {
    await seedConnected(founderId);
    const r = await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    expect(r.statusCode).toBe(200);
    const s = body(r);
    expect(s.refreshState).toBe('in_progress');
    expect(s.refreshReference).toBeTruthy();
    await pollTerminal(token);
  });

  it('6. Repeating the same Start Refresh with the same token returns the same refresh_reference', async () => {
    await seedConnected(founderId);
    const tok = generateId();
    const a = body(await post(`${P}/refresh`, token, { idempotencyToken: tok }));
    const b = body(await post(`${P}/refresh`, token, { idempotencyToken: tok }));
    expect(b.refreshReference).toBe(a.refreshReference);
    await pollTerminal(token);
  });

  it('7. Reusing the token with conflicting semantics returns IDEMPOTENCY_CONFLICT', async () => {
    await seedConnected(founderId);
    const tok = generateId();
    await post(`${P}/refresh`, token, { idempotencyToken: tok, importMode: 'sufficient' });
    const r = await post(`${P}/refresh`, token, { idempotencyToken: tok, importMode: 'insufficient' });
    expect(r.statusCode).toBe(409);
    expect(body(r).error.code).toBe('IDEMPOTENCY_CONFLICT');
    await pollTerminal(token);
  });

  it('8. Concurrent duplicate Start Refresh calls create one Candidate/Current', async () => {
    await seedConnected(founderId);
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
    await seedConnected(founderId);
    await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    const s = body(await get(`${P}/refresh`, token));
    const allowed = new Set(['refreshReference', 'refreshState', 'importState', 'diagnosisState', 'validationState', 'failureCategory', 'transitionMarker']);
    for (const k of Object.keys(s)) expect(allowed.has(k)).toBe(true);
    await pollTerminal(token);
  });

  it('10. Start Refresh response contains no Candidate/Job/artifact/persistence IDs', async () => {
    await seedConnected(founderId);
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
    diagnosisMode = 'invalid'; // model returns an ungrounded/invalid diagnosis → validation discards it
    await seedConnected(founderId);
    await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
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
    diagnosisMode = 'invalid';
    await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
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

  it('18. Disconnect removes the real credential and preserves Current', async () => {
    const v1 = await runHappyOverHttp(token);
    expect(await credentialRows(founderId)).toBe(1);
    const d = await post(`${P}/connection/disconnect`, token);
    expect(body(d).connectionState).toBe('not_connected'); // real credential gone
    expect(await credentialRows(founderId)).toBe(0);
    expect(body(await get(`${P}/current`, token)).versionId).toBe(v1); // Current untouched
    // Refresh is blocked again once disconnected.
    const r = await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    expect(r.statusCode).toBe(409);
    expect(body(r).error.code).toBe('INSTAGRAM_REQUIRED');
  });

  it('20. Founder A cannot read Founder B’s Current', async () => {
    await runHappyOverHttp(token); // A has a Current
    const b = await seedFounder();
    const curB = body(await get(`${P}/current`, b.token));
    expect(curB).toEqual({ state: 'no_current_version' }); // B sees only its own (none)
  });

  it('21. Founder A cannot read or cancel Founder B’s Refresh', async () => {
    await seedConnected(founderId);
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
    const coord = new BusinessBrainCoordinator(repo, { now: () => new Date(), nowISO: () => at, nowUnix: () => 0 }, fakeImport, fakeDiagnosis, 'inline');
    await seedConnected(founderId); // real encrypted credential (presence) satisfies the gate
    await coord.startRefresh(founderId, { idempotencyToken: generateId() });
    const v1 = (await repo.getCurrentAggregate(founderId))!.versionId;
    // Start a fresh Candidate WITHOUT running its pipeline, then disconnect mid-flight.
    const versionId = generateId();
    await repo.startRefresh({ founderId, versionId, refreshReference: generateId(), importJobId: generateId(), at });
    await repo.discardActiveCandidateOnDisconnect(founderId, at);
    const snap = await repo.getRefreshProgress(founderId);
    expect(snap.refreshState).toBe('failed');
    expect(snap.failureCategory).toBe('connection_lost');
    expect((await repo.getCurrentAggregate(founderId))!.versionId).toBe(v1); // Current preserved
    expect(await repo.getActiveCandidateVersionId(founderId)).toBeNull(); // Candidate discarded
  });

  it('P2-A. A completed refresh persists the provenance store and surfaces the import window', async () => {
    await runHappyOverHttp(token);
    const vid = (await pool.query(`SELECT version_id FROM businessbrain.bb_version WHERE founder_id=$1 AND lifecycle_status='current'`, [founderId])).rows[0].version_id;
    const imp = (await pool.query(`SELECT * FROM businessbrain.bb_import WHERE version_id=$1`, [vid])).rows[0];
    expect(imp.imported_post_count).toBe(importPostCount);
    expect(imp.window_from).toBeTruthy();
    expect(imp.window_to).toBeTruthy();
    const obs = await pool.query(`SELECT count(*)::int n, bool_or(caption <> '') has_caption FROM businessbrain.bb_observation WHERE version_id=$1`, [vid]);
    expect(obs.rows[0].n).toBe(importPostCount);        // one observation per imported post
    expect(obs.rows[0].has_caption).toBe(true);          // full captions persisted
    const gc = (await pool.query(`SELECT content_hash, model_id FROM businessbrain.bb_generation_context WHERE version_id=$1`, [vid])).rows[0];
    expect(gc.content_hash).toMatch(/^[0-9a-f]{64}$/);   // SHA-256 of the frozen model input
    const prov = await pool.query(`SELECT count(*)::int n FROM businessbrain.bb_evidence_item WHERE version_id=$1 AND provenance IS NOT NULL`, [vid]);
    expect(prov.rows[0].n).toBeGreaterThan(0);           // every measure carries provenance
    // Public output surfaces the imported window (item 11).
    const cur = body(await get(`${P}/current`, token));
    expect(cur.importWindow.postCount).toBe(importPostCount);
    expect(cur.importWindow.from).toBeTruthy();
  });

  it('P2-B. Grounding rejects a fabricated number → the candidate is discarded, no Current', async () => {
    diagnosisMode = 'fabricated'; // narrative contains a number the metrics never produced
    await seedConnected(founderId);
    await post(`${P}/refresh`, token, { idempotencyToken: generateId() });
    const term = await pollTerminal(token);
    expect(term.refreshState).toBe('failed');
    expect(body(await get(`${P}/current`, token))).toEqual({ state: 'no_current_version' });
  });

  // ---- Runnable HTTP demonstration (§11). Opt-in: BB_DEMO=1 prints the public flow. ----
  it('DEMO. full public HTTP lifecycle over real Postgres', async () => {
    /* eslint-disable no-console */
    const log = process.env.BB_DEMO === '1' ? console.log : () => {};
    log('\n--- Business Brain V1 — public HTTP lifecycle ---');
    log('1. Get Session   :', body(await get(`${P}/session`, token)));
    log('2. Connect       :', body(await connect(token)), '(returns the real Instagram consent URL)');
    await seedConnected(founderId); // stand in for completing the real OAuth callback (encrypted credential)
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
    const acct = fakeAccount(12);
    const obs: ObservationRecord[] = acct.posts.map((p) => ({ observationId: generateId(), ...p, ...computePostSignals(p.caption) }));
    const metrics = computeAccountMetrics(obs, acct.followersCount);
    const built = buildDeterministicEvidence(versionId, founderId, metrics, obs);
    const ev = built.evidence!;
    await repo.commitImportSufficient({ founderId, versionId, evidence: ev, importJobId: generateId(), at });
    await repo.cancelAndDiscard(founderId, at); // discard the Candidate
    const ctx = assembleGenerationContext(acct, metrics, obs, ev.items);
    const diagnosis = composeDiagnosisContent(versionId, validNarrative(ctx), ev, built.claims!);
    const wrote = await repo.commitCandidateDiagnosis({ founderId, versionId, diagnosis, diagnosisJobId: generateId(), at });
    expect(wrote).toBe(false); // stale guard: nothing written
    const n = await pool.query(`SELECT count(*)::int n FROM businessbrain.bb_diagnosis_version WHERE version_id=$1`, [versionId]);
    expect(n.rows[0].n).toBe(0);
  });
});
