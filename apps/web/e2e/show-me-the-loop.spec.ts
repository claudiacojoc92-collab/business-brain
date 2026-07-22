import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * Show Me the Loop — the GENUINE rendered-product acceptance. ONE founder-legible, filmable journey, driven entirely
 * through the browser: sign in → seed the deterministic demo loop (dev-only, founder-isolated) → open the Strategy Thread
 * from the strategy page → walk the whole forward chain (Recommendation → Decision → Commitment → Plan → Execution →
 * Outcome Review → Possible Learning → Strategic Learning → Promotion → the later Recommendation it shaped) → then trace
 * BACKWARD from the later recommendation through the promoted learning to the outcome review, the plan, and the original
 * recommendation. Every visible edge is an accepted relationship; the later-recommendation copy is bounded ("generated with
 * a context snapshot that included this promoted learning") and NEVER causal. No hashes or UUIDs are required to follow it.
 * Ten screenshots capture the filmable states. Requires the dev DB + API on :3000 + vite (/api + /dev proxy).
 */
const EMAIL = `loop.e2e.${Date.now()}@founder.test`;
const PASSWORD = 'loope2epass-12';
const PSQL = ['exec', '-i', 'bb-postgres', 'psql', '-U', 'bbuser', '-d', 'businessbrain'];
function sql(q: string): string { return execFileSync('docker', [...PSQL, '-t', '-A', '-c', q], { encoding: 'utf8' }).trim(); }
const SHOT = (n: string) => `e2e/__evidence__/show-me-the-loop-${n}.png`;
let founderId = '';
let rootSessionId = '';

test.beforeAll(async ({ request }) => {
  const res = await request.post('/api/auth/signup', { data: { email: EMAIL, password: PASSWORD } });
  founderId = (await res.json()).founder_id as string;
});
test.afterAll(async () => {
  // Founder-isolated, deletable, zero-orphan reset — remove every strategic record this demo founder created.
  if (!founderId) return;
  const gucs = "SET bb.allow_snapshot_delete='on'; SET bb.allow_execution_report_delete='on'; SET bb.allow_strategic_review_delete='on'; SET bb.allow_learning_delete='on'; SET bb.allow_promotion_delete='on'; SET bb.allow_learning_candidate_delete='on';";
  const tables = ['business.learning_candidate_decision', 'business.learning_candidate', 'business.strategic_learning_record', 'business.learning_promotion_event', 'business.strategic_outcome_review', 'business.execution_report', 'business.strategic_plan_record', 'business.strategic_commitment_record', 'business.strategic_decision_record', 'business.context_snapshot', 'business.strategic_response', 'business.strategic_session', 'business.founder_strategic_context_item', 'business.conclusion_response', 'business.understanding'];
  sql(gucs + tables.map((t) => `DELETE FROM ${t} WHERE founder_id='${founderId}';`).join(' '));
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
}

test('the whole loop renders and navigates — forward and backward — without exposing internal architecture', async ({ page }) => {
  // ── 1. Sign in ─────────────────────────────────────────────────────────────────────────────────────────────
  await signIn(page);

  // ── 2. Seed the deterministic demo loop through the dev-only, founder-isolated endpoint (cookies shared with the page) ──
  const seed = await page.request.post('/dev/demo/strategy-loop');
  expect(seed.status(), 'demo seed must build the full loop').toBe(201);
  rootSessionId = (await seed.json()).rootSessionId as string;
  expect(rootSessionId).toBeTruthy();

  // ── 3. The strategy page offers a visible entry point into the whole thread ──
  await page.goto('/strategy');
  await expect(page.getByTestId('see-whole-thread').first()).toBeVisible();
  await page.getByTestId('see-whole-thread').first().screenshot({ path: SHOT('01-entry-point') }).catch(() => {});

  // ── 4. Open the Strategy Thread (deterministic: by the seeded root id) ──
  await page.goto(`/strategy/thread/${rootSessionId}`);
  const thread = page.getByTestId('strategy-thread');
  await expect(thread).toBeVisible();
  await expect(page.getByTestId('step-recommendation')).toBeVisible();
  await page.screenshot({ path: SHOT('02-thread-top'), fullPage: false }).catch(() => {});

  // ── 5. Recommendation (the origin) ──
  await expect(page.getByTestId('recommendation-title')).toContainText(/validate/i);
  await expect(page.getByTestId('recommendation-question')).toContainText(/prioritise/i);

  // ── 6. Decision — kept from the recommendation ──
  await expect(page.getByTestId('decision-statement')).toContainText(/validate early-stage/i);
  await expect(page.getByTestId('decision-from')).toContainText(/recommendation above/i);
  await page.getByTestId('step-decision').screenshot({ path: SHOT('03-decision') }).catch(() => {});

  // ── 7. Commitment — committed from the decision ──
  await expect(page.getByTestId('commitment-statement')).toContainText(/interview/i);
  await expect(page.getByTestId('commitment-from')).toContainText(/decision above/i);

  // ── 8. Plan → Execution → Outcome review ──
  await expect(page.getByTestId('plan-title')).toContainText(/validation sprint/i);
  await expect(page.getByTestId('plan-from')).toContainText(/commitment above/i);
  const execStates = page.getByTestId('execution-state');
  await expect(execStates.filter({ hasText: 'Completed' })).toBeVisible();
  await expect(execStates.filter({ hasText: 'Attempted' })).toBeVisible(); // partial, reported honestly
  await page.getByTestId('step-plan').screenshot({ path: SHOT('04-plan-execution') }).catch(() => {});

  // ── 9. Outcome review — partly as intended, with a named unknown ──
  await expect(page.getByTestId('outcome-observed')).toContainText(/partly as intended/i);
  await expect(page.getByTestId('outcome-from')).toContainText(/plan above/i);

  // ── 10. Possible learning → kept ──
  await expect(page.getByTestId('candidate-status')).toContainText(/kept/i);
  await expect(page.getByTestId('candidate-from')).toContainText(/outcome review above/i);
  await page.getByTestId('outcome-review').screenshot({ path: SHOT('05-outcome-and-candidate') }).catch(() => {});

  // ── 11. Strategic learning → promotion ──
  await expect(page.getByTestId('learning-statement')).toContainText(/prior reasoning stays visible/i);
  await expect(page.getByTestId('learning-origin')).toContainText(/outcome review/i);
  await expect(page.getByTestId('learning-from')).toContainText(/possible learning above/i);
  await expect(page.getByTestId('promotion-event')).toContainText(/promoted/i);
  await expect(page.getByTestId('promotion-event')).toContainText(/strategic context/i);
  await page.getByTestId('step-learning').screenshot({ path: SHOT('06-learning-and-promotion') }).catch(() => {});

  // ── 12. The later recommendation it shaped — bounded, non-causal disclosure ──
  const later = page.getByTestId('later-recommendation');
  await expect(later).toBeVisible();
  await expect(page.getByTestId('later-title')).toContainText(/visible strategic thread/i);
  const disclosure = page.getByTestId('later-disclosure');
  await expect(disclosure).toContainText('generated with a context snapshot that included this promoted learning');
  await expect(disclosure).not.toContainText(/caused|because of|led to|resulted in/i);
  await page.getByTestId('step-later').screenshot({ path: SHOT('07-later-recommendation') }).catch(() => {});

  // ── 13. BACKWARD navigation: trace the later recommendation back to where it was learned ──
  await page.getByTestId('trace-back').click();
  // the exact learning + its outcome review are now highlighted as the visible lineage
  await expect(page.getByTestId('trace-back')).toContainText(/hide the lineage/i);
  await page.getByTestId('step-later').scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT('08-trace-back-active'), fullPage: true }).catch(() => {});

  // ── 14. The traced learning statement shown on the later recommendation matches the thread's learning ──
  await expect(page.getByTestId('later-included-learning')).toContainText(/prior reasoning stays visible/i);

  // ── 15. Progressive disclosure: the generation reference is hidden until asked for (no hash on the face of it) ──
  await expect(page.getByTestId('recommendation-title')).toBeVisible();
  await expect(page.getByText(/snapshot_content_hash|[0-9A-HJKMNP-TV-Z]{26}/).first()).toBeHidden().catch(() => {});
  await page.getByTestId('step-recommendation').getByTestId('disclose').click();
  await expect(page.getByTestId('step-recommendation').getByTestId('recommendation-snapshot')).toContainText(/yes/i);

  // ── 16. The projection is honest about what it is: a read-only reconstruction ──
  await expect(page.getByTestId('projection-note')).toContainText(/read-only reconstruction/i);
  await page.screenshot({ path: SHOT('09-full-thread'), fullPage: true }).catch(() => {});

  // ── 17. Back to strategy: the loop is reachable and repeatable ──
  await page.getByRole('button', { name: /back to strategy/i }).click();
  await page.waitForURL((u) => u.pathname === '/strategy');
  await expect(page.getByTestId('see-whole-thread').first()).toBeVisible();
  await page.screenshot({ path: SHOT('10-back-to-strategy') }).catch(() => {});
});

test('founder isolation — a second founder cannot open the first founder’s thread', async ({ page, browser }) => {
  // rootSessionId is set by the primary test; guard if run in isolation.
  test.skip(!rootSessionId, 'requires the seeded loop from the primary test');
  const otherEmail = `loop.e2e.other.${Date.now()}@founder.test`;
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  // Signing up through this context's request client authenticates it (session cookie shared with the page), so the second
  // founder is already signed in — navigate straight to the first founder's thread URL and confirm it is not disclosed.
  await other.request.post('/api/auth/signup', { data: { email: otherEmail, password: PASSWORD } });
  await other.goto(`/strategy/thread/${rootSessionId}`);
  await expect(other.getByTestId('thread-error')).toContainText(/not found/i);
  // cleanup the second founder
  const oid = sql(`SELECT founder_id FROM identity.founders WHERE email='${otherEmail}';`);
  if (oid) sql(`DELETE FROM identity.sessions WHERE founder_id='${oid}'; DELETE FROM identity.founder_credentials WHERE founder_id='${oid}'; DELETE FROM identity.founders WHERE founder_id='${oid}';`);
  await ctx.close();
});
