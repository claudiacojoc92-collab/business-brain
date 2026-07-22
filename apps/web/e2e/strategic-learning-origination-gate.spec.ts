import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Strategic Learning Origination Gate (ADR-017). Retrospective learning is created
 * ONLY via: Outcome Review → Learning Candidate (a PROPOSAL — creates nothing) → explicit founder ACCEPT → Strategic
 * Learning (origin=OUTCOME_REVIEW). Proving: proposing a candidate creates NO learning; DISMISS creates nothing; ACCEPT
 * creates a learning with origin OUTCOME_REVIEW and NEVER a promotion. No direct fetch for the flow. Requires dev DB +
 * API :3000 + vite.
 */
const EMAIL = `logate.e2e.${Date.now()}@understand.test`;
const PASSWORD = 'logatee2e-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
const REV1 = 'LOGATEPLAN00000000000000000000001';
let founderId = '';
const item = 'ship-weekly';
const MILESTONES = JSON.stringify([{ id: 'ship-weekly', label: 'Ship weekly', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' }]).replace(/'/g, "''");
function planRow(id: string): string {
  return `INSERT INTO business.strategic_plan_record (id, founder_id, logical_plan_id, revision, lifecycle, supersedes_id, commitment_record_id, commitment_logical_id, commitment_revision, commitment_schema_version, alignment_at_planning, title, strategic_intent, scope, milestones, assumptions, dependencies, resource_constraints, review_conditions, exit_conditions, acknowledged_insufficient_evidence, conflicts, authorship, activated_at, idempotency_key, created_at) VALUES ('${id}','${founderId}','${id}',1,'CREATE',NULL,'com-x','com-x',1,'strategic-commitment-1','ALIGNED','Cadence plan','Push the channel','CHANNEL','${MILESTONES}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'["Review at 30 days"]'::jsonb,'[]'::jsonb,false,'[]'::jsonb,'{}'::jsonb, now(), 'idem-${id}', now());`;
}
function cleanup(): void {
  sql(`SET bb.allow_execution_report_delete='on'; SET bb.allow_strategic_review_delete='on'; SET bb.allow_snapshot_delete='on'; SET bb.allow_learning_delete='on'; SET bb.allow_learning_candidate_delete='on'; DELETE FROM business.learning_candidate_decision WHERE founder_id='${founderId}'; DELETE FROM business.learning_candidate WHERE founder_id='${founderId}'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}'; DELETE FROM business.strategic_outcome_review WHERE founder_id='${founderId}'; DELETE FROM business.execution_report WHERE founder_id='${founderId}'; DELETE FROM business.context_snapshot WHERE founder_id='${founderId}'; DELETE FROM business.strategic_plan_record WHERE founder_id='${founderId}'; DELETE FROM business.understanding WHERE founder_id='${founderId}';`);
}

test.beforeAll(async ({ request }) => {
  founderId = sql(`SELECT founder_id FROM identity.founders WHERE email='${EMAIL}';`);
  if (!founderId) { const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } }); founderId = (await res.json()).founder_id as string; }
  cleanup();
  sql(`INSERT INTO business.understanding (id, founder_id, version, supersedes_id, model_version, source_fragment_ids, conclusions, created_at) VALUES ('BU-LOGATE','${founderId}',1,NULL,'logate-seed','["f"]'::jsonb,'[{"id":"concl-a","type":"what_it_is","statement":"A SaaS.","epistemicStatus":"OBSERVED","evidenceRefs":["f"],"confidence":"high","confirmationState":"confirmed","founderCorrection":null}]'::jsonb, now());`);
  sql(planRow(REV1));
});
test.afterAll(async () => { if (founderId) cleanup(); });

async function signIn(page: Page) {
  await page.goto('/signin');
  await page.getByRole('textbox').first().fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/signin') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  expect(resp.status()).toBe(200);
  await page.waitForURL((u) => !u.pathname.includes('/signin'), { timeout: 15_000 });
  await page.goto('/strategy');
  await expect(page.getByTestId(`plan-${REV1}`)).toBeVisible();
}
const plan = (p: Page) => p.getByTestId(`plan-${REV1}`);
const tid = `${REV1}-1`; // planId-seq for the first outcome review

test('retrospective learning is gated: propose a candidate (no learning), dismiss, then accept → an OUTCOME_REVIEW learning, never a promotion', async ({ page }) => {
  await signIn(page);

  // report execution so the review describes something
  await plan(page).getByTestId(`exec-add-${item}`).click();
  await plan(page).getByTestId('exec-report-state').selectOption('ATTEMPTED');
  await plan(page).getByTestId('exec-report-statement').fill('Shipped twice.');
  await plan(page).getByTestId('exec-report-submit').click();
  await expect(plan(page).getByTestId(`exec-state-${item}`)).toHaveText('Reported attempted');

  // record an outcome review (creates its own snapshot)
  await plan(page).getByTestId(`outcome-review-open-${REV1}`).click();
  await plan(page).getByTestId(`outcome-create-snapshot-${REV1}`).click();
  await expect(plan(page).getByTestId(`outcome-snapshot-${REV1}`)).toBeVisible();
  await plan(page).getByTestId(`outcome-select-${REV1}`).selectOption('PARTIALLY_AS_INTENDED');
  await plan(page).getByTestId(`outcome-statement-${REV1}`).fill('We shipped for three weeks, then paused.');
  await plan(page).getByTestId(`outcome-submit-${REV1}`).click();
  await expect(plan(page).getByTestId(`outcome-review-item-${REV1}-1`)).toBeVisible();

  // ── the gate: no candidate yet, and NO learning ──
  await expect(plan(page).getByTestId(`candidates-none-${tid}`)).toBeVisible();
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('0');

  // ── propose a candidate → still NO learning (it is a proposal) ──
  await plan(page).getByTestId(`candidate-propose-open-${tid}`).click();
  await plan(page).getByTestId(`candidate-statement-${tid}`).fill('Outreach cadence may be our durable channel.');
  await plan(page).getByTestId(`candidate-propose-submit-${tid}`).click();
  const candId = () => sql(`SELECT id FROM business.learning_candidate WHERE founder_id='${founderId}' ORDER BY created_at DESC LIMIT 1;`);
  await expect(plan(page).getByTestId(`candidate-status-${candId()}`)).toHaveText(/proposed/i);
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('0'); // proposal created NO learning
  await plan(page).getByTestId(`candidates-${tid}`).screenshot({ path: 'e2e/__evidence__/logate-candidate-proposed.png' }).catch(() => {});

  // ── dismiss it → still NO learning ──
  const c1 = candId();
  await plan(page).getByTestId(`candidate-dismiss-${c1}`).click();
  await expect(plan(page).getByTestId(`candidate-status-${c1}`)).toHaveText(/dismissed/i);
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('0');

  // ── propose again, then ACCEPT with an explicit learning judgment → creates an OUTCOME_REVIEW learning ──
  await plan(page).getByTestId(`candidate-propose-open-${tid}`).click();
  await plan(page).getByTestId(`candidate-statement-${tid}`).fill('Founder-led outreach converts at our stage.');
  await plan(page).getByTestId(`candidate-propose-submit-${tid}`).click();
  const c2 = candId();
  await plan(page).getByTestId(`candidate-accept-open-${c2}`).click();
  await plan(page).getByTestId(`accept-statement-${c2}`).fill('Founder-led outreach converts; ads at our stage don’t.');
  await plan(page).getByTestId(`accept-prior-${c2}`).fill('I believed ads were fastest.');
  await plan(page).getByTestId(`accept-revised-${c2}`).fill('Outreach is our fastest channel now.');
  await plan(page).getByTestId(`accept-change-${c2}`).fill('Moved from ads-first to outreach-first.');
  await plan(page).getByTestId(`accept-category-${c2}`).selectOption('EXECUTION');
  await plan(page).getByTestId(`accept-confidence-${c2}`).selectOption('PROVISIONAL');
  await plan(page).getByTestId(`accept-scope-${c2}`).selectOption('THIS_CHANNEL');
  await plan(page).getByTestId(`candidate-accept-submit-${c2}`).click();
  await expect(plan(page).getByTestId(`candidate-status-${c2}`)).toHaveText(/accepted/i);
  await plan(page).getByTestId(`candidates-${tid}`).screenshot({ path: 'e2e/__evidence__/logate-candidate-accepted.png' }).catch(() => {});

  // ── DB invariants: exactly one learning, origin OUTCOME_REVIEW, bound to the review + candidate, and ZERO promotions ──
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('1');
  expect(sql(`SELECT learning_origin FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('OUTCOME_REVIEW');
  expect(sql(`SELECT (outcome_review_id IS NOT NULL AND learning_candidate_id='${c2}' AND review_record_id IS NULL) FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('t');
  expect(sql(`SELECT count(*) FROM business.learning_promotion_event WHERE founder_id='${founderId}';`)).toBe('0'); // ACCEPT never promotes
  // the decision is recorded exactly once with the resulting learning
  expect(sql(`SELECT verdict FROM business.learning_candidate_decision WHERE founder_id='${founderId}' AND candidate_id='${c2}';`)).toBe('ACCEPT');
});
