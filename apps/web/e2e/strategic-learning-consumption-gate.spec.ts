import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Consumption Gate REMEDIATION (ADR-014 amendment) — the MANDATORY gate. Drives
 * ACTUAL controls: sign in → the ask box's Generate is disabled with no snapshot → create a Context Snapshot → inspect its
 * SHA-256 hash + frozen summary → select it → generate (the session binds to that exact snapshot; server-resolved
 * provenance recorded) → change the current context (REMOVE a promotion) → the snapshot is unchanged and a new snapshot
 * differs → a legacy (null-snapshot) session is labelled not-reproducible with no live-regenerate. No direct fetch for the
 * gate flow. Requires dev DB + API on :3000 + vite (/api proxy).
 */
const EMAIL = `consume.gate.${Date.now()}@understand.test`;
const PASSWORD = 'consumegatepass-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
const THREAD = 'CONSUMEGATE1LEARNING000000000001';
const PROMO = 'CONSUMEGATE1PROMO00000000000001';
let founderId = '';

test.beforeAll(async ({ request }) => {
  founderId = sql(`SELECT founder_id FROM identity.founders WHERE email='${EMAIL}';`);
  if (!founderId) { const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } }); founderId = (await res.json()).founder_id as string; }
  sql(`SET bb.allow_learning_delete='on'; SET bb.allow_promotion_delete='on'; SET bb.allow_snapshot_delete='on'; DELETE FROM business.context_snapshot WHERE founder_id='${founderId}'; DELETE FROM business.strategic_session WHERE founder_id='${founderId}'; DELETE FROM business.learning_promotion_event WHERE founder_id='${founderId}'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}'; DELETE FROM business.understanding WHERE founder_id='${founderId}';`);
  sql(`INSERT INTO business.understanding (id, founder_id, version, supersedes_id, model_version, source_fragment_ids, conclusions, created_at) VALUES ('BU-${THREAD}','${founderId}',1,NULL,'gate-seed','["f"]'::jsonb,'[{"id":"concl-a","type":"what_it_is","statement":"A SaaS for early-stage founders.","epistemicStatus":"OBSERVED","evidenceRefs":["f"],"confidence":"high","confirmationState":"confirmed","founderCorrection":null}]'::jsonb, now());`);
  sql(`INSERT INTO business.strategic_learning_record (id, founder_id, logical_learning_id, revision, schema_version, lifecycle_action, root_learning_id, predecessor_learning_id, review_record_id, review_revision, plan_record_id, commitment_record_id, learning_statement, learning_category, confidence, prior_understanding, revised_understanding, change_statement, learning_scope, broad_scope_acknowledged, is_causal_hypothesis, boundary_conditions, counter_evidence, unresolved_unknowns, observations, evidence_references, founder_authored, model_suggested, accepted_by_founder, idempotency_key, created_at) VALUES ('${THREAD}','${founderId}','${THREAD}',1,'strategic-learning-1','CREATE','${THREAD}',NULL,'review-${THREAD}',1,'plan-x','com-x','Outreach converts.','EXECUTION','SUPPORTED','Ads fastest.','Outreach is our proven primary channel.','Moved to outreach.','THIS_CHANNEL',false,false,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,false,true,'idem-${THREAD}',now());`);
  sql(`INSERT INTO business.learning_promotion_event (id, founder_id, target, logical_learning_id, learning_revision_id, revision_number, promotion_action, rationale, scope, idempotency_key, created_at, promotion_sequence, predecessor_promotion_event_id) VALUES ('${PROMO}','${founderId}','BUSINESS_UNDERSTANDING','${THREAD}','${THREAD}',1,'PROMOTE','Core.','POSITIONING','pidem-${THREAD}',now(),1,NULL);`);
});
test.afterAll(async () => {
  if (founderId) sql(`SET bb.allow_learning_delete='on'; SET bb.allow_promotion_delete='on'; SET bb.allow_snapshot_delete='on'; DELETE FROM business.context_snapshot WHERE founder_id='${founderId}'; DELETE FROM business.strategic_session WHERE founder_id='${founderId}'; DELETE FROM business.learning_promotion_event WHERE founder_id='${founderId}'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}'; DELETE FROM business.understanding WHERE founder_id='${founderId}';`);
});

async function signIn(page: Page) {
  await page.goto('/signin');
  await page.getByRole('textbox').first().fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/signin') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  expect(resp.status(), 'sign-in must succeed').toBe(200);
  await page.waitForURL((u) => !u.pathname.includes('/signin'), { timeout: 15_000 });
  await page.goto('/strategy');
  await expect(page.getByTestId('context-snapshots')).toBeVisible();
}

test('the Consumption Gate is mandatory: no snapshot → no generation; a bound generation records provenance; the snapshot is immutable; legacy is not reproducible', async ({ page }) => {
  await signIn(page);

  // ── 1) Generate is BLOCKED without a snapshot ──
  await expect(page.getByTestId('ask-no-snapshot')).toBeVisible();
  const genBtn = page.getByTestId('ask-generate');
  await page.getByRole('textbox').first().fill('Should I prioritise LinkedIn or a newsletter for the next 30 days?');
  await expect(genBtn.locator('xpath=ancestor::button')).toBeDisabled(); // no snapshot selected → cannot generate
  await page.getByTestId('context-snapshots').screenshot({ path: 'e2e/__evidence__/gate-blocked-no-snapshot.png' }).catch(() => {});

  // ── 2) Create a Context Snapshot; inspect its SHA-256 hash + frozen summary ──
  await page.getByTestId('create-snapshot').click();
  await expect(page.getByTestId('snapshot-list')).toBeVisible();
  const snapId = sql(`SELECT id FROM business.context_snapshot WHERE founder_id='${founderId}' ORDER BY created_at DESC LIMIT 1;`);
  expect(snapId).not.toBe('');
  const hash = sql(`SELECT content_hash FROM business.context_snapshot WHERE id='${snapId}';`);
  expect(hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256, lowercase hex
  expect(sql(`SELECT hash_algorithm FROM business.context_snapshot WHERE id='${snapId}';`)).toBe('sha256');
  await expect(page.getByTestId(`snapshot-bu-count-${snapId}`)).toContainText('2 conclusions (1 promoted)');
  await page.getByTestId(`snapshot-${snapId}`).screenshot({ path: 'e2e/__evidence__/gate-snapshot-sha256.png' }).catch(() => {});

  // ── 3) Select the snapshot → Generate is now enabled; generate binds the session to the exact snapshot ──
  await page.getByTestId('ask-snapshot-select').selectOption(snapId);
  await expect(genBtn.locator('xpath=ancestor::button')).toBeEnabled();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/strategy/sessions') && r.request().method() === 'POST' && r.status() === 202),
    genBtn.click(),
  ]);
  // the session is bound to the exact snapshot (governed contract v1) and provenance is server-recorded
  await expect.poll(() => sql(`SELECT context_snapshot_id FROM business.strategic_session WHERE founder_id='${founderId}' AND context_snapshot_id='${snapId}';`), { timeout: 10_000 }).toBe(snapId);
  expect(sql(`SELECT generation_contract_version FROM business.strategic_session WHERE founder_id='${founderId}' AND context_snapshot_id='${snapId}';`)).toBe('1');
  await expect.poll(() => sql(`SELECT snapshot_content_hash FROM business.strategic_session WHERE context_snapshot_id='${snapId}';`), { timeout: 15_000 }).toBe(hash);
  // server-resolved provenance is complete (prompt hash + strategist + model)
  expect(sql(`SELECT prompt_template_hash FROM business.strategic_session WHERE context_snapshot_id='${snapId}';`)).toMatch(/^[0-9a-f]{64}$/);
  expect(sql(`SELECT (strategist_version IS NOT NULL AND objective_hash IS NOT NULL AND generated_at IS NOT NULL) FROM business.strategic_session WHERE context_snapshot_id='${snapId}';`)).toBe('t');
  await page.getByTestId('context-snapshots').screenshot({ path: 'e2e/__evidence__/gate-generation-bound.png' }).catch(() => {});

  // ── 4) Change the current context (REMOVE the promotion) → the snapshot is UNCHANGED; a new snapshot differs ──
  sql(`INSERT INTO business.learning_promotion_event (id, founder_id, target, logical_learning_id, learning_revision_id, revision_number, promotion_action, rationale, scope, idempotency_key, created_at, promotion_sequence, predecessor_promotion_event_id) VALUES ('${PROMO}-rm','${founderId}','BUSINESS_UNDERSTANDING','${THREAD}','${THREAD}',1,'REMOVE','No longer core.','POSITIONING','pidem-rm-${THREAD}',now(),2,'${PROMO}');`);
  await page.reload();
  await expect(page.getByTestId('context-snapshots')).toBeVisible();
  expect(sql(`SELECT content_hash FROM business.context_snapshot WHERE id='${snapId}';`)).toBe(hash); // frozen — unchanged
  await page.getByTestId('create-snapshot').click();
  const snap2 = sql(`SELECT id FROM business.context_snapshot WHERE founder_id='${founderId}' ORDER BY created_at DESC LIMIT 1;`);
  expect(snap2).not.toBe(snapId);
  expect(sql(`SELECT content_hash FROM business.context_snapshot WHERE id='${snap2}';`)).not.toBe(hash); // reflects the changed context

  // ── 5) A LEGACY session (null snapshot, contract 0) is labelled not-reproducible with no live-regenerate ──
  sql(`INSERT INTO business.strategic_session (id, founder_id, status, strategic_job, subtype, question_text, model_id, prompt_version, schema_version, attempt_count, max_attempts, generation_contract_version, created_at, updated_at, finished_at, failure_category, founder_safe_error) VALUES ('LEGACY-${THREAD}','${founderId}','FAILED','PRIORITY_DECISION','CHANNEL_PRIORITY','A legacy question',NULL,NULL,NULL,1,3,0, now()+interval '1 minute', now()+interval '1 minute', now()+interval '1 minute','MODEL_FAILED','Something went wrong.');`);
  await page.reload();
  await expect(page.getByTestId('session-legacy-badge')).toBeVisible();
  await expect(page.getByTestId('session-legacy-badge')).toContainText('not snapshot-reproducible');
  await expect(page.getByTestId('legacy-no-retry')).toBeVisible(); // no live-regenerate control
  await page.getByTestId('session-legacy-badge').screenshot({ path: 'e2e/__evidence__/gate-legacy-not-reproducible.png' }).catch(() => {});

  // ── DB invariants: native BU never rewritten; learning intact; no live (contract 0 generated) sessions besides the fixture ──
  expect(sql(`SELECT count(*) FROM business.understanding WHERE founder_id='${founderId}';`)).toBe('1');
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('1');
  expect(sql(`SELECT count(*) FROM business.strategic_session WHERE founder_id='${founderId}' AND generation_contract_version=1 AND context_snapshot_id IS NULL;`)).toBe('0'); // no governed row without a snapshot
});
