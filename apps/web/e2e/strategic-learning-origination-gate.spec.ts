import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Strategic Learning Origination Gate completion (ADR-017 V088). Retrospective
 * learning is gated: Outcome Review → Learning Candidate (an append-only REVISIONED proposal — creates nothing) → explicit
 * founder judgment (ADOPT/REJECT/DEFER/WITHDRAW) → Strategic Learning (origin=OUTCOME_REVIEW). Drives: propose (no learning)
 * → edit (rev 2; rev 1 immutable) → defer (no learning) → adopt (exactly one OUTCOME_REVIEW learning, zero promotion,
 * unknown+contradiction disclosed) → propose another → reject (rejected history visible). No direct fetch for the flow.
 */
const EMAIL = `logate3.e2e.${Date.now()}@understand.test`;
const PASSWORD = 'logate3e2e-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
const REV1 = 'LOGATE3PLAN0000000000000000000001';
let founderId = '';
const item = 'ship-weekly';
const MILESTONES = JSON.stringify([{ id: 'ship-weekly', label: 'Ship weekly', intendedState: 'live', sequence: 1, confirmationCondition: null, targetWindow: null, dependencies: [], uncertainty: null, statusAtPlanning: 'PLANNED' }]).replace(/'/g, "''");
function planRow(id: string): string {
  return `INSERT INTO business.strategic_plan_record (id, founder_id, logical_plan_id, revision, lifecycle, supersedes_id, commitment_record_id, commitment_logical_id, commitment_revision, commitment_schema_version, alignment_at_planning, title, strategic_intent, scope, milestones, assumptions, dependencies, resource_constraints, review_conditions, exit_conditions, acknowledged_insufficient_evidence, conflicts, authorship, activated_at, idempotency_key, created_at) VALUES ('${id}','${founderId}','${id}',1,'CREATE',NULL,'com-x','com-x',1,'strategic-commitment-1','ALIGNED','Cadence plan','Push the channel','CHANNEL','${MILESTONES}'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'["Review at 30 days"]'::jsonb,'[]'::jsonb,false,'[]'::jsonb,'{}'::jsonb, now(), 'idem-${id}', now());`;
}
function cleanup(): void {
  sql(`SET bb.allow_execution_report_delete='on'; SET bb.allow_strategic_review_delete='on'; SET bb.allow_snapshot_delete='on'; SET bb.allow_learning_delete='on'; SET bb.allow_learning_candidate_delete='on'; DELETE FROM business.learning_candidate_decision WHERE founder_id='${founderId}'; DELETE FROM business.learning_candidate WHERE founder_id='${founderId}'; DELETE FROM business.strategic_learning_record WHERE founder_id='${founderId}'; DELETE FROM business.strategic_outcome_review WHERE founder_id='${founderId}'; DELETE FROM business.execution_report WHERE founder_id='${founderId}'; DELETE FROM business.context_snapshot WHERE founder_id='${founderId}'; DELETE FROM business.strategic_plan_record WHERE founder_id='${founderId}'; DELETE FROM business.understanding WHERE founder_id='${founderId}';`);
}
const learnings = () => sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}';`);

test.beforeAll(async ({ request }) => {
  founderId = sql(`SELECT founder_id FROM identity.founders WHERE email='${EMAIL}';`);
  if (!founderId) { const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } }); founderId = (await res.json()).founder_id as string; }
  cleanup();
  sql(`INSERT INTO business.understanding (id, founder_id, version, supersedes_id, model_version, source_fragment_ids, conclusions, created_at) VALUES ('BU-LG3','${founderId}',1,NULL,'lg3-seed','["f"]'::jsonb,'[{"id":"concl-a","type":"what_it_is","statement":"A SaaS.","epistemicStatus":"OBSERVED","evidenceRefs":["f"],"confidence":"high","confirmationState":"confirmed","founderCorrection":null}]'::jsonb, now());`);
  sql(planRow(REV1));
});
test.afterAll(async () => { if (founderId) cleanup(); });

async function signIn(page: Page) {
  await page.goto('/signin');
  await page.getByRole('textbox').first().fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  const [resp] = await Promise.all([page.waitForResponse((r) => r.url().includes('/api/auth/signin') && r.request().method() === 'POST'), page.getByRole('button', { name: 'Sign in' }).click()]);
  expect(resp.status()).toBe(200);
  await page.waitForURL((u) => !u.pathname.includes('/signin'), { timeout: 15_000 });
  await page.goto('/strategy');
  await expect(page.getByTestId(`plan-${REV1}`)).toBeVisible();
}
const plan = (p: Page) => p.getByTestId(`plan-${REV1}`);
const tid = `${REV1}-1`;

async function fillForm(page: Page, idp: string, statement: string) {
  await plan(page).getByTestId(`cand-statement-${idp}`).fill(statement);
  await plan(page).getByTestId(`cand-founder-${idp}`).fill('In our words: outreach worked.');
  await plan(page).getByTestId(`cand-prior-${idp}`).fill('Ads fastest.');
  await plan(page).getByTestId(`cand-revised-${idp}`).fill('Outreach fastest.');
  await plan(page).getByTestId(`cand-change-${idp}`).fill('Moved to outreach.');
  await plan(page).getByTestId(`cand-unknowns-${idp}`).fill('Whether it scales.');
  await plan(page).getByTestId(`cand-contradictions-${idp}`).fill('One week we paused.');
  await plan(page).getByTestId(`cand-obs-${idp}-${item}`).check();
  await plan(page).getByTestId(`cand-category-${idp}`).selectOption('EXECUTION');
  await plan(page).getByTestId(`cand-scope-${idp}`).selectOption('THIS_CHANNEL');
  await plan(page).getByTestId(`cand-epistemic-${idp}`).selectOption('PROVISIONAL');
}

test('retrospective learning is gated through a revisioned candidate: propose → edit → defer → adopt (one OUTCOME_REVIEW learning, never a promotion); reject leaves history', async ({ page }) => {
  await signIn(page);

  // report execution (gives the outcome review a selectable observation)
  await plan(page).getByTestId(`exec-add-${item}`).click();
  await plan(page).getByTestId('exec-report-state').selectOption('ATTEMPTED');
  await plan(page).getByTestId('exec-report-statement').fill('Shipped twice.');
  await plan(page).getByTestId('exec-report-submit').click();
  await expect(plan(page).getByTestId(`exec-state-${item}`)).toHaveText('Reported attempted');

  // record an outcome review (the frozen context is minted automatically — no separate snapshot step)
  await plan(page).getByTestId(`outcome-review-open-${REV1}`).click();
  await plan(page).getByTestId(`outcome-select-${REV1}`).selectOption('PARTIALLY_AS_INTENDED');
  await plan(page).getByTestId(`outcome-statement-${REV1}`).fill('We shipped for three weeks, then paused.');
  await expect(plan(page).getByTestId(`outcome-submit-${REV1}`).locator('xpath=ancestor::button')).toBeEnabled(); // snapshot auto-minted
  await plan(page).getByTestId(`outcome-submit-${REV1}`).click();
  await expect(plan(page).getByTestId(`outcome-review-item-${REV1}-1`)).toBeVisible();

  // ── propose a candidate → NO learning ──
  await expect(plan(page).getByTestId(`candidates-none-${tid}`)).toBeVisible();
  await plan(page).getByTestId(`candidate-propose-open-${tid}`).click();
  await fillForm(page, tid, 'Outreach cadence may be our durable channel.');
  await plan(page).getByTestId(`candidate-submit-${tid}`).click();
  const lid = () => sql(`SELECT logical_candidate_id FROM business.learning_candidate WHERE founder_id='${founderId}' ORDER BY created_at DESC LIMIT 1;`);
  const L1 = lid();
  await expect(plan(page).getByTestId(`candidate-rev-${L1}`)).toHaveText('1');
  await expect(plan(page).getByTestId(`candidate-status-${L1}`)).toHaveText(/possible learning/i);
  await expect(plan(page).getByTestId(`candidate-unknown-${L1}`)).toContainText('Whether it scales.'); // unknown disclosed (collapsed)
  await expect(plan(page).getByTestId(`candidate-cuts-${L1}`)).toContainText('One week we paused.'); // contradiction disclosed (collapsed)
  expect(learnings()).toBe('0');
  await plan(page).getByTestId(`candidates-${tid}`).screenshot({ path: 'e2e/__evidence__/logate-candidate-proposed.png' }).catch(() => {});

  // ── edit → revision 2; revision 1 stays immutable in the DB ──
  await plan(page).getByTestId(`candidate-edit-open-${L1}`).click();
  await plan(page).getByTestId(`cand-statement-${L1}`).fill('Founder-led outreach converts at our stage.');
  await plan(page).getByTestId(`candidate-submit-${L1}`).click();
  await expect(plan(page).getByTestId(`candidate-rev-${L1}`)).toHaveText('2');
  expect(sql(`SELECT count(*) FROM business.learning_candidate WHERE founder_id='${founderId}' AND logical_candidate_id='${L1}';`)).toBe('2');
  expect(sql(`SELECT candidate_statement FROM business.learning_candidate WHERE founder_id='${founderId}' AND logical_candidate_id='${L1}' AND revision=1;`)).toBe('Outreach cadence may be our durable channel.'); // rev1 immutable
  expect(learnings()).toBe('0');

  // ── defer → NO learning; still eligible ──
  await plan(page).getByTestId(`candidate-defer-${L1}`).click();
  await expect(plan(page).getByTestId(`candidate-status-${L1}`)).toHaveText(/not yet/i);
  expect(learnings()).toBe('0');

  // ── adopt the latest revision → EXACTLY ONE OUTCOME_REVIEW learning; zero promotion ──
  await plan(page).getByTestId(`candidate-adopt-${L1}`).click();
  await expect(plan(page).getByTestId(`candidate-status-${L1}`)).toHaveText(/kept/i);
  await plan(page).getByTestId(`candidate-${L1}`).screenshot({ path: 'e2e/__evidence__/logate-candidate-adopted.png' }).catch(() => {});
  expect(learnings()).toBe('1');
  expect(sql(`SELECT learning_origin FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('OUTCOME_REVIEW');
  expect(sql(`SELECT (learning_candidate_id IS NOT NULL AND outcome_review_id IS NOT NULL AND review_record_id IS NULL) FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('t');
  // adopted learning PRESERVES the candidate's unknowns + contradictions
  expect(sql(`SELECT unresolved_unknowns::text FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toContain('Whether it scales.');
  expect(sql(`SELECT counter_evidence::text FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toContain('One week we paused.');
  expect(sql(`SELECT count(*) FROM business.learning_promotion_event WHERE founder_id='${founderId}';`)).toBe('0'); // NEVER promotes
  expect(sql(`SELECT count(*) FROM business.founder_strategic_context_item WHERE founder_id='${founderId}';`)).toBe('0'); // no effective-context change

  // ── propose a SECOND candidate and REJECT it → no new learning; rejected history remains visible ──
  await plan(page).getByTestId(`candidate-propose-open-${tid}`).click();
  await fillForm(page, tid, 'Weekly demos are the leading signal.');
  await plan(page).getByTestId(`candidate-submit-${tid}`).click();
  const L2 = lid();
  await plan(page).getByTestId(`candidate-reject-${L2}`).click();
  await expect(plan(page).getByTestId(`candidate-status-${L2}`)).toHaveText(/discarded/i);
  await expect(plan(page).getByTestId(`candidate-${L2}`)).toBeVisible(); // rejected candidate stays visible
  expect(learnings()).toBe('1'); // still exactly one learning
});
