// The founder's REAL QuFi path through the LOCAL api (real routes, DB, models), replaying her own inputs from prod:
// website → Done → her 6 corrections (verbatim) → Let's start → her 3 answers (verbatim) → goal confirm → mirror →
// strategy adopt → week → email → export → container → Today. Local test founder only; prod is untouched.
// Usage: node qufi-flow.mjs <inputs.json> <out.json>
import { JwtService } from '/app/packages/infrastructure/dist/index.js';
import { readFileSync, writeFileSync } from 'node:fs';
const [inputsPath, out] = process.argv.slice(2);
const IN = JSON.parse(readFileSync(inputsPath, 'utf8'));
const FOUNDER = '01TESTQUFIFLOW00000000000A';
const token = new JwtService(process.env.JWT_PRIVATE_KEY ?? '', process.env.JWT_PUBLIC_KEY ?? '').sign({ sub: FOUNDER, role: 'founder', scopes: [] }).accessToken;
const call = async (method, path, body) => {
  const r = await fetch(`http://localhost:3000${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const opener = (c) => { try { const o = JSON.parse(c).__arcOpener; return o ? [o.lead, ...(o.bullets ?? []), o.notSure, o.invitation].filter(Boolean).join('\n') : c; } catch { return c; } };
const surfaces = {}; const say = (k, v) => { surfaces[k] = v; process.stdout.write(`\n== ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`.slice(0, 1400) + '\n'); };

const biz = await call('POST', '/v1/businesses', { name: 'QuFi Network' });
const B = biz.id;
const src = await call('POST', `/v1/businesses/${B}/arc/source`, { url: 'https://qufi.network' });
say('pour-in', `website: ${src.state}, ${src.pagesRead} pages`);
let v = await call('POST', `/v1/businesses/${B}/arc/pour-in/done`);
const u = v.understanding ?? {};
say('understanding', { does: u.does, serves: u.serves, standsOut: u.standsOut, constraint: u.constraint, stage: u.stage, tensions: (u.tensions ?? []).map((t) => `${t.tension} | ${t.grounding}`), unanswered: u.unanswered });

const replies = [];
for (const c of IN.corrections) {
  v = await call('POST', `/v1/businesses/${B}/arc/understanding/correct`, { message: c });
  const cr = v.correctionReflection ?? {};
  replies.push([cr.reflection, cr.changes, cr.holds].filter(Boolean).join(' / '));
}
say('correction replies', replies);

v = await call('POST', `/v1/businesses/${B}/arc/understanding/confirm`);
const conv = [];
if (v.turns?.length) conv.push(`BB: ${opener(v.turns.at(-1).content)}`);
for (const a of IN.answers) {
  if (v.moment !== 'conversation' || v.error?.kind === 'need_goal') break;
  conv.push(`FOUNDER: ${a}`);
  v = await call('POST', `/v1/businesses/${B}/arc/conversation`, { message: a });
  const last = v.turns?.at(-1);
  if (last?.role === 'bb') conv.push(`BB: ${opener(last.content)}`);
}
say('conversation', conv);

let goalOffered = null;
if (v.error?.kind === 'need_goal') {
  goalOffered = v.error.goalCandidate?.statement ?? null;
  // The founder confirms a clean candidate; otherwise she writes her own goal (as she did in prod).
  const statement = goalOffered && /\b(sign|pilot|days|months)\b/i.test(goalOffered) ? goalOffered : IN.editedGoal;
  v = await call('POST', `/v1/businesses/${B}/arc/goal`, { statement, fromStateId: goalOffered ? v.error.goalCandidate.stateId : null });
  say('goal', { offered: goalOffered ?? '(none offered: asked cold)', confirmed: statement });
} else say('goal', { offered: '(no goal step shown)', moment: v.moment, strategyAssumed: v.strategy?.assumedGoal ?? null });

if (v.moment === 'mirror') {
  say('mirror', v.mirror ?? '(no mismatch shown)');
  if (process.env.STOP_AT === 'mirror') { writeFileSync(out, JSON.stringify({ businessId: B, goalOffered, surfaces }, null, 2)); process.exit(0); }
  v = await call('POST', `/v1/businesses/${B}/arc/mirror/seen`, { answer: '' });
}
if (v.moment === 'strategy' && !v.strategy && !v.error) v = await call('GET', `/v1/businesses/${B}/arc`);
say('strategy', v.strategy ?? v.error);
v = await call('POST', `/v1/businesses/${B}/arc/strategy/adopt`, { versionId: v.strategy.proposalId });
if (v.moment === 'week_day' && !v.weekDay) v = await call('GET', `/v1/businesses/${B}/arc`);
say('week', v.weekDay?.story ?? v.weekDay ?? v.error);
v = await call('POST', `/v1/businesses/${B}/arc/week-day/adopt`);
const e = (await call('POST', `/v1/businesses/${B}/arc/email/generate`)).email;
say('email', e);
v = await call('POST', `/v1/businesses/${B}/arc/email/export`);
if (v.moment === 'container' && !v.container) v = await call('GET', `/v1/businesses/${B}/arc`);
say('container', v.container?.items ?? v.error);
v = await call('POST', `/v1/businesses/${B}/arc/container/seen`);
const home = await call('GET', `/v1/businesses/${B}/home`);
say('today (home)', { context: home.context, lines: home.lines });
const today = await call('GET', `/v1/businesses/${B}/plan/today`);
say('today (page)', (today.ready ?? []).map((r) => ({ what: r.what, whyNow: r.whyNow, doneLooksLike: r.doneLooksLike })));
writeFileSync(out, JSON.stringify({ businessId: B, goalOffered, surfaces }, null, 2));
