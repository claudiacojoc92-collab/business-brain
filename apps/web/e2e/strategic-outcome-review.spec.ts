import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Strategic Outcome Review Boundary (ADR-016). The founder creates a Plan (seeded),
 * reports execution, creates a context snapshot, then records an OUTCOME REVIEW — an immutable historical assessment that
 * describes (intended / reported / evidence / observed / unknown) and changes NOTHING: it edits no Plan, edits no Execution
 * report, creates no Learning, shows no score, and displays UNKNOWN explicitly. A SECOND review is a new immutable record
 * and leaves the first byte-identical. No direct fetch for the flow. Requires dev DB + API :3000 + vite (/api proxy).
 */
const EMAIL = `sor.e2e.${Date.now()}@understand.test`;
const PASSWORD = 'sore2epass-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
const LOGICAL = 'SORE2EPLAN0000000000000000000001';
const REV1 = LOGICAL;
let founderId = '';
const item = 'ship-weekly';

const MILESTONES = JSON.stringify([
  { id: 'ship-weekly', label: 'Ship weekly', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' },
]).replace(/'/g, "''");
function planRow(id: string): string {
  return `INSERT INTO business.strategic_plan_record (id, founder_id, logical_plan_id, revision, lifecycle, supersedes_id, commitment_record_id, commitment_logical_id, commitment_revision, commitment_schema_version, alignment_at_planning, title, strategic_intent, scope, milestones, assumptions, dependencies, resource_constraints, review_conditions, exit_conditions, acknowledged_insufficient_evidence, conflicts, authorship, activated_at, idempotency_key, created_at) VALUES ('${id}','${founderId}','${LOGICAL}',1,'CREATE',NULL,'com-x','com-x',1,'strategic-commitment-1','ALIGNED','Cadence plan','Push the channel','CHANNEL','${MILESTONES}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'["Review at 30 days"]'::jsonb,'[]'::jsonb,false,'[]'::jsonb,'{}'::jsonb, now(), 'idem-${id}', now());`;
}

test.beforeAll(async ({ request }) => {
  founderId = sql(`SELECT founder_id FROM identity.founders WHERE email='${EMAIL}';`);
  if (!founderId) { const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } }); founderId = (await res.json()).founder_id as string; }
  sql(`SET bb.allow_execution_report_delete='on'; SET bb.allow_strategic_review_delete='on'; SET bb.allow_snapshot_delete='on'; DELETE FROM business.strategic_outcome_review WHERE founder_id='${founderId}'; DELETE FROM business.execution_report WHERE founder_id='${founderId}'; DELETE FROM business.context_snapshot WHERE founder_id='${founderId}'; DELETE FROM business.strategic_plan_record WHERE founder_id='${founderId}'; DELETE FROM business.understanding WHERE founder_id='${founderId}';`);
  // a Business Understanding so a context snapshot can be captured
  sql(`INSERT INTO business.understanding (id, founder_id, version, supersedes_id, model_version, source_fragment_ids, conclusions, created_at) VALUES ('BU-SORE2E','${founderId}',1,NULL,'sor-seed','["f"]'::jsonb,'[{"id":"concl-a","type":"what_it_is","statement":"A SaaS.","epistemicStatus":"OBSERVED","evidenceRefs":["f"],"confidence":"high","confirmationState":"confirmed","founderCorrection":null}]'::jsonb, now());`);
  sql(planRow(REV1));
});
test.afterAll(async () => {
  if (founderId) sql(`SET bb.allow_execution_report_delete='on'; SET bb.allow_strategic_review_delete='on'; SET bb.allow_snapshot_delete='on'; DELETE FROM business.strategic_outcome_review WHERE founder_id='${founderId}'; DELETE FROM business.execution_report WHERE founder_id='${founderId}'; DELETE FROM business.context_snapshot WHERE founder_id='${founderId}'; DELETE FROM business.strategic_plan_record WHERE founder_id='${founderId}'; DELETE FROM business.understanding WHERE founder_id='${founderId}';`);
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
const plan = (p: Page) => p.getByTestId(`plan-${REV1}`);

test('an outcome review is an immutable historical assessment — it describes, never changes, and a second review leaves the first unchanged', async ({ page }) => {
  await signIn(page);

  // ── report execution on the milestone (so the review has something to describe) ──
  await plan(page).getByTestId(`exec-add-${item}`).click();
  await plan(page).getByTestId('exec-report-state').selectOption('ATTEMPTED');
  await plan(page).getByTestId('exec-report-statement').fill('Shipped twice.');
  await plan(page).getByTestId('exec-report-submit').click();
  await expect(plan(page).getByTestId(`exec-state-${item}`)).toHaveText('Reported attempted');
  const planTextBefore = await plan(page).getByText('Planned: Ship weekly').textContent();
  const execStateBefore = await plan(page).getByTestId(`exec-state-${item}`).textContent();

  // ── the outcome review starts empty; UNKNOWN is a selectable outcome ──
  await expect(plan(page).getByTestId(`outcome-review-none-${REV1}`)).toBeVisible();
  await plan(page).getByTestId(`outcome-review-open-${REV1}`).click();

  // ── create a context snapshot from within the review flow (a review freezes the exact context) ──
  await plan(page).getByTestId(`outcome-create-snapshot-${REV1}`).click();
  await expect(plan(page).getByTestId(`outcome-snapshot-${REV1}`)).toBeVisible(); // snapshot now selectable

  // ── record review #1 with observed outcome PARTIALLY + an explicit unknown ──
  await plan(page).getByTestId(`outcome-select-${REV1}`).selectOption('PARTIALLY_AS_INTENDED');
  await plan(page).getByTestId(`outcome-statement-${REV1}`).fill('We shipped for three weeks, then paused.');
  await plan(page).getByTestId(`outcome-unknowns-input-${REV1}`).fill('Whether the cadence drove signups.');
  await plan(page).getByTestId(`outcome-submit-${REV1}`).click();

  // ── review #1 is visible; describes; shows no score; shows the unknown ──
  await expect(plan(page).getByTestId(`outcome-review-item-${REV1}-1`)).toBeVisible();
  await expect(plan(page).getByTestId(`outcome-verdict-${REV1}-1`)).toHaveText('Founder reports: partially as intended');
  await expect(plan(page).getByTestId(`outcome-unknowns-${REV1}-1`)).toContainText('Whether the cadence drove signups.');
  await expect(plan(page).getByTestId(`outcome-review-item-${REV1}-1`)).toContainText('not a score');
  await expect(plan(page).getByTestId(`outcome-review-item-${REV1}-1`)).not.toContainText(/\d\s*%/); // no score/percentage
  await plan(page).getByTestId(`outcome-review-item-${REV1}-1`).screenshot({ path: 'e2e/__evidence__/outcome-review-1.png' }).catch(() => {});
  const review1Hash = sql(`SELECT content_hash FROM business.strategic_outcome_review WHERE founder_id='${founderId}' AND review_sequence=1;`);

  // ── the review changed NOTHING: the Plan and the Execution report are unchanged; no Learning was created ──
  await page.reload();
  await expect(plan(page).getByText('Planned: Ship weekly')).toHaveText(planTextBefore!.trim());
  await expect(plan(page).getByTestId(`exec-state-${item}`)).toHaveText(execStateBefore!.trim()); // execution untouched
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('0'); // NO learning created
  expect(sql(`SELECT count(*) FROM business.strategic_plan_record WHERE founder_id='${founderId}';`)).toBe('1'); // plan revision count unchanged

  // ── a SECOND review with a NEW outcome (UNKNOWN) — a new immutable record; the first stays byte-identical ──
  await plan(page).getByTestId(`outcome-review-open-${REV1}`).click();
  await plan(page).getByTestId(`outcome-select-${REV1}`).selectOption('UNKNOWN');
  await plan(page).getByTestId(`outcome-statement-${REV1}`).fill('Actually, not enough signal to say.');
  await plan(page).getByTestId(`outcome-submit-${REV1}`).click();
  await expect(plan(page).getByTestId(`outcome-review-item-${REV1}-2`)).toBeVisible();
  await expect(plan(page).getByTestId(`outcome-verdict-${REV1}-2`)).toHaveText('Outcome unknown'); // UNKNOWN displayed explicitly
  await expect(plan(page).getByTestId(`outcome-verdict-${REV1}-1`)).toHaveText('Founder reports: partially as intended'); // #1 unchanged
  await plan(page).getByTestId(`outcome-review-${REV1}`).screenshot({ path: 'e2e/__evidence__/outcome-review-2.png' }).catch(() => {});

  // ── DB invariants: two immutable reviews; #1's content hash never changed; independent sequences ──
  expect(sql(`SELECT string_agg(observed_outcome, ',' ORDER BY review_sequence) FROM business.strategic_outcome_review WHERE founder_id='${founderId}';`)).toBe('PARTIALLY_AS_INTENDED,UNKNOWN');
  expect(sql(`SELECT content_hash FROM business.strategic_outcome_review WHERE founder_id='${founderId}' AND review_sequence=1;`)).toBe(review1Hash); // #1 byte-identical
  // deterministic, model-free reproducibility provenance recorded
  expect(sql(`SELECT DISTINCT assessment_method FROM business.strategic_outcome_review WHERE founder_id='${founderId}';`)).toBe('DETERMINISTIC_COMPOSITION');
  expect(sql(`SELECT DISTINCT model_configuration::text FROM business.strategic_outcome_review WHERE founder_id='${founderId}';`)).toBe('{}');
});
