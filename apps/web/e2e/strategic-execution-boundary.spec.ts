import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Strategic Execution Boundary (ADR-015 + REVISION-SCOPED remediation). A Plan
 * revision shows a DISTINCT founder-reported execution section; the founder reports/corrects/withdraws truthful testimony
 * (never a bare "Completed", evidence "supplied — not verified", "Not performed by Business Brain"); and — the remediation
 * proof — a NEW plan revision has its OWN execution and NEVER inherits the earlier revision's reports, while the earlier
 * revision's execution stays unchanged. No direct fetch for the flow. Requires dev DB + API :3000 + vite (/api proxy).
 */
const EMAIL = `exec.e2e.${Date.now()}@understand.test`;
const PASSWORD = 'exece2epass-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
const LOGICAL = 'EXECE2EPLAN000000000000000000001';
const REV1 = LOGICAL;                                   // revision-1 record id
const REV2 = 'EXECE2EPLAN000000000000000000002';        // revision-2 record id (same logical plan)
let founderId = '';

const MILESTONES = JSON.stringify([
  { id: 'ship-weekly', label: 'Ship weekly', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' },
  { id: 'talk-users', label: 'Talk to 5 users', intendedState: 'done', sequence: 2, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' },
]).replace(/'/g, "''");
function planRow(id: string, revision: number, lifecycle: string): string {
  return `INSERT INTO business.strategic_plan_record (id, founder_id, logical_plan_id, revision, lifecycle, supersedes_id, commitment_record_id, commitment_logical_id, commitment_revision, commitment_schema_version, alignment_at_planning, title, strategic_intent, scope, milestones, assumptions, dependencies, resource_constraints, review_conditions, exit_conditions, acknowledged_insufficient_evidence, conflicts, authorship, activated_at, idempotency_key, created_at) VALUES ('${id}','${founderId}','${LOGICAL}',${revision},'${lifecycle}',${revision > 1 ? `'${REV1}'` : 'NULL'},'com-x','com-x',1,'strategic-commitment-1','ALIGNED','Cadence plan','Push the channel','CHANNEL','${MILESTONES}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'["Review at 30 days"]'::jsonb,'[]'::jsonb,false,'[]'::jsonb,'{}'::jsonb, now(), 'idem-${id}', now() + interval '${revision} second');`;
}

test.beforeAll(async ({ request }) => {
  founderId = sql(`SELECT founder_id FROM identity.founders WHERE email='${EMAIL}';`);
  if (!founderId) { const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } }); founderId = (await res.json()).founder_id as string; }
  sql(`SET bb.allow_execution_report_delete='on'; DELETE FROM business.execution_report WHERE founder_id='${founderId}'; DELETE FROM business.strategic_plan_record WHERE founder_id='${founderId}';`);
  sql(planRow(REV1, 1, 'CREATE')); // only revision 1 exists at first
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
  await expect(page.getByTestId(`plan-${REV1}`)).toBeVisible();
}
const item = 'ship-weekly';
const rev1 = (p: Page) => p.getByTestId(`plan-${REV1}`);
const rev2 = (p: Page) => p.getByTestId(`plan-${REV2}`);

test('founder execution reports are truthful testimony AND are strictly scoped to the exact plan revision', async ({ page }) => {
  await signIn(page);

  // ── revision 1: distinct execution section; item starts "No execution report"; no progress % ──
  await expect(rev1(page).getByTestId(`exec-state-${item}`)).toHaveText('No execution report');
  await expect(rev1(page).getByTestId(`execution-accounting-${REV1}`)).not.toContainText(/\d\s*%/); // no inferred progress percentage
  await rev1(page).screenshot({ path: 'e2e/__evidence__/exec-rev1-no-report.png' }).catch(() => {});

  // ── report ATTEMPTED + evidence on revision 1 ──
  await rev1(page).getByTestId(`exec-add-${item}`).click();
  await rev1(page).getByTestId('exec-report-state').selectOption('ATTEMPTED');
  await rev1(page).getByTestId('exec-report-statement').fill('Shipped twice.');
  await rev1(page).getByTestId('exec-evidence-type').selectOption('URL');
  await rev1(page).getByTestId('exec-evidence-value').fill('https://example.test/changelog');
  await rev1(page).getByTestId('exec-report-submit').click();
  await expect(rev1(page).getByTestId(`exec-state-${item}`)).toHaveText('Reported attempted');
  await expect(rev1(page).getByTestId(`exec-unverified-${item}`)).toContainText('has not independently verified');
  await expect(rev1(page).getByTestId(`exec-item-${item}`)).toContainText('Not performed by Business Brain.');
  await expect(rev1(page).getByTestId(`exec-evidence-${item}`)).toContainText('Evidence supplied — not verified');
  await page.reload(); // persists
  await expect(rev1(page).getByTestId(`exec-state-${item}`)).toHaveText('Reported attempted');

  // ── correct to COMPLETED → "Reported completed", NEVER a bare "Completed" ──
  await rev1(page).getByTestId(`exec-correct-${item}`).click();
  await rev1(page).getByTestId('exec-report-state').selectOption('COMPLETED');
  await rev1(page).getByTestId('exec-report-statement').fill('Actually finished it.');
  await rev1(page).getByTestId('exec-report-submit').click();
  await expect(rev1(page).getByTestId(`exec-state-${item}`)).toHaveText('Reported completed');
  expect(await rev1(page).getByTestId(`exec-state-${item}`).textContent()).not.toBe('Completed');
  await rev1(page).getByTestId(`exec-history-${item}`).click();
  await expect(rev1(page).getByTestId(`exec-history-list-${item}`)).toContainText('#1 REPORT');
  await expect(rev1(page).getByTestId(`exec-history-list-${item}`)).toContainText('#2 CORRECT');
  await rev1(page).screenshot({ path: 'e2e/__evidence__/exec-rev1-reported-completed.png' }).catch(() => {});

  // ── REVISION-SCOPED PROOF: revise the plan (a new intention), reload, and view Revision 2 ──
  sql(planRow(REV2, 2, 'CREATE')); // supersede: revision 2, same milestone ids
  await page.reload();
  await expect(rev2(page)).toBeVisible();
  await expect(rev2(page).getByTestId(`plan-rev-label-${REV2}`)).toContainText('revision 2');
  // Revision 2 has NO execution report for the SAME milestone id — no inheritance from Revision 1
  await expect(rev2(page).getByTestId(`exec-state-${item}`)).toHaveText('No execution report');
  // Revision 1 is UNCHANGED — still "Reported completed"
  await expect(rev1(page).getByTestId(`exec-state-${item}`)).toHaveText('Reported completed');
  await rev2(page).screenshot({ path: 'e2e/__evidence__/exec-rev2-no-report.png' }).catch(() => {});

  // ── report on Revision 2 → Revision 2 changes; Revision 1 stays unchanged (independent chains) ──
  await rev2(page).getByTestId(`exec-add-${item}`).click();
  await rev2(page).getByTestId('exec-report-state').selectOption('BLOCKED');
  await rev2(page).getByTestId('exec-report-statement').fill('Blocked on Revision 2 for a different reason.');
  await rev2(page).getByTestId('exec-report-submit').click();
  await expect(rev2(page).getByTestId(`exec-state-${item}`)).toHaveText('Reported blocked');
  await expect(rev1(page).getByTestId(`exec-state-${item}`)).toHaveText('Reported completed'); // Revision 1 untouched
  await rev2(page).screenshot({ path: 'e2e/__evidence__/exec-rev2-reported-blocked.png' }).catch(() => {});

  // ── DB invariants: independent revision-scoped chains; each restarts at sequence 1 ──
  expect(sql(`SELECT string_agg(report_kind, ',' ORDER BY report_sequence) FROM business.execution_report WHERE founder_id='${founderId}' AND plan_id='${REV1}' AND subject_id='${item}';`)).toBe('REPORT,CORRECT');
  expect(sql(`SELECT string_agg(report_kind, ',' ORDER BY report_sequence) FROM business.execution_report WHERE founder_id='${founderId}' AND plan_id='${REV2}' AND subject_id='${item}';`)).toBe('REPORT');
  expect(sql(`SELECT min(report_sequence) FROM business.execution_report WHERE founder_id='${founderId}' AND plan_id='${REV2}';`)).toBe('1'); // Rev 2 restarts at 1
  // no execution_report row links across revisions (every predecessor is in the same plan_id)
  expect(sql(`SELECT count(*) FROM business.execution_report a JOIN business.execution_report b ON a.predecessor_report_id=b.id WHERE a.founder_id='${founderId}' AND a.plan_id<>b.plan_id;`)).toBe('0');
  // plan revisions untouched; no verified/product-performed column exists
  expect(sql(`SELECT count(*) FROM business.strategic_plan_record WHERE founder_id='${founderId}';`)).toBe('2');
  expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_name='execution_report' AND (column_name LIKE '%verified%' OR column_name LIKE '%product_performed%');`)).toBe('0');
});
