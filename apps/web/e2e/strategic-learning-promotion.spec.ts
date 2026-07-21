import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Strategic Learning Promotion Gate (ADR-013). Drives ACTUAL controls: sign in,
 * open a learning thread's revision history, PROMOTE a revision into Business Understanding, refresh (BU shows the pinned
 * revision), REFINE the learning (BU unchanged — Law 6), REPLACE the promotion (BU changes), REMOVE it (BU empty). DB
 * invariants confirm no business.understanding version is written and the learning is untouched. No direct fetch for the
 * promotion flow. Requires the dev DB + API on :3000 + vite (with /api proxy).
 */
const EMAIL = `promo.e2e.${Date.now()}@understand.test`;
const PASSWORD = 'promoe2epass-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
const THREAD = 'PROMO1LEARNING00000000000000001';
let founderId = '';

test.beforeAll(async ({ request }) => {
  founderId = sql(`SELECT founder_id FROM identity.founders WHERE email='${EMAIL}';`);
  if (!founderId) { const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } }); founderId = (await res.json()).founder_id as string; }
  sql(`SET bb.allow_learning_delete='on'; SET bb.allow_promotion_delete='on'; DELETE FROM business.learning_promotion_event WHERE founder_id='${founderId}'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}';`);
  sql(`INSERT INTO business.strategic_learning_record (id, founder_id, logical_learning_id, revision, schema_version, lifecycle_action, root_learning_id, predecessor_learning_id, review_record_id, review_revision, plan_record_id, commitment_record_id, learning_statement, learning_category, confidence, prior_understanding, revised_understanding, change_statement, learning_scope, broad_scope_acknowledged, is_causal_hypothesis, boundary_conditions, counter_evidence, unresolved_unknowns, observations, evidence_references, founder_authored, model_suggested, accepted_by_founder, idempotency_key, created_at) VALUES ('${THREAD}','${founderId}','${THREAD}',1,'strategic-learning-1','CREATE','${THREAD}',NULL,'review-${THREAD}',1,'plan-x','com-x','Founder-led outreach converts at our stage.','EXECUTION','SUPPORTED','Ads would be fastest.','Outreach is fastest.','Moved to outreach-first.','THIS_CHANNEL',false,false,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,false,true,'idem-${THREAD}',now());`);
});
test.afterAll(async () => {
  if (founderId) sql(`SET bb.allow_learning_delete='on'; SET bb.allow_promotion_delete='on'; DELETE FROM business.learning_promotion_event WHERE founder_id='${founderId}'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}';`);
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
const thread = (page: Page) => page.getByTestId(`thread-${THREAD}`);
async function fillPromotionForm(page: Page, scope: string, rationale: string) {
  await page.getByTestId('promotion-scope').selectOption(scope);
  await page.getByTestId('promotion-rationale').fill(rationale);
  await page.getByTestId('promotion-submit').click();
}

test('founder promotes a learning revision into Business Understanding through the rendered UI; refine leaves it unchanged; replace + remove work', async ({ page }) => {
  await signIn(page);

  // ── nothing promoted yet ──
  await expect(page.getByTestId('promoted-bu-empty')).toBeVisible();

  // ── PROMOTE revision 1 into Business Understanding ──
  await thread(page).getByTestId('toggle-history').click();
  await expect(thread(page).getByTestId('revision-1')).toBeVisible();
  await thread(page).getByTestId('promote-bu-rev-1').click();
  const form = page.getByTestId('promotion-form');
  await expect(form).toContainText('This does NOT modify the learning');
  await fillPromotionForm(page, 'POSITIONING', 'This is now core to how we position.');

  // ── refresh → BU shows the promoted revision (revision 1) ──
  await page.reload();
  await expect(page.getByTestId('promoted-bu')).toBeVisible();
  await expect(page.getByTestId(`promoted-bu-${THREAD}`)).toContainText('Promoted revision 1');
  await page.getByTestId(`promoted-bu`).screenshot({ path: 'e2e/__evidence__/promotion-bu-promoted.png' }).catch(() => {});

  // ── REFINE the learning → a new revision 2, but BU stays pinned to revision 1 (Law 6) ──
  await thread(page).getByTestId('action-refine').click();
  await thread(page).getByTestId('refine-statement').fill('Founder-led outreach converts — for high-trust offers.');
  await thread(page).getByTestId('refine-reason').fill('Narrowing to the segment where it held.');
  await thread(page).getByTestId('refine-confirm-input').check();
  await thread(page).getByTestId('refine-submit').click();
  await page.reload();
  await expect(page.getByTestId(`promoted-bu-${THREAD}`)).toContainText('Promoted revision 1'); // UNCHANGED

  // ── REPLACE the promotion with revision 2 → BU changes to revision 2 ──
  await thread(page).getByTestId('toggle-history').click();
  await expect(thread(page).getByTestId('revision-2')).toBeVisible();
  await thread(page).getByTestId('replace-bu-rev-2').click();
  await fillPromotionForm(page, 'POSITIONING', 'The sharper formulation should shape BU now.');
  await page.reload();
  await expect(page.getByTestId(`promoted-bu-${THREAD}`)).toContainText('Promoted revision 2'); // CHANGED
  await page.getByTestId('promoted-bu').screenshot({ path: 'e2e/__evidence__/promotion-bu-replaced.png' }).catch(() => {});

  // ── REMOVE the promotion → BU empty ──
  await thread(page).getByTestId('toggle-history').click();
  await thread(page).getByTestId('remove-bu-rev-2').click();
  await fillPromotionForm(page, 'POSITIONING', 'No longer core to positioning.');
  await page.reload();
  await expect(page.getByTestId('promoted-bu-empty')).toBeVisible();
  await page.getByTestId('promoted-bu-empty').screenshot({ path: 'e2e/__evidence__/promotion-bu-empty.png' }).catch(() => {});

  // ── DB invariants: no BU version written; learning thread intact; 3 promotion events (PROMOTE/REPLACE/REMOVE) ──
  expect(sql(`SELECT count(*) FROM business.understanding WHERE founder_id='${founderId}';`)).toBe('0');
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}' AND logical_learning_id='${THREAD}';`)).toBe('2'); // CREATE + REFINE, untouched
  expect(sql(`SELECT string_agg(promotion_action, ',' ORDER BY created_at) FROM business.learning_promotion_event WHERE founder_id='${founderId}';`)).toBe('PROMOTE,REPLACE,REMOVE');
  expect(sql(`SELECT count(*) FROM business.founder_strategic_context_item WHERE founder_id='${founderId}';`)).toBe('0'); // FSC untouched (independent target)
});
