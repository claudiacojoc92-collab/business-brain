import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Strategic Execution Boundary (ADR-015). Drives ACTUAL controls: a Plan (intention)
 * shows a DISTINCT "Founder-reported execution" section; items start "No execution report" with no progress %; the founder
 * reports ATTEMPTED (label "Reported attempted" + "not independently verified" + "Not performed by Business Brain"), adds
 * unverified evidence, refreshes (persists), corrects to COMPLETED (never bare "Completed"), views REPORT+CORRECT history,
 * withdraws (back to "No execution report"); the plan lifecycle is unchanged and no review/session is created. No direct
 * fetch for the flow. Requires dev DB + API on :3000 + vite (/api proxy).
 */
const EMAIL = `exec.e2e.${Date.now()}@understand.test`;
const PASSWORD = 'exece2epass-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
const PLAN = 'EXECE2EPLAN000000000000000000001';
let founderId = '';

const MILESTONES = JSON.stringify([
  { id: 'ship-weekly', label: 'Ship weekly', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' },
  { id: 'talk-users', label: 'Talk to 5 users', intendedState: 'done', sequence: 2, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' },
]).replace(/'/g, "''");

test.beforeAll(async ({ request }) => {
  founderId = sql(`SELECT founder_id FROM identity.founders WHERE email='${EMAIL}';`);
  if (!founderId) { const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } }); founderId = (await res.json()).founder_id as string; }
  sql(`SET bb.allow_execution_report_delete='on'; DELETE FROM business.execution_report WHERE founder_id='${founderId}'; DELETE FROM business.strategic_plan_record WHERE founder_id='${founderId}';`);
  sql(`INSERT INTO business.strategic_plan_record (id, founder_id, logical_plan_id, revision, lifecycle, commitment_record_id, commitment_logical_id, commitment_revision, commitment_schema_version, alignment_at_planning, title, strategic_intent, scope, milestones, assumptions, dependencies, resource_constraints, review_conditions, exit_conditions, acknowledged_insufficient_evidence, conflicts, authorship, activated_at, idempotency_key, created_at) VALUES ('${PLAN}','${founderId}','${PLAN}',1,'CREATE','com-x','com-x',1,'strategic-commitment-1','ALIGNED','Cadence plan','Push the channel','CHANNEL','${MILESTONES}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'["Review at 30 days"]'::jsonb,'[]'::jsonb,false,'[]'::jsonb,'{}'::jsonb, now(), 'idem-${PLAN}', now());`);
});
test.afterAll(async () => {
  if (founderId) sql(`SET bb.allow_execution_report_delete='on'; DELETE FROM business.execution_report WHERE founder_id='${founderId}'; DELETE FROM business.strategic_plan_record WHERE founder_id='${founderId}';`);
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
  await expect(page.getByTestId(`plan-${PLAN}`)).toBeVisible();
}
const item1 = 'ship-weekly'; const item2 = 'talk-users';

test('a Plan shows a distinct founder-reported execution section; report/evidence/correct/withdraw are truthful testimony; plan unchanged', async ({ page }) => {
  await signIn(page);

  // ── 3/4/5. distinct execution section; both items "No execution report"; NO progress % ──
  await expect(page.getByTestId(`execution-accounting-${PLAN}`)).toBeVisible();
  await expect(page.getByTestId(`exec-state-${item1}`)).toHaveText('No execution report');
  await expect(page.getByTestId(`exec-state-${item2}`)).toHaveText('No execution report');
  await expect(page.getByTestId(`execution-accounting-${PLAN}`)).not.toContainText('%');
  await page.getByTestId(`execution-accounting-${PLAN}`).screenshot({ path: 'e2e/__evidence__/exec-no-report.png' }).catch(() => {});

  // ── 6/7/8/9/10/11. report ATTEMPTED for item 1 + evidence NOTE/URL ──
  await page.getByTestId(`exec-add-${item1}`).click();
  await page.getByTestId('exec-report-state').selectOption('ATTEMPTED');
  await page.getByTestId('exec-report-statement').fill('Shipped twice and messaged some users.');
  await page.getByTestId('exec-evidence-type').selectOption('URL');
  await page.getByTestId('exec-evidence-value').fill('https://example.test/changelog');
  await page.getByTestId('exec-report-submit').click();
  await expect(page.getByTestId(`exec-state-${item1}`)).toHaveText('Reported attempted');
  await expect(page.getByTestId(`exec-unverified-${item1}`)).toContainText('has not independently verified');
  await expect(page.getByTestId(`exec-item-${item1}`)).toContainText('Not performed by Business Brain.');
  await expect(page.getByTestId(`exec-evidence-${item1}`)).toContainText('Evidence supplied — not verified');
  await page.getByTestId(`exec-item-${item1}`).screenshot({ path: 'e2e/__evidence__/exec-attempted-unverified.png' }).catch(() => {});

  // ── 12/13. refresh → persists ──
  await page.reload();
  await expect(page.getByTestId(`exec-state-${item1}`)).toHaveText('Reported attempted');

  // ── 14/15. correct to COMPLETED → "Reported completed", NEVER bare "Completed" ──
  await page.getByTestId(`exec-correct-${item1}`).click();
  await page.getByTestId('exec-report-state').selectOption('COMPLETED');
  await page.getByTestId('exec-report-statement').fill('Actually finished the milestone.');
  await page.getByTestId('exec-report-submit').click();
  await expect(page.getByTestId(`exec-state-${item1}`)).toHaveText('Reported completed');
  // the label must never be a bare "Completed"
  expect(await page.getByTestId(`exec-state-${item1}`).textContent()).not.toBe('Completed');
  await page.getByTestId(`exec-item-${item1}`).screenshot({ path: 'e2e/__evidence__/exec-reported-completed.png' }).catch(() => {});

  // ── 16/17. history shows REPORT + CORRECT with sequence ──
  await page.getByTestId(`exec-history-${item1}`).click();
  await expect(page.getByTestId(`exec-history-list-${item1}`)).toContainText('#1 REPORT');
  await expect(page.getByTestId(`exec-history-list-${item1}`)).toContainText('#2 CORRECT');
  await page.getByTestId(`exec-history-list-${item1}`).screenshot({ path: 'e2e/__evidence__/exec-history.png' }).catch(() => {});

  // ── 18/19/20. withdraw → back to "No execution report"; history still available ──
  await page.getByTestId(`exec-withdraw-${item1}`).click();
  await expect(page.getByTestId(`exec-state-${item1}`)).toHaveText('No execution report');
  await page.getByTestId(`exec-history-${item1}`).click();
  await expect(page.getByTestId(`exec-history-list-${item1}`)).toContainText('WITHDRAW');
  await page.getByTestId(`exec-item-${item1}`).screenshot({ path: 'e2e/__evidence__/exec-withdrawn.png' }).catch(() => {});

  // ── 21. item 2 remains unreported with no warning colours / pressure ──
  await expect(page.getByTestId(`exec-state-${item2}`)).toHaveText('No execution report');

  // ── 22/23/24/25/26. DB invariants: plan lifecycle unchanged (still 1 CREATE row); no review; no session; ledger holds 3 events ──
  expect(sql(`SELECT count(*) FROM business.strategic_plan_record WHERE founder_id='${founderId}';`)).toBe('1');
  expect(sql(`SELECT lifecycle FROM business.strategic_plan_record WHERE id='${PLAN}';`)).toBe('CREATE');
  expect(sql(`SELECT count(*) FROM business.strategic_plan_review_record WHERE founder_id='${founderId}';`)).toBe('0');
  expect(sql(`SELECT count(*) FROM business.strategic_session WHERE founder_id='${founderId}';`)).toBe('0');
  expect(sql(`SELECT string_agg(report_kind, ',' ORDER BY report_sequence) FROM business.execution_report WHERE founder_id='${founderId}' AND subject_id='${item1}';`)).toBe('REPORT,CORRECT,WITHDRAW');
  expect(sql(`SELECT count(*) FROM business.execution_report WHERE founder_id='${founderId}' AND subject_id='${item2}';`)).toBe('0');
  // no verified / product-performed columns exist on the ledger
  expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_name='execution_report' AND (column_name LIKE '%verified%' OR column_name LIKE '%product_performed%');`)).toBe('0');
});
