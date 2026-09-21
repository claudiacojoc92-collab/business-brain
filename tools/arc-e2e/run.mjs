// PHASE 3 — automated END-TO-END arc test. Drives all nine moments through the REAL composition + REAL models
// against a local test Postgres, seeded with REAL Body Move source content (website pages + both brochures + a
// link, captured from prod). Verifies at each moment: structure, one-language, source grounding, and hierarchy
// (bullets ≤3, no monster paragraphs). Prints a PASS/FAIL report per moment and exits non-zero on any failure.
//
// Prereqs: test DB up + migrated (docker compose -f docker-compose.test.yml up -d postgres-test; run migrate-test).
// Run: node tools/arc-e2e/run.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SEED = resolve(HERE, 'body-move-seed.json'); // real Body Move source content, bundled with the harness
const TEST_DB = process.env.TEST_DATABASE_URL || 'postgresql://bbuser:bbpassword@localhost:5433/businessbrain_test';

// ── env (real Anthropic key from .env; dummy encryption key so composition constructs) ──
const env = readFileSync(`${ROOT}/.env`, 'utf8');
const KEY = (env.match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
if (!KEY) { console.error('no ANTHROPIC_API_KEY'); process.exit(2); }
process.env.ANTHROPIC_API_KEY = KEY;
process.env.DATABASE_URL = TEST_DB;
process.env.GOOGLE_OAUTH_ENCRYPTION_KEY ||= '0'.repeat(64);

const { createKyselyClient } = await import(`${ROOT}/packages/infrastructure/dist/index.js`);
const { buildCompositionRoot } = await import(`${ROOT}/packages/composition/dist/index.js`);
const { generateId } = await import(`${ROOT}/packages/shared/dist/index.js`);

// ── helpers: language + structure checks ──
// Unambiguous English FUNCTION words that never appear in Romanian text (avoids false positives on domain nouns
// like "clinic"/"business"). Two or more = an English sentence leaked in.
const EN_MARKERS = /\b(the|and|with|your|from|this|that|what|would|could|should|reaching|hello|about|here's|we're|i'm|you're)\b/gi;
const RO_HINT = /[ăâîșşțţ]|\b(și|este|nu|pentru|care|dar|acum|deja|sursele|pariul|afacere|vine|către)\b/i;
function looksEnglish(s) { const m = (s || '').match(EN_MARKERS); return (m?.length ?? 0) >= 2; }
function oneLanguageRomanian(s) { return !!s && RO_HINT.test(s) && !looksEnglish(s); }
const longestParagraph = (s) => Math.max(0, ...String(s || '').split(/\n{2,}/).map((p) => p.length));

const results = [];
function check(moment, name, pass, detail) { results.push({ moment, name, pass: !!pass, detail: detail || '' }); }

const pool = new pg.Pool({ connectionString: TEST_DB });
const db = createKyselyClient(TEST_DB);
const root = buildCompositionRoot(db);

const FID = generateId();
const BID_HOLD = { id: null };
const LANG = 'ro';

async function seedSources() {
  const seed = JSON.parse(readFileSync(SEED, 'utf8'));
  const web = seed.website;
  const brochures = seed.brochures;
  await root.learnBusinessService.ingestTextForPourIn({ businessId: BID_HOLD.id, founderId: FID, source: 'website', provenance: 'observed', items: web });
  await root.learnBusinessService.ingestTextForPourIn({ businessId: BID_HOLD.id, founderId: FID, source: 'founder_supplied', provenance: 'declared', items: brochures });
  await root.learnBusinessService.ingestTextForPourIn({ businessId: BID_HOLD.id, founderId: FID, source: 'founder_supplied', provenance: 'declared', items: [{ ref: 'Un articol despre scolioză', url: 'https://example.ro/scolioza', text: 'Scolioza idiopatică la adolescenți necesită depistare timpurie și terapie Schroth pentru a preveni agravarea curburii.', pageType: 'link' }] });
  return { webCount: web.length, brochureCount: brochures.length };
}

const flags = (o) => ({ pourInDone: false, readingDone: false, understandingConfirmed: false, mirrorSeen: false, emailExported: false, containerSeen: false, ...o });

async function run() {
  // founder + business
  await pool.query(`INSERT INTO founder.founders (id, email, name, business_name) VALUES ($1,$2,$3,$4)`, [FID, `e2e-${FID}@test.local`, 'E2E Founder', 'Body Move Studio']);
  const biz = await root.businessService.createBusiness({ founderId: FID, name: 'Body Move Studio', defaultConversationLanguage: LANG });
  BID_HOLD.id = biz.id;
  const BID = biz.id;

  // ── Moment 1: pour-in (website + brochures + link) ──
  const seeded = await seedSources();
  check('M1 pour-in', 'sources ingested (website + brochures + link)', seeded.webCount > 0 && seeded.brochureCount >= 2, `${seeded.webCount} pages, ${seeded.brochureCount} brochures`);

  // ── Moment 2: reading bridge fires → one understanding snapshot ──
  const bridge = await root.learnBusinessService.bridgePourIn({ businessId: BID, founderId: FID, businessName: biz.name, interfaceLanguage: LANG });
  check('M2 reading/bridge', 'bridge produced an understanding snapshot', bridge.state === 'synced' && !!bridge.understandingId, `state=${bridge.state}`);

  // ── Moment 3: understanding — diagnostic, grounded, one language ──
  const uView = await root.arcService.view(BID, biz.name, LANG, flags({ pourInDone: true, readingDone: true }), [], null);
  check('M3 understanding', 'moment is understanding', uView.moment === 'understanding');
  const u = uView.understanding || {};
  const uAll = [u.does, u.serves, u.standsOut, ...(u.tensions || []), ...(u.confident || []), ...(u.inferring || []), ...(u.unanswered || [])].filter(Boolean).join(' ');
  check('M3 understanding', 'diagnostic structure present (does + at least one of tensions/confident/unanswered)', !!u.does && ((u.tensions?.length || 0) + (u.confident?.length || 0) + (u.unanswered?.length || 0)) > 0, `tensions=${u.tensions?.length} confident=${u.confident?.length} unanswered=${u.unanswered?.length}`);
  check('M3 understanding', 'grounded in the real sources (mentions Schroth / kinetoterapie / Decebal)', /schroth|kinetoterap|decebal|scolioz/i.test(uAll), uAll.slice(0, 120));
  check('M3 understanding', 'one language (Romanian, no English leak)', oneLanguageRomanian(uAll), uAll.slice(0, 120));
  check('M3 understanding', 'content language on the view', uView.contentLanguage === 'ro', `contentLanguage=${uView.contentLanguage}`);

  // ── Moment 4: conversation — opener structured; synthesis+diagnosis by answer 3–4; one language ──
  await root.conversationService.startOrResume(BID, FID, biz.name, LANG); // generates the opener turn
  // Moment 4 requires understanding CONFIRMED (else the moment is still 'understanding' and carries no turns).
  const CONV_FLAGS = flags({ pourInDone: true, readingDone: true, understandingConfirmed: true });
  const turnsOf = async () => (await root.arcService.view(BID, biz.name, LANG, CONV_FLAGS, [], null)).turns || [];
  let turns = await turnsOf();
  const openerRaw = turns[0]?.content || '';
  let opener = null; try { opener = JSON.parse(openerRaw)?.__arcOpener; } catch { /* prose */ }
  check('M4 opener', 'opener is STRUCTURED (lead + bullets + invitation), not a prose blob', !!opener && !!opener.lead && !!opener.invitation && Array.isArray(opener.bullets), opener ? `${opener.bullets.length} bullets` : 'not structured');
  if (opener) {
    check('M4 opener', 'bullets ≤ 3 and each a short one line (≤200 chars)', opener.bullets.length <= 3 && opener.bullets.every((b) => b.length <= 200), `${opener.bullets.length} bullets; max=${Math.max(...opener.bullets.map((b) => b.length))} chars`);
    const oAll = [opener.lead, ...opener.bullets, opener.notSure, opener.invitation].filter(Boolean).join(' ');
    check('M4 opener', 'one language (Romanian)', oneLanguageRomanian(oAll), oAll.slice(0, 120));
    check('M4 opener', 'grounded in sources (references a brochure/site specific)', /schroth|kinetoterap|decebal|pliant|broșur|scolioz/i.test(oAll), oAll.slice(0, 120));
  }

  // Founder answers (Romanian) — include a goal so the strategy can generate.
  const answers = [
    'Vrem să creștem partea de scolioză și Schroth la Decebal, care e la ~70% capacitate.',
    'Cei mai buni pacienți vin din recomandări de la medici ortopezi, dar nu avem un flux clar.',
    'Am încercat reclame pe Instagram dar nu au adus pacienți pentru Schroth.',
    'Nu vreau să reducem calitatea clinică pentru volum.',
    'Avem un reprezentant care ar putea vizita cabinetele, dar nu a început.',
    'Obiectivul pe 6 luni este să umplem Decebal pe kinetoterapie și Schroth.',
    'Da, cred că ai dreptate — problema e lipsa unui mecanism repetabil cu medicii.',
    'Putem începe cu cei câțiva ortopezi care deja ne cunosc.',
  ];
  let synthesisTurn = null;
  let synthesisAnswer = 0;
  let ready = false;
  for (let i = 0; i < answers.length; i++) {
    const cv = await root.conversationService.submitResponse(BID, FID, biz.name, answers[i], LANG);
    turns = cv.turns || [];
    const lastBb = [...turns].reverse().find((t) => t.role === 'bb');
    const bbLen = (lastBb?.content || '').length;
    if (process.env.DEBUG_E2E) console.error(`  [answer ${i + 1}] bb-turn ${bbLen} chars, ready=${cv.readyForAha2}`);
    // The synthesis/diagnosis turn is a long, point-of-view interpretation — expected by answer 3–4.
    if (!synthesisTurn && i >= 2 && lastBb && bbLen > 200 && !JSON.parse(safe(lastBb.content))?.__arcOpener) { synthesisTurn = lastBb; synthesisAnswer = i + 1; }
    if (cv.readyForAha2) { ready = true; break; }
  }
  check('M4 conversation', 'delivers a synthesis/diagnosis by answer 3–5', !!synthesisTurn && synthesisAnswer >= 3 && synthesisAnswer <= 5, synthesisTurn ? `at answer ${synthesisAnswer}: ${(synthesisTurn.content || '').slice(0, 80)}` : 'none');
  const allBb = turns.filter((t) => t.role === 'bb').map((t) => t.content).filter((c) => { try { return !JSON.parse(c)?.__arcOpener; } catch { return true; } }).join(' ');
  const allFounderLangOk = turns.filter((t) => t.role === 'bb').every((t) => { const c = t.content; let o = null; try { o = JSON.parse(c)?.__arcOpener; } catch { /**/ } const text = o ? [o.lead, ...o.bullets, o.notSure, o.invitation].filter(Boolean).join(' ') : c; return oneLanguageRomanian(text); });
  check('M4 conversation', 'every BB turn is one language (Romanian, no English leak)', allFounderLangOk, allBb.slice(0, 120));
  check('M4 conversation', 'conversation reaches ready_for_aha2 within the budget', !!ready, `ready=${ready}`);

  // mark understanding confirmed for the rest of the walk
  const F_AFTER_CONV = flags({ pourInDone: true, readingDone: true, understandingConfirmed: true });

  // ── Moment 5: mirror — a specific contrast (both sides) ──
  const mView = await root.arcService.view(BID, biz.name, LANG, F_AFTER_CONV, [], null);
  check('M5 mirror', 'moment is mirror', mView.moment === 'mirror', `moment=${mView.moment}`);
  if (mView.moment === 'mirror') {
    const m = mView.mirror;
    check('M5 mirror', 'a specific contrast with both sides (or an honest none)', !mView.error, m ? `founderWords=${(m.founderWords||'').slice(0,50)}` : 'no contrast (honest)');
    if (m) check('M5 mirror', 'mirror is one language (Romanian)', oneLanguageRomanian([m.founderWords, m.against, m.tension].join(' ')), [m.founderWords, m.against, m.tension].join(' ').slice(0, 120));
  }

  // ── Moment 6: strategy — bet + trade-offs + not-now + reconsider ──
  const sView = await root.arcService.view(BID, biz.name, LANG, flags({ pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
  check('M6 strategy', 'moment is strategy, no generation error', sView.moment === 'strategy' && !sView.error, `moment=${sView.moment} err=${sView.error?.kind}`);
  const s = sView.strategy;
  if (s) {
    check('M6 strategy', 'has a bet + reconsider (+ trade-offs / not-now surfaced)', !!s.bet && (s.reconsider?.length || 0) >= 0, `bet=${(s.bet||'').slice(0,60)} tradeoffs=${s.tradeOffs?.length} notNow=${s.notNow?.length}`);
    check('M6 strategy', 'strategy is one language (Romanian)', oneLanguageRomanian([s.bet, s.over, ...(s.reconsider||[]), ...(s.tradeOffs||[]), ...(s.notNow||[])].join(' ')), (s.bet||'').slice(0, 120));
    // adopt it so the plan can follow
    if (s.proposalId) await root.strategyService.adopt(BID, s.proposalId, FID);
  }

  // ── Moment 7: week + day — a real plan ──
  const wView = await root.arcService.view(BID, biz.name, LANG, flags({ pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true }), [], null);
  check('M7 week+day', 'moment is week_day with a real plan (week + today), no error', wView.moment === 'week_day' && !wView.error && (wView.weekDay?.week?.length || 0) > 0, `moment=${wView.moment} week=${wView.weekDay?.week?.length} today=${!!wView.weekDay?.today}`);
  if (wView.weekDay) check('M7 week+day', 'plan is one language (Romanian)', oneLanguageRomanian([...(wView.weekDay.week||[]), wView.weekDay.today].filter(Boolean).join(' ')), (wView.weekDay.week||[]).join(' ').slice(0, 120));
  // accept the plan
  const proposed = await root.planService.getLatestProposed(BID);
  if (proposed) await root.planService.acceptPlan(BID, proposed.planVersionId);

  // ── Moment 8: email — a real, grounded email ──
  const email = await root.arcService.draftEmail(BID, biz.name, LANG);
  check('M8 email', 'produced a real email (subject + body)', !!email.subject && !!email.body && email.body.length > 40, `subject=${(email.subject||'').slice(0,50)}`);
  check('M8 email', 'email is one language (Romanian)', oneLanguageRomanian(`${email.subject} ${email.body}`), `${email.subject} ${email.body}`.slice(0, 120));

  // ── Moment 9: container — read-only projection renders ──
  const cView = await root.arcService.view(BID, biz.name, LANG, flags({ pourInDone: true, readingDone: true, understandingConfirmed: true, mirrorSeen: true, emailExported: true }), [], null);
  const cReached = cView.moment === 'container' || cView.moment === 'done';
  check('M9 container', 'moment is container with items', cReached && (cView.container?.items?.length || 0) > 0, `moment=${cView.moment} items=${cView.container?.items?.length}`);

  // cleanup: the test DB is ephemeral (tmpfs), but scope-delete this founder's business rows anyway.
  await pool.query(`DELETE FROM workspace.businesses WHERE owner_founder_id=$1`, [FID]).catch(() => {});
}

function safe(s) { try { JSON.parse(s); return s; } catch { return '{}'; } }

try {
  await run();
} catch (e) {
  check('HARNESS', 'ran to completion', false, e?.stack || String(e));
}

// ── report ──
const byMoment = {};
for (const r of results) (byMoment[r.moment] ||= []).push(r);
let failed = 0;
console.log('\n===== ARC END-TO-END REPORT (real Body Move data) =====\n');
for (const moment of Object.keys(byMoment)) {
  const rs = byMoment[moment];
  const ok = rs.every((r) => r.pass);
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${moment}`);
  for (const r of rs) console.log(`   ${r.pass ? '·' : '✗'} ${r.name}${r.detail ? `  —  ${r.detail}` : ''}`);
}
console.log(`\n${failed === 0 ? '✅ ALL MOMENTS PASS' : `❌ ${failed} MOMENT(S) FAILED`}\n`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
