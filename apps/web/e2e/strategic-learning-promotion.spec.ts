import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Strategic Learning Promotion Gate — REMEDIATION (ADR-013 amendment). Drives the
 * CANONICAL "Current effective Business Understanding / Founder Strategic Context" view (native + promoted composition),
 * not just the ledger projection. Flow: sign in → canonical BU shows the NATIVE understanding → PROMOTE revision 1 →
 * canonical BU shows a Promoted-learning item (exact revision + rationale + scope) → refresh persists → REFINE (canonical
 * BU stays pinned to revision 1) → REPLACE with revision 2 (canonical BU shows revision 2) → Promotion History shows
 * PROMOTE+REPLACE → REMOVE (canonical BU promoted gone, native remains) → PROMOTE to FSC (appears only in canonical FSC,
 * not BU). DB invariants: native BU version count is unchanged (never rewritten), the learning is untouched, no session/
 * recommendation created. No direct fetch for the promotion flow. Requires the dev DB + API on :3000 + vite (/api proxy).
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
  sql(`SET bb.allow_learning_delete='on'; SET bb.allow_promotion_delete='on'; DELETE FROM business.learning_promotion_event WHERE founder_id='${founderId}'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}'; DELETE FROM business.understanding WHERE founder_id='${founderId}';`);
  // Seed ONE native Business Understanding version so the canonical view has a native portion to display (and to prove
  // promotion never rewrites it — the version count must stay 1 throughout).
  sql(`INSERT INTO business.understanding (id, founder_id, version, supersedes_id, model_version, source_fragment_ids, conclusions, created_at) VALUES ('BU-${THREAD}','${founderId}',1,NULL,'promo-seed','["f"]'::jsonb,'[{"id":"concl-a","type":"what_it_is","statement":"A SaaS for early-stage founders.","epistemicStatus":"OBSERVED","evidenceRefs":["f"],"confidence":"high","confirmationState":"confirmed","founderCorrection":null}]'::jsonb, now());`);
  sql(`INSERT INTO business.strategic_learning_record (id, founder_id, logical_learning_id, revision, schema_version, lifecycle_action, root_learning_id, predecessor_learning_id, review_record_id, review_revision, plan_record_id, commitment_record_id, learning_statement, learning_category, confidence, prior_understanding, revised_understanding, change_statement, learning_scope, broad_scope_acknowledged, is_causal_hypothesis, boundary_conditions, counter_evidence, unresolved_unknowns, observations, evidence_references, founder_authored, model_suggested, accepted_by_founder, idempotency_key, created_at) VALUES ('${THREAD}','${founderId}','${THREAD}',1,'strategic-learning-1','CREATE','${THREAD}',NULL,'review-${THREAD}',1,'plan-x','com-x','Founder-led outreach converts at our stage.','EXECUTION','SUPPORTED','Ads would be fastest.','Outreach is fastest.','Moved to outreach-first.','THIS_CHANNEL',false,false,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,true,false,true,'idem-${THREAD}',now());`);
});
test.afterAll(async () => {
  if (founderId) sql(`SET bb.allow_learning_delete='on'; SET bb.allow_promotion_delete='on'; DELETE FROM business.learning_promotion_event WHERE founder_id='${founderId}'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}'; DELETE FROM business.understanding WHERE founder_id='${founderId}';`);
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

const buPromoted = (page: Page) => page.getByTestId(`effective-bu-promoted-${THREAD}`);

test('canonical effective Business Understanding composes native + promoted learning; refine pins; replace/remove change it; FSC is independent', async ({ page }) => {
  await signIn(page);

  // ── canonical Current Business Understanding shows the NATIVE understanding, nothing promoted yet ──
  await expect(page.getByTestId('effective-bu-native')).toContainText('A SaaS for early-stage founders.');
  await expect(page.getByTestId('effective-bu-promoted-empty')).toBeVisible();
  await page.getByTestId('effective-bu').screenshot({ path: 'e2e/__evidence__/promotion-bu-before.png' }).catch(() => {});

  // ── PROMOTE revision 1 into Business Understanding ──
  await thread(page).getByTestId('toggle-history').click();
  await expect(thread(page).getByTestId('revision-1')).toBeVisible();
  await thread(page).getByTestId('promote-bu-rev-1').click();
  const form = page.getByTestId('promotion-form');
  await expect(form).toContainText('This does NOT modify the learning');
  await fillPromotionForm(page, 'POSITIONING', 'This is now core to how we position.');

  // ── refresh → canonical BU shows a Promoted-learning item: exact revision 1 + rationale + scope; native still present ──
  await page.reload();
  await expect(page.getByTestId('effective-bu-native')).toContainText('A SaaS for early-stage founders.');
  await expect(buPromoted(page)).toBeVisible();
  await expect(buPromoted(page).getByTestId('effective-bu-promoted-badge')).toContainText('Promoted learning');
  await expect(buPromoted(page).getByTestId('effective-bu-revision')).toContainText('Revision 1');
  await expect(buPromoted(page)).toContainText('core to how we position');
  await expect(buPromoted(page)).toContainText(/positioning/i); // scope, rendered lower-cased
  await page.getByTestId('effective-bu').screenshot({ path: 'e2e/__evidence__/promotion-bu-promoted.png' }).catch(() => {});

  // ── REFINE the learning → revision 2, but canonical BU stays pinned to revision 1 (Law 6 / C-6) ──
  await thread(page).getByTestId('action-refine').click();
  await thread(page).getByTestId('refine-statement').fill('Founder-led outreach converts — for high-trust offers.');
  await thread(page).getByTestId('refine-reason').fill('Narrowing to the segment where it held.');
  await thread(page).getByTestId('refine-confirm-input').check();
  await thread(page).getByTestId('refine-submit').click();
  await page.reload();
  await expect(buPromoted(page).getByTestId('effective-bu-revision')).toContainText('Revision 1'); // UNCHANGED
  await page.getByTestId('effective-bu').screenshot({ path: 'e2e/__evidence__/promotion-bu-pinned.png' }).catch(() => {});

  // ── REPLACE with revision 2 → canonical BU changes to revision 2 ──
  await thread(page).getByTestId('toggle-history').click();
  await expect(thread(page).getByTestId('revision-2')).toBeVisible();
  await thread(page).getByTestId('replace-bu-rev-2').click();
  await fillPromotionForm(page, 'POSITIONING', 'The sharper formulation should shape BU now.');
  await page.reload();
  await expect(buPromoted(page).getByTestId('effective-bu-revision')).toContainText('Revision 2'); // CHANGED
  await page.getByTestId('effective-bu').screenshot({ path: 'e2e/__evidence__/promotion-bu-replaced.png' }).catch(() => {});

  // ── Promotion History (audit) still shows PROMOTE + REPLACE ──
  await expect(page.getByTestId('promotion-history')).toContainText('Promoted revision 2');
  await page.getByTestId('promotion-history').screenshot({ path: 'e2e/__evidence__/promotion-history.png' }).catch(() => {});

  // ── REMOVE → canonical BU promoted gone, native remains ──
  await thread(page).getByTestId('toggle-history').click();
  await thread(page).getByTestId('remove-bu-rev-2').click();
  await fillPromotionForm(page, 'POSITIONING', 'No longer core to positioning.');
  await page.reload();
  await expect(page.getByTestId('effective-bu-promoted-empty')).toBeVisible();
  await expect(page.getByTestId('effective-bu-native')).toContainText('A SaaS for early-stage founders.'); // native remains
  await page.getByTestId('effective-bu').screenshot({ path: 'e2e/__evidence__/promotion-bu-empty.png' }).catch(() => {});

  // ── PROMOTE the (now un-promoted) learning to FOUNDER STRATEGIC CONTEXT → appears only in canonical FSC, not BU ──
  await thread(page).getByTestId('toggle-history').click();
  await thread(page).getByTestId('promote-fsc-rev-2').click();
  await fillPromotionForm(page, 'FOUNDER', 'This should shape my strategic context, not my BU.');
  await page.reload();
  await expect(page.getByTestId(`effective-fsc-promoted-${THREAD}`)).toBeVisible();
  await expect(page.getByTestId('effective-bu-promoted-empty')).toBeVisible(); // still not in BU (independent target)
  await page.getByTestId('effective-fsc').screenshot({ path: 'e2e/__evidence__/promotion-fsc-promoted.png' }).catch(() => {});

  // ── DB invariants: native BU never rewritten (still 1 version); learning intact; ledger chain; no session/recommendation ──
  expect(sql(`SELECT count(*) FROM business.understanding WHERE founder_id='${founderId}';`)).toBe('1'); // native BU unchanged
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}' AND logical_learning_id='${THREAD}';`)).toBe('2'); // CREATE + REFINE, untouched
  expect(sql(`SELECT string_agg(promotion_action, ',' ORDER BY promotion_sequence) FROM business.learning_promotion_event WHERE founder_id='${founderId}' AND target='BUSINESS_UNDERSTANDING';`)).toBe('PROMOTE,REPLACE,REMOVE');
  expect(sql(`SELECT string_agg(promotion_action, ',' ORDER BY promotion_sequence) FROM business.learning_promotion_event WHERE founder_id='${founderId}' AND target='FOUNDER_STRATEGIC_CONTEXT';`)).toBe('PROMOTE');
  expect(sql(`SELECT string_agg(promotion_sequence::text, ',' ORDER BY promotion_sequence) FROM business.learning_promotion_event WHERE founder_id='${founderId}' AND target='BUSINESS_UNDERSTANDING';`)).toBe('1,2,3'); // contiguous lineage
  expect(sql(`SELECT count(*) FROM business.strategic_session WHERE founder_id='${founderId}';`)).toBe('0'); // no recommendation/session created
});
