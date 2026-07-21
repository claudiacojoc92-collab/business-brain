import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * GENUINE rendered-UI acceptance for the Strategic Learning Record (remediation Part 3). Drives the ACTUAL controls of
 * the rendered app — sign in, walk decision → commitment → plan → review through visible forms, then open and complete
 * the LearningPanel, submit with the visible button, observe the saved state, refresh, and verify the kept learning (with
 * its source review) survives. Also exercises visible validation (disabled submit, broad-scope acknowledgement, and the
 * server-side causal-claim guard). Requires the dev DB + the API on :3000 + vite (with /api proxy) — started by the runner.
 */
const EMAIL = 'slr.e2e@understand.test';
const PASSWORD = 'slre2epass-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }

const REC = JSON.stringify({
  recommendation: { title: 'Prioritize founder-led outreach', action: 'Spend the next 30 days on founder-led outreach.', horizon: '30 days' },
  reasoning: { supportingEvidence: [{ kind: 'STRATEGIC_RECOMMENDATION', statement: 'Early inbound came from founder posts.', validated: true }], founderDeclarations: [], assumptions: [], conflicts: [], unknowns: [], counterEvidence: [] },
  confidence: { evidenceStrength: 'MEDIUM', founderConfirmation: 'MEDIUM', marketContextQuality: 'LOW', contradictionLevel: 'LOW', unknownBurden: 'MEDIUM' },
  alternatives: [{ option: 'Run paid ads', whyNotFirst: 'weaker at this stage', whenItBecomesPreferable: 'once messaging is proven' }],
  whatWouldChangeThisRecommendation: ['If outreach stops converting'],
  nextStep: { action: 'Post 3x/week and DM 10 prospects', successSignal: '2+ demo requests', reviewAfter: '30 days' },
});

let founderId = '';
const sessionId = 'E2ESLRSESSION0000000000000001';

test.beforeAll(async ({ request }) => {
  // resolve the founder WITHOUT hammering auth (rate-limited): read the id from the DB; create once only if absent.
  founderId = sql(`SELECT founder_id FROM identity.founders WHERE email='${EMAIL}';`);
  if (!founderId) {
    const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } });
    founderId = (await res.json()).founder_id as string;
  }
  // clean any prior e2e rows for this founder, then seed ONE READY session (no model call needed)
  for (const t of ['strategic_learning_record', 'strategic_plan_review_record', 'strategic_plan_record', 'strategic_commitment_record', 'strategic_decision_record', 'strategic_response', 'strategic_session']) {
    sql(`DELETE FROM business.${t} WHERE founder_id='${founderId}';`);
  }
  const rec = REC.replace(/'/g, "''");
  sql(`INSERT INTO business.strategic_session (id, founder_id, status, strategic_job, subtype, question_text, decision_horizon, recommendation, model_id, prompt_version, schema_version, attempt_count, max_attempts, started_at, finished_at, created_at, updated_at) VALUES ('${sessionId}','${founderId}','READY','PRIORITY_DECISION','CHANNEL_PRIORITY','Which channel should I prioritize?','30 days','${rec}'::jsonb,'seed-stub','seed',NULL,1,3,now(),now(),now(),now());`);
});

test.afterAll(async () => {
  if (!founderId) return;
  for (const t of ['strategic_learning_record', 'strategic_plan_review_record', 'strategic_plan_record', 'strategic_commitment_record', 'strategic_decision_record', 'strategic_response', 'strategic_session']) {
    sql(`DELETE FROM business.${t} WHERE founder_id='${founderId}';`);
  }
});

async function signIn(page: Page) {
  await page.goto('/signin');
  await page.getByRole('textbox').first().fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/auth/signin') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  expect(resp.status(), 'sign-in must succeed (200); a 500 here means the auth rate-limit window has not reset').toBe(200);
  await page.waitForURL((u) => !u.pathname.includes('/signin'), { timeout: 15_000 }); // app navigates away on success
  // auth is confirmed by reaching an authenticated page (unauthenticated → redirect to /login, text absent)
  await page.goto('/strategy');
  await expect(page.getByText('Prioritize founder-led outreach').first()).toBeVisible();
}

test('founder records a durable learning through the rendered UI; it persists and changes nothing else', async ({ page }) => {
  await signIn(page); // signs in through the UI and lands on an authenticated /strategy

  // ── Decision (separate, explicit act) ───────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Record a decision' }).click();
  await page.getByRole('radio').first().check();
  await page.getByPlaceholder("e.g. I’m committing my posting time to LinkedIn for the next 30 days.").fill('I choose founder-led outreach for the next 30 days.');
  await page.getByRole('button', { name: 'Confirm this decision' }).click();

  // ── Commitment ──────────────────────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Create a commitment from this decision' }).click();
  await page.getByPlaceholder(/I’ll keep LinkedIn as my primary channel/).fill('Keep founder-led outreach as our channel focus until review.');
  await page.getByPlaceholder(/If demo volume drops below 5\/week/).fill('If demo volume drops below 5/week for a month, reopen this.');
  await page.getByRole('button', { name: 'Confirm this commitment' }).click();

  // ── Plan ────────────────────────────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Create a plan' }).click();
  await page.getByPlaceholder('e.g. 30-day LinkedIn cadence').fill('Founder-led outreach cadence');
  await page.getByPlaceholder(/How you intend to translate the commitment/).fill('Post 3x/week and DM 10 prospects.');
  await page.getByPlaceholder(/Establish a 3x\/week posting rhythm/).fill('Establish a 3x/week posting rhythm');
  await page.getByPlaceholder('e.g. Review the plan at 30 days.').fill('Review at 30 days.');
  await page.getByRole('button', { name: 'Activate this plan' }).click();

  // ── Review (separate; changes nothing) ──────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Review this plan' }).click();
  await page.getByPlaceholder('e.g. Posted 12 times; 3 demo requests came in.').fill('Posted 12 times; 3 demo requests came in.');
  const concl = page.getByLabel('Review conclusion');
  await concl.selectOption('MIXED_EVIDENCE');
  await expect(concl).toHaveValue('MIXED_EVIDENCE');
  const disp = page.getByLabel('Review disposition');
  await disp.selectOption('GATHER_MORE_INFORMATION');
  await expect(disp).toHaveValue('GATHER_MORE_INFORMATION');
  const recordBtn = page.getByRole('button', { name: 'Record this review' });
  await expect(recordBtn).toBeEnabled();
  await recordBtn.click();
  await expect(page.getByText('Your review on record')).toBeVisible();

  // ── Learning — the panel under test, driven through visible controls ────────────────────────────
  await page.getByRole('button', { name: 'Record a learning from this review' }).click();
  const form = page.getByTestId('learning-form');
  await expect(form).toBeVisible();
  await expect(form).toContainText('It does not modify Business Understanding');
  await expect(form).toContainText('It does not modify Founder Strategic Context');

  await page.getByTestId('learning-statement').fill('Founder-led outreach converts at our stage; paid ads don’t.');
  await page.getByTestId('learning-prior').fill('I believed paid ads would be the fastest channel.');
  await page.getByTestId('learning-revised').fill('Founder-led outreach is our fastest channel right now.');
  await page.getByTestId('learning-change').fill('I moved from ads-first to outreach-first for this stage.');
  await page.getByTestId('learning-category').selectOption('EXECUTION');
  await page.getByTestId('learning-scope').selectOption('THIS_CHANNEL');

  // visible validation: with confidence unchosen, the keep control is disabled
  await expect(page.getByRole('button', { name: 'Keep this learning' })).toBeDisabled();

  // visible server-side validation: a causal claim marked SUPPORTED (founder-reported only) is rejected
  await page.getByTestId('causal-flag').check();
  await page.getByTestId('learning-confidence').selectOption('SUPPORTED');
  await page.getByRole('button', { name: 'Keep this learning' }).click();
  await expect(page.getByTestId('learning-error')).toBeVisible();
  await expect(page.getByTestId('learning-error')).toContainText(/causal claim/i);

  // correct it to a bounded epistemic state and keep
  await page.getByTestId('causal-flag').uncheck();
  await page.getByTestId('learning-confidence').selectOption('PROVISIONAL');
  await page.getByRole('button', { name: 'Keep this learning' }).click();

  const savedPanel = page.getByTestId('learning-saved');
  await expect(savedPanel).toBeVisible();
  await expect(savedPanel).toContainText('Durable strategic learning');
  await expect(savedPanel).toContainText('It does not modify Business Understanding');
  await expect(savedPanel).toContainText('It does not modify Founder Strategic Context');
  await savedPanel.screenshot({ path: 'e2e/__evidence__/learning-saved.png' }).catch(() => {});

  // ── Refresh: the kept learning survives, with its source review visible ─────────────────────────
  await page.reload();
  const list = page.getByTestId('learnings-list');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Founder-led outreach converts at our stage');
  await expect(list.getByTestId('learning-source-review').first()).toBeVisible();
  await expect(list).toContainText('Does not modify Business Understanding');
  await list.screenshot({ path: 'e2e/__evidence__/learnings-list-after-refresh.png' }).catch(() => {});

  // ── No other governed object changed: exactly one learning, review unchanged, no BU/FSC written ──
  expect(sql(`SELECT count(*) FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('1');
  expect(sql(`SELECT review_conclusion FROM business.strategic_plan_review_record WHERE founder_id='${founderId}';`)).toBe('MIXED_EVIDENCE');
  expect(sql(`SELECT count(*) FROM business.understanding WHERE founder_id='${founderId}';`)).toBe('0');
  expect(sql(`SELECT count(*) FROM business.founder_strategic_context_item WHERE founder_id='${founderId}';`)).toBe('0');
  expect(sql(`SELECT confidence FROM business.strategic_learning_record WHERE founder_id='${founderId}';`)).toBe('PROVISIONAL');

  // ── The founder is never nudged: after refresh (a fresh session view, no in-page review), no learning form is forced ──
  await page.goto('/strategy');
  await expect(page.getByTestId('learnings-list')).toBeVisible(); // the kept learning persists…
  await expect(page.getByRole('button', { name: 'Record a learning from this review' })).toHaveCount(0); // …but nothing prompts another (learning stays optional)
});
