import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Strategic Learning Consumption Gate (ADR-014). Drives ACTUAL controls: sign in,
 * open the current effective context, CREATE a context snapshot (freezing native BU + a promoted learning), inspect it,
 * then MODIFY the learning + promotion so the CURRENT effective context changes — and verify the SNAPSHOT is unchanged
 * (same hash + counts), a new snapshot differs, and generating a recommendation FROM a snapshot binds the session to that
 * exact snapshot (DB: strategic_session.context_snapshot_id). No direct fetch for the snapshot flow. Requires dev DB + API
 * on :3000 + vite (/api proxy).
 */
const EMAIL = `consume.e2e.${Date.now()}@understand.test`;
const PASSWORD = 'consumee2epass-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
const THREAD = 'CONSUME1LEARNING0000000000000001';
const PROMO = 'CONSUME1PROMO000000000000000001';
let founderId = '';

test.beforeAll(async ({ request }) => {
  founderId = sql(`SELECT founder_id FROM identity.founders WHERE email='${EMAIL}';`);
  if (!founderId) { const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } }); founderId = (await res.json()).founder_id as string; }
  sql(`SET bb.allow_learning_delete='on'; SET bb.allow_promotion_delete='on'; SET bb.allow_snapshot_delete='on'; DELETE FROM business.context_snapshot WHERE founder_id='${founderId}'; DELETE FROM business.learning_promotion_event WHERE founder_id='${founderId}'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}'; DELETE FROM business.understanding WHERE founder_id='${founderId}';`);
  // native BU (1 conclusion) + a learning + PROMOTE it to BU → the effective BU has 1 native + 1 promoted conclusion.
  sql(`INSERT INTO business.understanding (id, founder_id, version, supersedes_id, model_version, source_fragment_ids, conclusions, created_at) VALUES ('BU-${THREAD}','${founderId}',1,NULL,'consume-seed','["f"]'::jsonb,'[{"id":"concl-a","type":"what_it_is","statement":"A SaaS for early-stage founders.","epistemicStatus":"OBSERVED","evidenceRefs":["f"],"confidence":"high","confirmationState":"confirmed","founderCorrection":null}]'::jsonb, now());`);
  sql(`INSERT INTO business.strategic_learning_record (id, founder_id, logical_learning_id, revision, schema_version, lifecycle_action, root_learning_id, predecessor_learning_id, review_record_id, review_revision, plan_record_id, commitment_record_id, learning_statement, learning_category, confidence, prior_understanding, revised_understanding, change_statement, learning_scope, broad_scope_acknowledged, is_causal_hypothesis, boundary_conditions, counter_evidence, unresolved_unknowns, observations, evidence_references, founder_authored, model_suggested, accepted_by_founder, idempotency_key, created_at) VALUES ('${THREAD}','${founderId}','${THREAD}',1,'strategic-learning-1','CREATE','${THREAD}',NULL,'review-${THREAD}',1,'plan-x','com-x','Outreach converts.','EXECUTION','SUPPORTED','Ads fastest.','Outreach is our proven primary channel.','Moved to outreach.','THIS_CHANNEL',false,false,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,false,true,'idem-${THREAD}',now());`);
  sql(`INSERT INTO business.learning_promotion_event (id, founder_id, target, logical_learning_id, learning_revision_id, revision_number, promotion_action, rationale, scope, idempotency_key, created_at, promotion_sequence, predecessor_promotion_event_id) VALUES ('${PROMO}','${founderId}','BUSINESS_UNDERSTANDING','${THREAD}','${THREAD}',1,'PROMOTE','Core to positioning.','POSITIONING','pidem-${THREAD}',now(),1,NULL);`);
});
test.afterAll(async () => {
  if (founderId) sql(`SET bb.allow_learning_delete='on'; SET bb.allow_promotion_delete='on'; SET bb.allow_snapshot_delete='on'; DELETE FROM business.context_snapshot WHERE founder_id='${founderId}'; DELETE FROM business.learning_promotion_event WHERE founder_id='${founderId}'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}'; DELETE FROM business.understanding WHERE founder_id='${founderId}';`);
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
  await expect(page.getByTestId('context-snapshots')).toBeVisible();
}
const firstSnapshotId = () => sql(`SELECT id FROM business.context_snapshot WHERE founder_id='${founderId}' ORDER BY created_at ASC LIMIT 1;`);

test('a snapshot freezes effective context; later context changes leave it unchanged; a recommendation binds to the exact snapshot', async ({ page }) => {
  await signIn(page);

  // ── the current effective BU shows native + promoted; nothing snapshotted yet ──
  await expect(page.getByTestId('effective-bu-native')).toContainText('A SaaS for early-stage founders.');
  await expect(page.getByTestId(`effective-bu-promoted-${THREAD}`)).toBeVisible();
  await expect(page.getByTestId('snapshots-empty')).toBeVisible();

  // ── CREATE a snapshot — freezes native BU + the promoted learning (2 BU conclusions, 1 promoted) ──
  await page.getByTestId('create-snapshot').click();
  await expect(page.getByTestId('snapshot-list')).toBeVisible();
  const snapId = firstSnapshotId();
  expect(snapId).not.toBe('');
  await expect(page.getByTestId(`snapshot-bu-count-${snapId}`)).toContainText('2 conclusions (1 promoted)');
  const hashBefore = sql(`SELECT content_hash FROM business.context_snapshot WHERE id='${snapId}';`);
  await page.getByTestId(`snapshot-${snapId}`).screenshot({ path: 'e2e/__evidence__/consumption-snapshot-created.png' }).catch(() => {});

  // ── MODIFY the effective context: REMOVE the promotion (availability changes) ──
  sql(`INSERT INTO business.learning_promotion_event (id, founder_id, target, logical_learning_id, learning_revision_id, revision_number, promotion_action, rationale, scope, idempotency_key, created_at, promotion_sequence, predecessor_promotion_event_id) VALUES ('${PROMO}-rm','${founderId}','BUSINESS_UNDERSTANDING','${THREAD}','${THREAD}',1,'REMOVE','No longer core.','POSITIONING','pidem-rm-${THREAD}',now(),2,'${PROMO}');`);
  await page.reload();
  await expect(page.getByTestId('context-snapshots')).toBeVisible();
  // current effective context changed — the promoted item is gone from the canonical BU view
  await expect(page.getByTestId(`effective-bu-promoted-${THREAD}`)).toHaveCount(0);
  // but the SNAPSHOT is unchanged — same hash, still 2 conclusions (1 promoted)
  await expect(page.getByTestId(`snapshot-bu-count-${snapId}`)).toContainText('2 conclusions (1 promoted)');
  expect(sql(`SELECT content_hash FROM business.context_snapshot WHERE id='${snapId}';`)).toBe(hashBefore);
  await page.getByTestId(`snapshot-${snapId}`).screenshot({ path: 'e2e/__evidence__/consumption-snapshot-frozen.png' }).catch(() => {});

  // ── a NEW snapshot reflects the CHANGED current context (0 promoted now) ──
  await page.getByTestId('create-snapshot').click();
  const secondId = sql(`SELECT id FROM business.context_snapshot WHERE founder_id='${founderId}' ORDER BY created_at DESC LIMIT 1;`);
  expect(secondId).not.toBe(snapId);
  await expect(page.getByTestId(`snapshot-bu-count-${secondId}`)).toContainText('1 conclusions (0 promoted)');

  // ── GENERATE a recommendation FROM the first (frozen) snapshot — binds the session to that exact snapshot ──
  await page.getByTestId(`generate-from-snapshot-${snapId}`).click();
  await expect(page.getByTestId(`generated-from-${snapId}`)).toBeVisible();
  await expect.poll(() => sql(`SELECT count(*) FROM business.strategic_session WHERE founder_id='${founderId}' AND context_snapshot_id='${snapId}';`), { timeout: 10_000 }).toBe('1');
  await page.getByTestId('context-snapshots').screenshot({ path: 'e2e/__evidence__/consumption-generate-from-snapshot.png' }).catch(() => {});

  // ── DB invariants: 2 snapshots; the learning is untouched; native BU never rewritten (1 version) ──
  expect(sql(`SELECT count(*) FROM business.context_snapshot WHERE founder_id='${founderId}';`)).toBe('2');
  expect(sql(`SELECT count(*) FROM business.understanding WHERE founder_id='${founderId}';`)).toBe('1');
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}' AND logical_learning_id='${THREAD}';`)).toBe('1');
  // the session bound to the first snapshot references it forever
  expect(sql(`SELECT context_snapshot_id FROM business.strategic_session WHERE founder_id='${founderId}' AND context_snapshot_id='${snapId}';`)).toBe(snapId);
});
