import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Strategic Learning Lifecycle (ADR-012, single-thread). Drives the ACTUAL
 * controls: sign in, open threads + revision history, REFINE / CONTEST / SUPERSEDE / RETIRE through visible forms,
 * observe validation (no-op refine, broad-scope acknowledgement, server causal guard), retire terminality, refresh
 * persistence, and verify no relationship/contradiction UI. DB invariants confirm no downstream mutation. Requires the
 * dev DB + API on :3000 + vite (with /api proxy).
 */
// Unique founder per run so the per-founder rate budget is always fresh (repeated runs otherwise exhaust it).
const EMAIL = `lifecycle.e2e.${Date.now()}@understand.test`;
const PASSWORD = 'lifee2epass-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }

let founderId = '';
function seedThread(logicalId: string, over: Partial<{ statement: string; confidence: string; causal: boolean; counter: string; scope: string }> = {}): void {
  const o = { statement: 'Founder-led outreach converts at our stage.', confidence: 'SUPPORTED', causal: false, counter: 'one slow week', scope: 'THIS_CHANNEL', ...over };
  const counterJson = o.counter ? `["${o.counter}"]` : '[]';
  sql(`INSERT INTO business.strategic_learning_record (id, founder_id, logical_learning_id, revision, schema_version, lifecycle_action, root_learning_id, predecessor_learning_id, review_record_id, review_revision, plan_record_id, commitment_record_id, learning_statement, learning_category, confidence, prior_understanding, revised_understanding, change_statement, learning_scope, broad_scope_acknowledged, is_causal_hypothesis, boundary_conditions, counter_evidence, unresolved_unknowns, observations, evidence_references, founder_authored, model_suggested, accepted_by_founder, idempotency_key, created_at) VALUES ('${logicalId}','${founderId}','${logicalId}',1,'strategic-learning-1','CREATE','${logicalId}',NULL,'review-${logicalId}',1,'plan-${logicalId}','com-${logicalId}','${o.statement}','EXECUTION','${o.confidence}','Ads would be fastest.','Outreach is fastest.','Moved to outreach-first.','${o.scope}',false,${o.causal},'[]'::jsonb,'${counterJson}'::jsonb,'["does it scale"]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,false,true,'idem-${logicalId}',now());`);
}

test.beforeAll(async ({ request }) => {
  founderId = sql(`SELECT founder_id FROM identity.founders WHERE email='${EMAIL}';`);
  if (!founderId) { const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } }); founderId = (await res.json()).founder_id as string; }
  sql(`SET bb.allow_learning_delete='on'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}';`);
  seedThread('LC1REFINE00000000000000000001'); // refine + history + no-op + broad-scope validation
  seedThread('LC2CONTEST0000000000000000002', { counter: '' }); // contest (empty counterevidence → contest adds fresh)
  seedThread('LC3SUPERSEDE000000000000000003'); // supersede
  seedThread('LC4RETIRE00000000000000000004'); // retire
  seedThread('LC5CAUSAL00000000000000000005', { confidence: 'PROVISIONAL', causal: true }); // causal guard
});
test.afterAll(async () => {
  if (founderId) sql(`SET bb.allow_learning_delete='on'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}';`);
});

async function signIn(page: Page) {
  await page.goto('/signin');
  await page.getByRole('textbox').first().fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/signin') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  expect(resp.status(), 'sign-in must succeed (500 = auth rate-limit not reset)').toBe(200);
  await page.waitForURL((u) => !u.pathname.includes('/signin'), { timeout: 15_000 });
  await page.goto('/strategy');
  await expect(page.getByTestId('learnings-list')).toBeVisible();
}
const card = (page: Page, id: string) => page.getByTestId(`thread-${id}`);

test('founder drives the learning lifecycle through the rendered UI; history preserved; nothing else changes', async ({ page }) => {
  await signIn(page);

  // ── REFINE (steps 2–9): open thread, history, refine, both revisions visible, refresh persistence ──
  const t1 = card(page, 'LC1REFINE00000000000000000001');
  await t1.getByTestId('toggle-history').click();
  await expect(t1.getByTestId('revision-1')).toBeVisible();
  await t1.getByTestId('action-refine').click();
  await t1.getByTestId('refine-statement').fill('Founder-led outreach converts — for high-trust offers.');
  await t1.getByTestId('refine-reason').fill('Narrowing to the segment where it actually held.');
  // validation: same-learning not confirmed → server rejects
  await t1.getByTestId('refine-submit').click();
  await expect(t1.getByTestId('refine-error')).toBeVisible();
  await t1.getByTestId('refine-confirm-input').check();
  await t1.getByTestId('refine-submit').click();
  await expect(t1.getByTestId('lifecycle-status')).toHaveText('active');
  await page.reload();
  const t1b = card(page, 'LC1REFINE00000000000000000001');
  await t1b.getByTestId('toggle-history').click();
  await expect(t1b.getByTestId('revision-1')).toBeVisible();
  await expect(t1b.getByTestId('revision-2')).toBeVisible(); // both revisions survive refresh
  await expect(t1b.getByTestId('thread-source-review')).toBeVisible();
  await t1b.screenshot({ path: 'e2e/__evidence__/lifecycle-refined-history.png' }).catch(() => {});

  // ── validation: a no-op refine is rejected (step 23) ──
  await t1b.getByTestId('action-refine').click();
  await t1b.getByTestId('refine-reason').fill('no change');
  await t1b.getByTestId('refine-confirm-input').check();
  await t1b.getByTestId('refine-submit').click();
  await expect(t1b.getByTestId('refine-error')).toContainText(/refine must change/i);

  // ── CONTEST (steps 10–14): downgrade usability without a second learning/relationship ──
  const t2 = card(page, 'LC2CONTEST0000000000000000002');
  await t2.getByTestId('action-contest').click();
  await t2.getByTestId('contest-position').fill('I no longer trust the causal read here.');
  await t2.getByTestId('contest-counter').fill('seasonality may explain the lift');
  await t2.getByTestId('contest-reason').fill('A second look suggests confounding.');
  await t2.getByTestId('contest-submit').click();
  await expect(t2.getByTestId('lifecycle-status')).toHaveText('contested');
  await expect(page.getByText(/contradiction relationship|relationship layer|contradicts/i)).toHaveCount(0); // no relationship UI
  await t2.screenshot({ path: 'e2e/__evidence__/lifecycle-contested.png' }).catch(() => {});

  // ── independent threads coexist (steps 15–17): distinct logical ids, no auto contradiction relation ──
  await expect(card(page, 'LC1REFINE00000000000000000001')).toBeVisible();
  await expect(card(page, 'LC2CONTEST0000000000000000002')).toBeVisible();
  await expect(page.getByText(/automatic contradiction|link these learnings/i)).toHaveCount(0);

  // ── SUPERSEDE (steps 18–19): replacement + retained validity persisted ──
  const t3 = card(page, 'LC3SUPERSEDE000000000000000003');
  await t3.getByTestId('action-supersede').click();
  await t3.getByTestId('supersede-statement').fill('Outreach converts; warm intros convert best.');
  await t3.getByTestId('supersede-summary').fill('Sharper mechanism after more data.');
  await t3.getByTestId('supersede-retained').fill('Outreach still beats paid ads.');
  await t3.getByTestId('supersede-reason').fill('Replacing with a more precise formulation.');
  await t3.getByTestId('supersede-confirm-input').check();
  await t3.getByTestId('supersede-submit').click();
  await expect(t3.getByTestId('lifecycle-status')).toHaveText('active');
  await t3.getByTestId('toggle-history').click();
  await expect(t3.getByTestId('thread-history')).toContainText('Outreach still beats paid ads.');
  await t3.screenshot({ path: 'e2e/__evidence__/lifecycle-superseded.png' }).catch(() => {});

  // ── RETIRE (steps 20–22): terminal; action buttons gone ──
  const t4 = card(page, 'LC4RETIRE00000000000000000004');
  await t4.getByTestId('action-retire').click();
  await t4.getByTestId('retire-reason').fill('No longer relevant to the current strategy.');
  await t4.getByTestId('retire-submit').click();
  await expect(t4.getByTestId('lifecycle-status')).toHaveText('retired');
  await expect(t4.getByTestId('retired-note')).toBeVisible();
  await expect(t4.getByTestId('action-refine')).toHaveCount(0);
  await expect(t4.getByTestId('action-retire')).toHaveCount(0);
  await t4.screenshot({ path: 'e2e/__evidence__/lifecycle-retired.png' }).catch(() => {});

  // ── validation: causal strengthening violates the guard (step 25) ──
  const t5 = card(page, 'LC5CAUSAL00000000000000000005');
  await t5.getByTestId('action-refine').click();
  await t5.getByTestId('refine-reason').fill('I now think this is well supported.');
  // the causal thread is founder-reported-only; refining to SUPPORTED must be blocked. The refine form keeps confidence
  // as-is (PROVISIONAL) so we exercise the guard via the API contract in the DB assertions below; here we confirm the
  // form saved a valid provisional refine (no forbidden upgrade path is exposed in the UI).
  await t5.getByTestId('refine-statement').fill('Outreach causes conversion — provisionally.');
  await t5.getByTestId('refine-confirm-input').check();
  await t5.getByTestId('refine-submit').click();
  await expect(t5.getByTestId('lifecycle-status')).toHaveText('active');

  // ── causal guard via the authenticated session (step 25): SUPPORTED on a founder-reported-only causal claim → 400 ──
  const sourceId = sql(`SELECT id FROM business.strategic_learning_record WHERE logical_learning_id='LC5CAUSAL00000000000000000005' ORDER BY revision DESC LIMIT 1;`);
  const expectedRev = Number(sql(`SELECT max(revision) FROM business.strategic_learning_record WHERE logical_learning_id='LC5CAUSAL00000000000000000005';`));
  const guard = await page.request.post('/api/strategy/learnings/LC5CAUSAL00000000000000000005/refine', { data: { sourceRevisionId: sourceId, expectedRevision: expectedRev, idempotencyKey: 'causal-guard-1', lifecycleReason: 'trying to strengthen', confirmSameLearning: true, isCausalHypothesis: true, confidence: 'SUPPORTED' } });
  expect(guard.status()).toBe(400);
  expect((await guard.json()).reason).toBe('CAUSAL_CLAIM_UNSUPPORTED');
  // ── broad-scope guard (step 24): broadening to BUSINESS without acknowledgement → 400 BROAD_SCOPE_NOT_ACKNOWLEDGED ──
  const src1 = sql(`SELECT id FROM business.strategic_learning_record WHERE logical_learning_id='LC1REFINE00000000000000000001' ORDER BY revision DESC LIMIT 1;`);
  const rev1n = Number(sql(`SELECT max(revision) FROM business.strategic_learning_record WHERE logical_learning_id='LC1REFINE00000000000000000001';`));
  const broad = await page.request.post('/api/strategy/learnings/LC1REFINE00000000000000000001/refine', { data: { sourceRevisionId: src1, expectedRevision: rev1n, idempotencyKey: 'broad-1', lifecycleReason: 'this applies everywhere', confirmSameLearning: true, learningScope: 'BUSINESS' } });
  expect(broad.status()).toBe(400);
  expect((await broad.json()).reason).toBe('BROAD_SCOPE_NOT_ACKNOWLEDGED');

  await page.reload();
  await expect(page.getByTestId('learnings-list')).toBeVisible();

  // ── DB invariants (step 28) ──
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}' AND logical_learning_id='LC1REFINE00000000000000000001';`)).toBe('2'); // refine appended
  expect(sql(`SELECT lifecycle_action FROM business.strategic_learning_record WHERE founder_id='${founderId}' AND logical_learning_id='LC2CONTEST0000000000000000002' ORDER BY revision DESC LIMIT 1;`)).toBe('CONTEST');
  expect(sql(`SELECT lifecycle_action FROM business.strategic_learning_record WHERE founder_id='${founderId}' AND logical_learning_id='LC4RETIRE00000000000000000004' ORDER BY revision DESC LIMIT 1;`)).toBe('RETIRE');
  expect(sql(`SELECT count(*) FROM business.understanding WHERE founder_id='${founderId}';`)).toBe('0'); // BU untouched
  expect(sql(`SELECT count(*) FROM business.founder_strategic_context_item WHERE founder_id='${founderId}';`)).toBe('0'); // FSC untouched
  // no relationship table exists anywhere
  expect(sql(`SELECT count(*) FROM information_schema.tables WHERE table_schema='business' AND (table_name ~ 'relationship' OR table_name ~ 'contradiction' OR table_name ~ '_edge');`)).toBe('0');
});
