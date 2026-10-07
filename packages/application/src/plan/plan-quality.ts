/**
 * Plan Quality Contract (Slice 5) — deterministic gate. A Proposed plan may only be shown if this returns
 * { valid:true }. Enforces strategy-derivation, business-specificity (transplant), prioritization (1–4, no
 * padding), executable/legible actions, real prerequisites, time-bounding without fake precision,
 * provenance-governed numbers/dates (authorized, not lexically banned), no manufactured urgency / no
 * unsupported outcome promise, and no fabricated Not-now. It does NOT read or write Current Strategy.
 */
import type { PlanVersion, PlanStrategyView, AuthorizedNumber, LicensedNumericFact, PlanDraft, HeldFactsSummary } from './contracts';
import { ATOM_CLASSES, type AtomClass } from '../atoms/contracts';

export interface PlanValidation { readonly valid: boolean; readonly failures: readonly string[] }

const STOP = new Set(['the', 'and', 'your', 'with', 'this', 'that', 'for', 'from', 'about', 'into', 'their', 'they', 'them', 'will', 'have', 'what', 'when', 'where', 'which', 'more', 'over', 'next', 'make', 'made', 'plan', 'work', 'week', 'weeks', 'month', 'days', 'call', 'short', 'intro', 'audience', 'business', 'founder', 'strategy', 'content', 'offer']);
const words = (s: string): string[] => (s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w));
const tokenSet = (parts: string[]): Set<string> => new Set(parts.flatMap(words));

// The "week" concept in the plan's OWN language — EN week(s), RO săptămână/săptămâni (with or without
// diacritics), IT settimana/settimane. A time band is authored in the plan's language (the LANGUAGE rule), so
// demanding the literal English "week" would force English into one field and burn repair attempts. No /g on
// WEEK_WORD so .test() is stateless.
const WEEK_WORD = /(weeks?|s[ăa]pt[ăa]m[âaăî]ni?|settimane?)/i;
const WEEK_BAND = /\b(?:weeks?|s[ăa]pt[ăa]m[âaăî]ni?|settimane?)\s+\d(?:\s*[-–—]\s*\d)?\b/gi;
// No trailing \b: "30%-burn" must still detect "30%" (a hyphen after % is not a word boundary).
const NUMERIC = /\b\d[\d.,]*\s?%?/g;
const DATE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/gi;

// Canonicalize percent forms so hyphenation/spacing cannot change the safety verdict:
//   "30 %" / "30%-burn" / "30-percent" / "30 percent" → "30%".
const canonPercent = (s: string): string => s
  .replace(/(\d)\s*-?\s*per\s?cent(?:age)?\b/gi, '$1%')  // 30 percent / 30-percent / 30 per cent → 30%
  .replace(/(\d)\s*%/g, '$1%');                           // 30 % → 30%

// MANUFACTURED urgency = rhetorical scarcity/pressure NOT grounded in the business. Grounded temporal context
// (tax season, launch window, enrollment period, a real event/renewal date) is NOT manufactured and passes.
const MANUFACTURED_URGENCY = /\b(?:act (?:now|fast)|now or never|don'?t (?:miss|wait)|last chance|hurry|limited time|before it'?s too late|while supplies last|spots? (?:are )?filling|once[- ]in[- ]a[- ]lifetime|urgent(?:ly)?|don'?t let this slip)\b/i;
const OUTCOME_PROMISE = /\b(?:guarantee[ds]?|guaranteed|will (?:double|triple|grow|get you|land you|win you|convert)|proven to|surefire|10x|guaranteed results)\b/i;

// number-words → digits so "two posts" and "2 posts" classify identically (spelling can never change safety).
const WORD_NUM: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', once: '1', twice: '2' };
const digitize = (s: string): string => s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|once|twice)\b/gi, (m) => WORD_NUM[m.toLowerCase()] ?? m);

// Correction #2/#3 — numbers are governed by SEMANTIC ROLE, not by the presence of a digit.
//  • structural  = execution counts/cadence (2 emails, 1 post per week, 3 actions, week bands) → ALLOWED.
//  • outcome     = business results/targets (20 leads, 7%, 3 clients, €10k, 1,000 users)       → need scoped auth.
//  • deadline    = calendar dates / "by <when>" business deadlines (launch by September 15)     → need scoped auth.
const OUTCOME_NOUNS = new Set(['lead', 'leads', 'client', 'clients', 'customer', 'customers', 'user', 'users', 'subscriber', 'subscribers', 'signup', 'signups', 'sale', 'sales', 'conversion', 'conversions', 'deal', 'deals', 'retainer', 'retainers', 'follower', 'followers', 'revenue', 'mrr', 'arr', 'dau', 'mau', 'download', 'downloads', 'install', 'installs', 'member', 'members', 'booking', 'bookings']);
const MONEY = /[$€£]\s?\d|\b\d[\d.,]*\s?k?\s?(?:revenue|profit|mrr|arr|dollars|euros|pounds)\b/i;
const numCore = (t: string): string => (t.toLowerCase().match(/\d[\d.,]*/)?.[0] ?? '').replace(/[.,]+$/, '');

type Role = 'structural' | 'outcome' | 'deadline';
function roleOf(raw: string, before: string, after: string): Role {
  if (/%/.test(raw)) return 'outcome';
  if (MONEY.test(`${before}${raw}${after}`)) return 'outcome';
  // scan the number's UNIT phrase (next few words) for a business-outcome noun ("20 newsletter subscribers").
  const nextWords = (after.toLowerCase().match(/[a-z][a-z-]*/g) ?? []).slice(0, 3);
  if (nextWords.some((w) => OUTCOME_NOUNS.has(w))) return 'outcome';
  if (/\b(?:by|within|no later than|deadline)\s*$/i.test(before) && /\b(days?|weeks?|months?)\b/i.test(after)) return 'deadline';
  return 'structural';
}
const kindCompatible = (role: Role, authKind: AuthorizedNumber['kind']): boolean =>
  role === 'deadline' ? (authKind === 'date' || authKind === 'deadline')
    : (authKind === 'count' || authKind === 'currency' || authKind === 'duration' || authKind === 'percentage' || authKind === 'other');

// A licensed proof number is authorized only for DOCUMENTARY use. Forward-looking / reader-outcome framing
// near the number (target/reach/improve YOUR…/increase…/we'll/you'll/guarantee) breaks documentary use, so
// the licensed fact no longer authorizes it — same number, different meaning.
const FORWARD_TARGET = /\b(?:target|goal|aim|reach|hit|achieve|improve|increase|boost|grow|drive|generate|deliver|promis\w*|guarantee\w*|we'?ll|you'?ll|your|more\b)/i;

/**
 * Numeric governance. Structural/execution counts are allowed without provenance. OUTCOME numbers and
 * DEADLINES are authorized only by (a) a scoped AuthorizedNumber (same core + kind + scope overlap) OR
 * (b) a LicensedNumericFact used FAITHFULLY & DOCUMENTARILY (same core + meaning/scope overlap + no
 * forward-target framing). Returns `<token>#invented | #misscoped | #licensed_scope_mismatch`.
 */
function numericViolations(text: string, authorized: AuthorizedNumber[], facts: LicensedNumericFact[]): string[] {
  const stripped = canonPercent(digitize(text)).replace(WEEK_BAND, ' ');
  const out: string[] = [];
  type Occ = { raw: string; index: number; role: Role };
  const occs: Occ[] = [];
  const spans: Array<[number, number]> = [];
  // calendar dates first (deadlines), claim their span so their digits aren't re-scanned as bare numbers.
  const dateRx = new RegExp(DATE.source, 'gi');
  for (let m = dateRx.exec(stripped); m; m = dateRx.exec(stripped)) { occs.push({ raw: m[0].trim(), index: m.index, role: 'deadline' }); spans.push([m.index, m.index + m[0].length]); }
  const numRx = new RegExp(NUMERIC.source, 'g');
  for (let m = numRx.exec(stripped); m; m = numRx.exec(stripped)) {
    const raw = m[0].trim(); if (!raw || !/\d/.test(raw)) continue;
    if (spans.some(([s, e]) => m!.index >= s && m!.index < e)) continue;
    const before = stripped.slice(Math.max(0, m.index - 24), m.index);
    const after = stripped.slice(m.index + m[0].length, m.index + m[0].length + 24);
    occs.push({ raw, index: m.index, role: roleOf(raw, before, after) });
  }
  for (const occ of occs) {
    if (occ.role === 'structural') continue; // execution cadence/counts need no business-target provenance
    const start = Math.max(0, occ.index - 30), end = Math.min(stripped.length, occ.index + occ.raw.length + 30);
    const windowText = stripped.slice(start, end);
    const window = tokenSet([windowText]);
    const core = numCore(occ.raw);
    // (a) authorized target/date in its scope?
    const authCands = authorized.filter((a) => numCore(a.value) === core || a.value.toLowerCase().includes(core));
    if (authCands.some((a) => kindCompatible(occ.role, a.kind) && [...tokenSet([a.value, a.appliesTo])].some((w) => window.has(w)))) continue;
    // (b) documented proof number, used documentarily in its scope?
    const factCands = facts.filter((fct) => numCore(fct.value) === core);
    if (factCands.length) {
      const forward = FORWARD_TARGET.test(windowText);
      const documentary = factCands.some((fct) => [...tokenSet([fct.meaning, fct.semanticScope])].some((w) => window.has(w)));
      if (documentary && !forward) continue;                 // faithful documentary citation → allowed
      out.push(`${occ.raw}#licensed_scope_mismatch`); continue; // right number, wrong scope/framing
    }
    out.push(authCands.length ? `${occ.raw}#misscoped` : `${occ.raw}#invented`);
  }
  return [...new Set(out)];
}

// Founder-legibility: internal draft identifiers (action keys like "a1") may live in structured fields
// (prerequisiteKeys) but MUST NOT appear in founder-facing prose. Match each key as a standalone token, so a
// real key "a1" is caught in "same loop as a1" while "B2B"/"24/7" are never false-matched.
export function detectActionKeyLeaks(plan: PlanVersion, internalKeys: readonly string[]): string[] {
  const keys = [...new Set(internalKeys.map((k) => k.trim()).filter(Boolean))];
  if (!keys.length) return [];
  const prose: string[] = [plan.monthDirection];
  for (const p of plan.priorities) {
    prose.push(p.title, p.why, p.observableSignal?.description ?? '');
    for (const a of p.actions) prose.push(a.what, a.why, a.doneDefinition);
  }
  for (const n of plan.notNow) prose.push(n.item, n.reason);
  const blob = prose.join('  ');
  const leaks: string[] = [];
  for (const k of keys) {
    const rx = new RegExp(`(?<![\\w-])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i');
    if (rx.test(blob)) leaks.push(`internal_action_key_leak:${k}`);
  }
  return leaks;
}

export function validatePlan(plan: PlanVersion, strategy: PlanStrategyView): PlanValidation {
  const f: string[] = [];
  const authorized = strategy.authorizedNumbers;
  const facts = strategy.licensedNumericFacts ?? [];

  if (plan.strategyVersionId !== strategy.strategyVersionId) f.push('strategy_version_mismatch');
  // 1–4 priorities, no padding (upper bound enforced; lower bound = at least one).
  if (plan.priorities.length < 1 || plan.priorities.length > 4) f.push('priority_count_out_of_range');
  // exactly one current focus, present.
  if (!plan.priorities.some((p) => p.priorityId === plan.currentFocusPriorityId)) f.push('missing_or_invalid_current_focus');
  if (new Set(plan.priorities.map((p) => p.order)).size !== plan.priorities.length) f.push('non_distinct_priority_order');

  const strategyTokens = tokenSet([strategy.coreBet, strategy.goal, strategy.audience, ...strategy.decisions]);
  const allActionIds = new Set(plan.priorities.flatMap((p) => p.actions.map((a) => a.actionId)));
  let sharesStrategyToken = false;

  // COMPLETE-FLOW GATE (never half a channel). An action that GENERATES DEMAND — makes someone arrive or
  // invites inbound contact (model-set generatesDemand, NOT intent) — must be SEQUENCED after the landing that
  // receives what it brings in. "Landing" = an action inside a conversion_path / retention / sales_support
  // priority (the receiving side of the flow). The gate fires ONLY on demand-generating actions, never on
  // internal prep (writing, list-building, or building/testing the landing itself), because those are
  // generatesDemand=false. A demand action with no prerequisite on a landing action fails → repair.
  const LANDING_INTENTS = new Set(['conversion_path', 'retention', 'sales_support']);
  const landingActionIds = new Set(
    plan.priorities.filter((p) => LANDING_INTENTS.has(p.intent)).flatMap((p) => p.actions.map((a) => a.actionId)),
  );

  for (const p of plan.priorities) {
    if (!p.betRef.trim() || !p.goalRef.trim()) f.push('priority_missing_trace');
    if (!WEEK_WORD.test(p.timeBand)) f.push('priority_timeband_not_week_band');
    for (const u of numericViolations(`${p.title} ${p.why} ${p.observableSignal?.description ?? ''}`, authorized, facts)) f.push(`numeric_target:${u}`);
    if (p.observableSignal && /\d/.test(p.observableSignal.description) && !p.observableSignal.source) f.push('unsourced_signal_number');
    if (words(`${p.title} ${p.why}`).some((w) => strategyTokens.has(w))) sharesStrategyToken = true;
    if (p.actions.length < 1) f.push('priority_without_action');
    for (const a of p.actions) {
      if (!a.what.trim() || !a.why.trim() || !a.doneDefinition.trim()) f.push('action_incomplete');
      if (a.priorityId !== p.priorityId) f.push('orphan_action');
      for (const pre of a.prerequisites) { if (!allActionIds.has(pre)) f.push('dangling_prerequisite'); if (pre === a.actionId) f.push('self_prerequisite'); }
      // complete-flow: a demand-generating action must depend on a landing action that handles what it brings in.
      if (a.generatesDemand && !a.prerequisites.some((pre) => landingActionIds.has(pre))) {
        f.push(`demand_without_landing: the action "${a.what.slice(0, 70)}" invites people in but is not sequenced after the landing that receives them — add to its prerequisiteKeys the action(s) that handle the arrival (who receives them, the path they walk), living in a conversion_path/retention/sales_support priority; if no such action exists, add it`);
      }
      const blob = `${a.what} ${a.why} ${a.doneDefinition}`;
      for (const u of numericViolations(blob, authorized, facts)) f.push(`numeric_target:${u}`);
      if (MANUFACTURED_URGENCY.test(blob)) f.push('manufactured_urgency'); // grounded seasonality/dates pass
      if (OUTCOME_PROMISE.test(blob)) f.push('unsupported_outcome_promise');
      if (words(blob).some((w) => strategyTokens.has(w))) sharesStrategyToken = true;
    }
  }
  // Business-specificity (correction #1): deterministic token overlap is a CHEAP BACKSTOP ONLY. Zero overlap
  // ⇒ certainly generic ⇒ fail. Overlap does NOT prove non-generic (nouns can be decorative) — genuine
  // genericity is judged by the semantic CAUSAL-DERIVATION review (IPlanModelPort.reviewGenericity).
  if (!sharesStrategyToken) f.push('generic_plan_transplantable');
  // Not-now may be empty, but each populated item must carry a real, typed reason (never fabricated).
  for (const n of plan.notNow) if (!n.item.trim() || !n.reason.trim() || !n.reasonKind) f.push('notnow_item_without_reason');

  return { valid: f.length === 0, failures: [...new Set(f)] };
}

/** Transplant probe (used by the falsification suite): strip the business name + proper nouns and ask
 * whether the plan still references strategy-specific concepts. Returns true when it would survive
 * transplant to a different business (i.e. it is too generic). */
export function isTransplantable(plan: PlanVersion, strategy: PlanStrategyView, businessName: string): boolean {
  const strip = (s: string): string => s.replace(new RegExp(businessName, 'gi'), ' ').replace(/\b[A-Z][a-z]+\b/g, ' ');
  const stripped = plan.priorities.flatMap((p) => [strip(p.title), strip(p.why), ...p.actions.map((a) => strip(`${a.what} ${a.why}`))]).join(' ');
  const strategyTokens = tokenSet([strategy.coreBet, strategy.goal, strategy.audience, ...strategy.decisions]);
  return !words(stripped).some((w) => strategyTokens.has(w)); // no strategy-specific token survives ⇒ transplantable ⇒ generic
}

/**
 * CAPABILITY TAGS GATE (C3, BUS-9) — runs on the raw DRAFT, before compose, so a missing tag cannot hide behind a
 * default. Deterministic verdict over model-supplied tags (the claim-safety pattern: the gate decides, the model
 * supplies the signal). Every failure goes back through the existing repair loop.
 *   - missing_gathers_tag: gathersFactClass is REQUIRED on every action. An omitted optional field fails
 *     silently and ships looking clean; a missing required one fails here.
 *   - assigns_held_info:<class>: founder work (executableFormat null) that asks the founder to gather a fact class
 *     BB already holds. BB-performed moves may USE held facts; that is the point of holding them.
 *   - create_without_format: leadsToCreate with no executableFormat promises creation with no surface behind it
 *     (a dead "Make it" / "See what BB wrote"). FAILS CLOSED: rejected, never defaulted to a format.
 *   - format_without_create: BB writes it but the founder gets no way to open it.
 */
export function validateCapabilityTags(draft: PlanDraft, heldClasses: ReadonlySet<AtomClass>): string[] {
  const f: string[] = [];
  for (const p of draft.priorities) {
    for (const a of p.actions) {
      const what = `"${a.what.slice(0, 70)}"`;
      const tag = a.gathersFactClass;
      if (tag === undefined || !GATHER_TAGS.has(tag)) {
        f.push(`missing_gathers_tag: the action ${what} has no gathersFactClass — set it to the fact class it asks the founder to gather (service, location, contact_booking, people, policy) or "none"`);
      } else if (tag !== 'none' && a.executableFormat == null && heldClasses.has(tag)) {
        f.push(`assigns_held_info:${tag}: the action ${what} asks the founder to gather ${tag} facts, which BB already holds — replace it with the step that USES them`);
      }
      if (a.leadsToCreate && a.executableFormat == null) {
        f.push(`create_without_format: the action ${what} has leadsToCreate=true but no executableFormat — set the format BB writes (landing or carousel), or make it founder work with leadsToCreate=false`);
      }
      if (!a.leadsToCreate && a.executableFormat != null) {
        f.push(`format_without_create: the action ${what} has executableFormat=${a.executableFormat} but leadsToCreate=false — BB-written actions must have leadsToCreate=true`);
      }
    }
  }
  return f;
}
const GATHER_TAGS = new Set<string>([...ATOM_CLASSES, 'none']);

/** What BB HOLDS, for the planner + capability gate (C4): licensed atoms grouped by class, with counts and up to
 *  three examples each. A summary, never the raw facts. Classes with no atoms are omitted. */
export function heldFactsFromAtoms(atoms: readonly { readonly atomClass: AtomClass; readonly value: string }[], facets: readonly string[] = []): HeldFactsSummary {
  const classes = ATOM_CLASSES.map((atomClass) => {
    const values = atoms.filter((a) => a.atomClass === atomClass).map((a) => a.value.replace(/\s+/g, ' ').trim());
    return { atomClass, count: values.length, examples: values.slice(0, 3) };
  }).filter((c) => c.count > 0);
  return { classes, facets: [...facets] };
}
