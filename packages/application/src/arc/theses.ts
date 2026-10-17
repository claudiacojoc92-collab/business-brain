import { claimTermsIn, escalationsIn, primacyUnlicensed, presupposesFuture, sameInsight, ungroundedInference, type GovernedUnderstanding, type ModelDimension } from '../bi/index';
import { behaviourFinding } from '../strategy/validation';

/**
 * STRATEGIC THESES (2026-10-16). Understanding is a strategic model of how the business works, not a summary.
 *
 *   governed understanding (facts, model, synthesis, hypotheses)
 *   → ONE model call: a generic business-model sketch + 4–8 candidate theses + founder-facing copy
 *   → ELIGIBILITY (code): grounding is a gate, never a score
 *   → RANKING (code): decision leverage > consequence > non-obviousness > cross-dimension > reversibility > model
 *     priority > grounding (tie-breaker); an observation-only thesis can never be top-ranked. Grounding is eligibility,
 *     strategic value is ranking: literal overlap with offer names never ranks a thesis
 *   → QUESTIONS (code): the current driver if unknown, then the top theses' discriminating questions
 *   → founder copy re-checked sentence by sentence.
 *
 * Generic for any founder-led business: no industry vocabulary here or in the prompt. The stored understanding is never
 * changed; the result is cached per snapshot (founder_event) and carried into the conversation, the mirror and strategy.
 */

export type DecisionArea = 'acquisition' | 'conversion' | 'retention' | 'expansion' | 'positioning' | 'offer_design'
  | 'channel' | 'operating_model' | 'resource_allocation' | 'customer_journey' | 'pricing';
export const DECISION_AREAS: readonly DecisionArea[] = ['acquisition', 'conversion', 'retention', 'expansion', 'positioning', 'offer_design', 'channel', 'operating_model', 'resource_allocation', 'customer_journey', 'pricing'];
/** Decision areas where knowing a thesis is true most often changes what the founder does first. */
const HIGH_LEVERAGE = new Set<DecisionArea>(['acquisition', 'conversion', 'retention', 'expansion', 'resource_allocation', 'customer_journey']);

export type ThesisStatus = 'open' | 'strengthened' | 'weakened' | 'reversed' | 'sharpened' | 'unresolved';

export interface StrategicThesis {
  readonly id: string;                 // T1..Tn, stable within the record
  readonly headline: string;           // internal label (≤ 12 words)
  readonly facts: string[];            // F-refs it connects (eligibility: ≥ 2 distinct, valid)
  readonly relationship: string;       // what connects them (interpretation)
  readonly implication: string;        // why it may matter
  readonly decisions: DecisionArea[];  // founder decisions that change if it is true
  readonly ifTrue: string;             // the DECISION AT STAKE if it is true (never the solution)
  readonly weakenedBy: string;         // the answer or outcome that would weaken or reverse it
  readonly unknown: string;            // what BB must learn before relying on it
  readonly question: string;           // discriminating, founder-answerable, non-leading
  readonly questionWhy: string;        // what decision gets clearer with the answer
  readonly dimensions: ModelDimension[];
  readonly priority: number;           // the model's own ordinal (1 = most valuable): a late tie-breaker only
  readonly founder: { readonly headline: string; readonly body: string; readonly refs: string[] };
  readonly eligibility: { readonly pass: boolean; readonly reasons: string[]; readonly observationOnly: boolean };
  readonly score?: readonly number[];  // lexicographic: leverage, consequence, nonObvious, crossDim, reversibility, −priority, grounding
  readonly rank?: number;
}

export interface BusinessModelSketch {
  readonly motions: { readonly name: string; readonly entry: string[]; readonly buying: string[]; readonly continuation: string[]; readonly refs: string[] }[];
  readonly offerRoles: { readonly offer: string; readonly role: string; readonly refs: string[] }[];
  readonly decisionPoints: { readonly from: string; readonly to: string; readonly refs: string[] }[];
}

export interface ThesisQuestion { readonly question: string; readonly why: string; readonly tier: 'A' | 'B' | 'C'; readonly dimension?: string; readonly resolves?: string }

/** The cached result for one understanding snapshot. */
export interface ThesisRecord {
  readonly snapshotId: string;
  readonly businessModel: BusinessModelSketch;
  readonly theses: StrategicThesis[];
  readonly top: string[];
  readonly questions: ThesisQuestion[];
  readonly founder: { readonly myRead: string; readonly matters: { readonly thesisId: string; readonly headline: string; readonly body: string }[] };
  readonly dropped: { readonly part: string; readonly text: string; readonly reason: string }[];
}

export interface ThesisInput {
  readonly businessName: string;
  readonly language: string;
  readonly facts: { readonly ref: string; readonly text: string }[];
  readonly synthesis: string;
  readonly hypotheses: { readonly ref: string; readonly interpretation: string; readonly alternative: string; readonly unknown: string; readonly reversal: string }[];
  readonly unknowns: string[];
  readonly notConcluding: string[];
}

/** What the model returns (raw, before any check). */
export interface ThesisModelOutput {
  readonly businessModel: BusinessModelSketch;
  readonly myRead: { readonly text: string; readonly kind: 'fact' | 'interpretation'; readonly refs: string[] }[];
  readonly theses: Omit<StrategicThesis, 'eligibility' | 'score' | 'rank'>[];
  /** A safe current-driver question, used when the snapshot holds none (older snapshots). */
  readonly driverQuestion?: { readonly text: string; readonly why: string };
}

export interface IThesisModelPort {
  /** Fails safe to null (the card keeps its existing first read; the flow keeps its existing questions). */
  compose(input: ThesisInput): Promise<ThesisModelOutput | null>;
  /** The founder-facing synthesis, written AFTER ranking from the top theses only (2026-10-17). Fails safe to null. */
  project?(input: FounderProjectionInput): Promise<FounderProjectionOutput | null>;
}

/**
 * FOUNDER PROJECTION (2026-10-17). The thesis call writes its founder copy before the code ranks the theses, so MY READ
 * could describe a lower-ranked insight. The projection runs after ranking and sees ONLY the top theses: MY READ, WHAT
 * I THINK MATTERS and their questions become one reasoning chain. Each "matters" item is three parts: the grounded
 * relationship → the strategic decision areas it could change → what founder evidence is still unknown.
 */
export interface FounderProjectionInput {
  readonly businessName: string;
  readonly language: string;
  readonly facts: { readonly ref: string; readonly text: string }[];
  readonly motions: { readonly name: string; readonly entry: string[]; readonly buying: string[]; readonly continuation: string[] }[];
  readonly theses: { readonly id: string; readonly headline: string; readonly relationship: string; readonly implication: string; readonly decisions: DecisionArea[]; readonly unknown: string; readonly question: string; readonly facts: string[] }[];
}
export interface FounderProjectionOutput {
  readonly myRead: { readonly text: string; readonly refs: string[] }[];
  readonly matters: { readonly thesisId: string; readonly headline: string; readonly relationship: string; readonly domains: string; readonly unknown: string }[];
  readonly questions: { readonly thesisId: string; readonly question: string }[];
}

// ── input ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MECH_TEXT: Record<string, string> = {
  group_timetable: 'sessions are booked from a published schedule',
  one_to_one: 'one-to-one work is offered',
  paid_first_step: 'a paid first step comes before the main offer',
  packages: 'multi-session packages are sold',
};

/**
 * The governed material, numbered. Works on every stored snapshot: the v2 read (observed model lines, structural
 * synthesis, hypotheses, quotes) when present, else the v1 governed fields (explicit offer items, evidence-backed
 * positioning, addressed audience, visible paths, evidenced tensions). null when there is too little to reason on.
 */
export function thesisInput(u: GovernedUnderstanding | null, businessName: string, language: string): ThesisInput | null {
  if (!u) return null;
  const r = u.read;
  const st = r?.structure;
  const facts: string[] = [];
  if (u.offer?.summary?.trim()) facts.push(u.offer.summary.trim());
  for (const d of r?.model ?? []) for (const k of d.known ?? []) if (k.basis === 'observed' && k.text?.trim()) facts.push(k.text.trim());
  // What the offer states explicitly (prices, packages, formats) is governed evidence on every snapshot.
  for (const x of (u.offer?.explicit ?? []).slice(0, 12)) if (x?.trim()) facts.push(`Stated by the business: ${x.trim()}`);
  if (!r) {
    for (const x of u.positioning?.evidenceBacked ?? []) if (x?.trim()) facts.push(`Positioning the sources back up: ${x.trim()}`);
    const who = (u.audience?.addressed ?? []).filter(Boolean);
    if (who.length) facts.push(`The business addresses: ${who.join('; ')}`);
    for (const c of u.contradictions ?? []) for (const e of c.evidence ?? []) if (e.quote?.trim()) facts.push(`Quoted from "${e.page}": "${e.quote.trim()}"`);
  }
  for (const x of u.acquisition?.visiblePaths ?? []) if (x?.trim()) facts.push(`Visible path to buy or book: ${x.trim()}`);
  for (const m of st?.mechanisms ?? []) if (MECH_TEXT[m.kind]) facts.push(`Verified on the page "${m.ref}": ${MECH_TEXT[m.kind]}.`);
  for (const h of st?.hypotheses ?? []) for (const e of h.evidence ?? []) if (e.quote?.trim()) facts.push(`Quoted from "${[e.page ?? e.ref, e.context].filter(Boolean).join(' · ')}": "${e.quote.trim()}"`);
  const unique = [...new Set(facts)].slice(0, 30);
  if (unique.length < 3) return null;
  return {
    businessName, language,
    facts: unique.map((text, i) => ({ ref: `F${i + 1}`, text })),
    synthesis: st?.synthesis?.trim() ?? '',
    hypotheses: (st?.hypotheses ?? []).map((h, i) => ({ ref: `H${i}`, interpretation: h.interpretation, alternative: h.alternative, unknown: h.discriminator?.unknown ?? '', reversal: h.reversal })),
    unknowns: r ? (r.model ?? []).flatMap((d) => (d.unknown ?? []).map((x) => `${d.dimension}: ${x}`)).slice(0, 20) : (u.unknowns ?? []).slice(0, 12),
    notConcluding: (r?.notConcluding ?? []).map((n) => n.claim).filter(Boolean).slice(0, 8),
  };
}

// ── checks shared by the theses and the founder copy ──────────────────────────────────────────────────────────────────

const sentencesOf = (t: string): string[] => (t.match(/[^.!?]+(?:[.!?]+["”»)]*|$)/gu) ?? []).map((x) => x.trim()).filter(Boolean);
/** Numbers a sentence asserts ("1" alone is "one-to-one" / "first", not a figure). */
const numbersIn = (t: string): string[] => (t.match(/\d+(?:[.,]\d+)?/g) ?? []).filter((n) => n !== '1');
const words = (t: string): number => (t.match(/\p{L}+/gu) ?? []).length;
/** Founder copy: hard maximum words per sentence (target ≤ 25). Longer sentences are shortened at a clause boundary. */
const MAX_WORDS = 30;
/** A sentence over the hard maximum, cut at its last clause boundary that keeps ≥ 8 words; '' when no clean cut exists. */
function shorten(s: string): string {
  if (words(s) <= MAX_WORDS) return s;
  const cuts = [...s.matchAll(/[,;:—–](?=\s)/gu)].map((m) => m.index!).reverse();
  for (const i of cuts) { const head = s.slice(0, i).trim(); if (words(head) <= MAX_WORDS && words(head) >= 8) return `${head}.`; }
  return '';
}
/** An INTERPRETATION must read as BB's reading, not as a hidden fact. */
const READING = /(?<!\p{L})(sugereaz\p{L}*|pare|par|citirea mea|interpretarea mea|cred c[ăa]|suggest\p{L}*|seems?|appears?|my reading|i read|reading is|suggerisc\p{L}*|sembra|la mia lettura|deutet|scheint|meine lesart|probabil|likely|may|might|poate|pot|ar putea|dac[ăa]|if)(?!\p{L})/iu;
/** A sentence that leans on the one before it ("If they do not…", "Dacă nu…", "This means…"). */
const BACK_REFERENCE = /^(if (they|it|so|not)|otherwise|this|that|these|those|then|dac[ăa] (nu|da|a[șs]a)|altfel|asta|aceasta|acest|acestea|atunci|altrimenti|questo|quindi|wenn nicht|sonst|das|dies)(?!\p{L})/iu;
const DECISION_NOUNS = new Set(['conversion', 'conversie', 'conversii', 'conversione', 'retention']);
/** Generic business nouns that name WHAT a decision affects (internal reasoning only, never founder copy). */
const AREA_NOUNS = new Set(['revenue', 'venit', 'venituri', 'fatturato', 'umsatz']);
const contentWords = (t: string): Set<string> => new Set(t.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
/** How much of `text` one fact already says (share of text's content words found in the fact). */
const coveredBy = (text: string, fact: string): number => { const w = [...contentWords(text)]; if (!w.length) return 0; const f = contentWords(fact); return w.filter((x) => f.has(x)).length / w.length; };
const LABELS = /\b(hypothes|ipotez|ipotes|hypothès|thesis|tez[ăa])\p{L}*|\b[FHQST]\d+\b/iu;
/** A catalogue sentence: five or more listed items (commas, "·", ";"). */
const isCatalogue = (t: string): boolean => (t.match(/[,·;]/g) ?? []).length >= 5;

/**
 * Internal thesis fields are reasoning, not founder copy: they may interpret freely, but may not invent a fact. The
 * relationship (which states how facts connect) may not add a number, an unlicensed claim or economics; the implication
 * and the decision (ifTrue) may not add a number or economics. Everything founder-facing gets the full check.
 */
function makeInternalChecker(input: ThesisInput) {
  const source = [...input.facts.map((f) => f.text), input.synthesis, ...input.hypotheses.flatMap((h) => [h.interpretation, h.alternative, h.unknown, h.reversal])].join(' ');
  const claims = new Set(claimTermsIn(source));
  const nums = new Set(numbersIn(source));
  return (x: string, field: 'relationship' | 'implication' | 'ifTrue'): string => {
    if (numbersIn(x).some((n) => !nums.has(n))) return 'a number the governed input does not contain';
    if (field === 'relationship') {
      const c = claimTermsIn(x).filter((t) => !claims.has(t) && !DECISION_NOUNS.has(t) && !AREA_NOUNS.has(t));
      if (c.length) return `a claim the governed input does not license (${c.join(', ')})`;
    }
    return ungroundedInference(x, source, true) === 'economics' ? 'ungrounded inference (economics)' : '';
  };
}

function makeChecker(input: ThesisInput) {
  const source = [...input.facts.map((f) => f.text), input.synthesis, ...input.hypotheses.flatMap((h) => [h.interpretation, h.alternative, h.unknown, h.reversal])].join(' ');
  const claims = new Set(claimTermsIn(source));
  const escalations = new Set(escalationsIn(source));
  const nums = new Set(numbersIn(source));
  /** '' when the sentence passes, else why it fails. `prescriptive`: the sentence names a decision (ifTrue), so a
   *  recommendation word is its job, not a claim. */
  return (x: string, interpretive: boolean, founderFacing: boolean, prescriptive = false): string => {
    if (/\?\s*["”»)]*$/.test(x)) return 'a question';
    if (LABELS.test(x)) return 'exposes refs or reasoning labels';
    if (numbersIn(x).some((n) => !nums.has(n))) return 'a number the governed input does not contain';
    // Decision-area nouns (conversion, retention) name WHERE a decision sits, not a performance claim; rates and
    // performance judgements are still caught by the inference guard below.
    // Romanian "venit" is also the participle "came" ("au venit"): not a revenue claim after an auxiliary.
    const cameVerb = /(?<!\p{L})(au|a|ai|am|a[țţ]i|s-a|s-au|o|fi|mai)\s+venit(?!\p{L})/iu.test(x);
    const c = prescriptive ? [] : claimTermsIn(x).filter((t) => !claims.has(t) && !DECISION_NOUNS.has(t) && (founderFacing || !AREA_NOUNS.has(t)) && !(t === 'venit' && cameVerb));
    if (c.length) return `a claim the governed input does not license (${c.join(', ')})`;
    const e = escalationsIn(x).filter((t) => !escalations.has(t));
    if (e.length) return `an escalation the governed input does not support (${e.join(', ')})`;
    const inf = ungroundedInference(x, source, interpretive);
    if (inf) return `ungrounded inference (${inf})`;
    if (founderFacing && isCatalogue(x)) return 'a catalogue, not a read';
    if (founderFacing && words(x) > MAX_WORDS) return 'too long for the founder screen';
    return '';
  };
}

// ── eligibility + ranking ─────────────────────────────────────────────────────────────────────────────────────────────

function eligibility(t: ThesisModelOutput['theses'][number], input: ThesisInput, check: ReturnType<typeof makeInternalChecker>): StrategicThesis['eligibility'] {
  const reasons: string[] = [];
  const valid = new Set(input.facts.map((f) => f.ref));
  const facts = [...new Set((t.facts ?? []).filter((r) => valid.has(r)))];
  if (facts.length < 2) reasons.push('connects fewer than two governed facts');
  if (!(t.decisions ?? []).some((d) => DECISION_AREAS.includes(d))) reasons.push('names no decision it would change');
  if (!t.weakenedBy?.trim() || !t.unknown?.trim()) reasons.push('not reversible (no weakening evidence or unknown)');
  for (const [field, text] of [['relationship', t.relationship], ['implication', t.implication], ['ifTrue', t.ifTrue]] as const) {
    for (const s of sentencesOf(text ?? '')) { const why = check(s, field); if (why) reasons.push(`${field}: ${why}`); }
  }
  // An OBSERVATION restates one governed fact (most of what it says is already in that fact); it can be eligible as a
  // thesis but never top-ranked.
  const observationOnly = !t.implication?.trim() || input.facts.some((f) => coveredBy(`${t.relationship} ${t.implication}`, f.text) >= 0.6);
  return { pass: reasons.length === 0, reasons, observationOnly };
}

/** Lexicographic score in the canonical order (higher is better). */
function score(t: Omit<StrategicThesis, 'score' | 'rank'>, input: ThesisInput, others: Omit<StrategicThesis, 'score' | 'rank'>[]): number[] {
  const decisions = [...new Set(t.decisions.filter((d) => DECISION_AREAS.includes(d)))];
  const leverage = Math.min(3, decisions.filter((d) => HIGH_LEVERAGE.has(d)).length + (t.ifTrue.trim() ? 1 : 0));
  const consequence = Math.min(3, decisions.length);
  const text = `${t.relationship} ${t.implication}`;
  const overlap = Math.max(0, ...input.facts.map((f) => { const c = coveredBy(text, f.text); return c >= 0.6 ? 2 : c >= 0.4 ? 1 : 0; }), ...others.filter((o) => o.id !== t.id).map((o) => (sameInsight(text, `${o.relationship} ${o.implication}`, 0.6) ? 1 : 0)));
  const nonObvious = 2 - overlap;
  const crossDim = Math.min(3, new Set(t.dimensions).size);
  const reversibility = t.weakenedBy.trim() && t.unknown.trim() ? 1 : 0;
  const grounding = Math.min(4, t.facts.length);
  return [leverage, consequence, nonObvious, crossDim, reversibility, -Math.max(1, t.priority || 9), grounding];
}
const compare = (a: readonly number[], b: readonly number[]): number => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i]! - a[i]!; return 0; };

// ── the whole pass ────────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_TOP = 2;

/**
 * Eligibility, ranking, question selection and the founder copy, all deterministic over the model's output.
 * null when nothing usable is left (the card and the flow keep their existing behaviour).
 */
export function governTheses(out: ThesisModelOutput | null, input: ThesisInput, u: GovernedUnderstanding, snapshotId: string): ThesisRecord | null {
  if (!out) return null;
  const check = makeChecker(input);
  const internal = makeInternalChecker(input);
  /** A thesis question the founder can be asked: a real question, not presupposing a future they have not stated. */
  const askable = (q: string): boolean => /\?\s*$/.test(q.trim()) && !presupposesFuture(q) && words(q) <= 45;
  const dropped: ThesisRecord['dropped'][number][] = [];
  const valid = new Set(input.facts.map((f) => f.ref));

  // 1. Eligibility (a gate), then the canonical ranking among the eligible.
  const raw = (out.theses ?? []).slice(0, 10).map((t, i) => ({ ...t, id: `T${i + 1}`, facts: [...new Set((t.facts ?? []).filter((r) => valid.has(r)))], decisions: (t.decisions ?? []).filter((d) => DECISION_AREAS.includes(d)), dimensions: t.dimensions ?? [] }));
  const judged = raw.map((t) => ({ ...t, eligibility: eligibility(t, input, internal) }));
  for (const t of judged) if (!t.eligibility.pass) dropped.push({ part: `thesis ${t.id}`, text: t.headline, reason: t.eligibility.reasons.join('; ') });
  const eligible = judged.filter((t) => t.eligibility.pass);
  const scored = eligible.map((t) => ({ ...t, score: score(t, input, eligible) }));
  // Hard rule: an observation-only thesis ranks after every thesis that carries interpretation and consequence.
  scored.sort((a, b) => (Number(a.eligibility.observationOnly) - Number(b.eligibility.observationOnly)) || compare(a.score, b.score));
  // De-duplicate: a thesis that makes the same point as a higher-ranked one is dropped.
  const ranked: typeof scored = [];
  for (const t of scored) {
    if (ranked.some((r) => sameInsight(`${t.relationship} ${t.implication}`, `${r.relationship} ${r.implication}`, 0.55))) { dropped.push({ part: `thesis ${t.id}`, text: t.headline, reason: 'duplicates a higher-ranked thesis' }); continue; }
    ranked.push(t);
  }
  const theses: StrategicThesis[] = [...ranked.map((t, i) => ({ ...t, rank: i + 1 })), ...judged.filter((t) => !t.eligibility.pass)];
  // The top theses: the highest-ranked with interpretation and consequence whose founder copy survives its checks.
  const candidates = ranked.filter((t) => !t.eligibility.observationOnly);

  // 2. Questions: the current driver first when performance is unknown, then the top theses' discriminating questions.
  const questions: ThesisQuestion[] = [];
  const add = (q: ThesisQuestion) => { if (questions.length < 3 && !questions.some((x) => sameInsight(x.question, q.question, 0.5))) questions.push(q); };
  const stored = u.read?.questions ?? [];
  const tiers = u.read?.questionTiers ?? [];
  const driverUnknown = !u.read || (u.read.strategyReadiness?.missing ?? []).includes('performance') || !(u.read.model ?? []).some((d) => d.dimension === 'performance' && (d.known ?? []).length);
  const driver = stored.find((q) => q.dimension === 'performance');
  // Its rationale is BB's own neutral sentence (the card supplies it), never the model's labels for the lines.
  if (driverUnknown && driver) add({ question: driver.question, why: '', tier: 'A', dimension: 'performance' });
  // No stored driver question (older snapshots): the model's own, if it is a clean, non-presupposing question.
  // A question asks, it does not claim: askable (a real question, no presupposed future) is the bar.
  else if (driverUnknown && out.driverQuestion?.text && askable(out.driverQuestion.text)) {
    add({ question: out.driverQuestion.text.trim(), why: '', tier: 'A', dimension: 'performance' });
  }
  const matters: ThesisRecord['founder']['matters'][number][] = [];
  const top: typeof candidates = [];
  for (const t of candidates) {
    if (top.length >= MAX_TOP) break;
    // The body may END with the open question that would distinguish the readings (that is its job); nowhere else.
    const parts = sentencesOf(t.founder?.body ?? '').map((s) => shorten(s) || s);
    const keep = parts.map((s, i) => {
      const lastQuestion = i === parts.length - 1 && /\?\s*["”»)]*$/.test(s);
      const why = check(lastQuestion ? s.replace(/\?\s*["”»)]*$/, '.') : s, true, true);
      if (why) dropped.push({ part: `matters ${t.id}`, text: s, reason: why });
      return !why;
    });
    // Coherence over completeness: when a sentence after a removed one refers back to it, the body no longer reads as one
    // thought; the next-ranked thesis takes its place.
    const dangling = parts.some((x, i) => i > 0 && keep[i] && !keep[i - 1] && BACK_REFERENCE.test(x.trim()));
    if (dangling) { dropped.push({ part: `matters ${t.id}`, text: t.founder?.body ?? '', reason: 'incoherent after salvage (refers back to a removed sentence)' }); continue; }
    const body = parts.filter((_, i) => keep[i]).slice(0, 3).join(' ');
    if (!body) continue;
    // The founder headline, else the thesis's own headline, whichever passes. A headline may frame a fork as a question
    // ("X: Y or Z?"); it is checked as the statement it frames.
    const headline = [t.founder?.headline ?? '', t.headline ?? ''].map((h) => h.trim()).find((h) => {
      const why = h ? (check(h.replace(/\?\s*$/, '.'), true, true) || (primacyUnlicensed(h, input.facts.map((f) => f.text).join(' ')) ? 'a primacy word the evidence does not state' : '')) : 'empty';
      if (why && h) dropped.push({ part: `matters ${t.id} headline`, text: h, reason: why });
      return !why;
    }) ?? '';
    top.push(t);
    matters.push({ thesisId: t.id, headline: headline.replace(/[.:]\s*$/, ''), body });
  }
  for (const t of top) if (askable(t.question ?? '')) add({ question: t.question.trim(), why: t.questionWhy?.trim() ?? '', tier: 'B', dimension: t.dimensions[0], resolves: t.id });
  for (const t of candidates.filter((x) => !top.includes(x))) if (questions.length < 3 && askable(t.question ?? '')) add({ question: t.question.trim(), why: t.questionWhy?.trim() ?? '', tier: 'C', dimension: t.dimensions[0], resolves: t.id });
  // Still short of three: the existing governed questions, in their own order (acquisition kept).
  for (const q of stored) if (questions.length < 3) add({ question: q.question, why: q.why, tier: (tiers.find((t) => t.question === q.question)?.tier ?? 'C'), dimension: q.dimension });
  // A v1 snapshot has no governed questions: its stored unknowns that read as questions.
  if (!u.read) for (const q of u.unknowns ?? []) if (questions.length < 3 && /\?\s*$/.test(q.trim())) add({ question: q.trim(), why: '', tier: 'C' });
  const governedWhy = (q: ThesisQuestion): ThesisQuestion => { const w = sentencesOf(q.why).slice(0, 1).filter((s) => !check(s, true, true)).join(' '); return { ...q, why: w }; };

  // 3. Founder copy: MY READ (2–3 sentences, each grounded) + WHAT I THINK MATTERS (the top theses), re-checked.
  const read: string[] = [];
  for (const item of out.myRead ?? []) {
    if (read.length >= 3) break;
    const refs = (item.refs ?? []).filter((r) => valid.has(r) || r === 'S');
    if (!refs.length) { dropped.push({ part: 'myRead', text: item.text, reason: 'no governed fact cited' }); continue; }
    for (const raw of sentencesOf(item.text)) {
      if (read.length >= 3) break;
      const s = shorten(raw);
      if (!s) { dropped.push({ part: 'myRead', text: raw, reason: 'too long for the founder screen' }); continue; }
      const sourceText = input.facts.map((f) => f.text).join(' ');
      const why = check(s, item.kind === 'interpretation', true)
        || (item.kind === 'fact' && primacyUnlicensed(s, sourceText) ? 'a primacy word the evidence does not state' : '')
        || (item.kind === 'interpretation' && !READING.test(s) ? 'an interpretation stated as a fact (no reading marker)' : '');
      if (why) dropped.push({ part: 'myRead', text: s, reason: why }); else read.push(s);
    }
  }


  if (!read.length && !matters.length) return null;
  return {
    snapshotId,
    businessModel: { motions: (out.businessModel?.motions ?? []).filter((m) => (m.refs ?? []).some((r) => valid.has(r))), offerRoles: (out.businessModel?.offerRoles ?? []).filter((o) => (o.refs ?? []).some((r) => valid.has(r))), decisionPoints: (out.businessModel?.decisionPoints ?? []).filter((d) => (d.refs ?? []).some((r) => valid.has(r))) },
    theses, top: top.map((t) => t.id), questions: questions.map(governedWhy),
    founder: { myRead: read.join(' '), matters },
    dropped,
  };
}

/** The record within the founder_event metadata budget: the rejected candidates' texts go first, then the audit. */
export function compactRecord(r: ThesisRecord, budget = 18000): ThesisRecord {
  if (JSON.stringify(r).length <= budget) return r;
  const slim: ThesisRecord = { ...r, theses: r.theses.map((t) => (t.eligibility.pass ? t : { ...t, relationship: '', implication: '', ifTrue: '', founder: { headline: '', body: '', refs: [] } })) };
  if (JSON.stringify(slim).length <= budget) return slim;
  const lean: ThesisRecord = { ...slim, dropped: slim.dropped.slice(0, 10).map((d) => ({ ...d, text: d.text.slice(0, 120) })) };
  if (JSON.stringify(lean).length <= budget) return lean;
  return { ...lean, theses: lean.theses.filter((t) => t.eligibility.pass), businessModel: { motions: lean.businessModel.motions.slice(0, 4), offerRoles: [], decisionPoints: lean.businessModel.decisionPoints.slice(0, 4) } };
}

/** The top theses with their current status (after the mirror moved them), for the mirror and strategy. */
export function thesesWithStatus(r: ThesisRecord, moves: { thesisId: string; status: ThesisStatus; because?: string }[] = []): (StrategicThesis & { status: ThesisStatus; because: string })[] {
  const byId = new Map(r.theses.map((t) => [t.id, t]));
  const ids = [...new Set([...r.top, ...r.questions.map((q) => q.resolves).filter((x): x is string => Boolean(x))])];
  return ids.map((id) => byId.get(id)).filter((t): t is StrategicThesis => Boolean(t)).map((t) => {
    const m = [...moves].reverse().find((x) => x.thesisId === t.id);
    return { ...t, status: m?.status ?? 'open', because: m?.because ?? '' };
  });
}


// ── founder projection (2026-10-17) ──────────────────────────────────────────────────────────────────────────────────

/** The projection's input: the top theses in rank order, the motions, the governed facts. */
export function projectionInput(record: ThesisRecord, input: ThesisInput): FounderProjectionInput {
  const top = record.top.map((id) => record.theses.find((t) => t.id === id)).filter((t): t is StrategicThesis => Boolean(t));
  return {
    businessName: input.businessName, language: input.language, facts: input.facts,
    motions: record.businessModel.motions.map((m) => ({ name: m.name, entry: m.entry, buying: m.buying, continuation: m.continuation })),
    theses: top.map((t) => ({ id: t.id, headline: t.headline, relationship: t.relationship, implication: t.implication, decisions: t.decisions, unknown: t.unknown, question: t.question, facts: t.facts })),
  };
}

/** Decision areas in the founder's language: the founder never reads an internal code ("customer_journey"). */
export const AREA_LABEL: Record<string, Record<string, string>> = {
  ro: { acquisition: 'atragerea clienților', conversion: 'conversia', retention: 'retenția', expansion: 'extinderea relației cu clientul', positioning: 'poziționarea', offer_design: 'arhitectura ofertei', channel: 'canalele', operating_model: 'modul de operare', resource_allocation: 'alocarea resurselor', customer_journey: 'parcursul clientului', pricing: 'prețurile' },
  en: { acquisition: 'acquisition', conversion: 'conversion', retention: 'retention', expansion: 'expansion', positioning: 'positioning', offer_design: 'offer architecture', channel: 'channels', operating_model: 'operating model', resource_allocation: 'resource allocation', customer_journey: 'customer journey', pricing: 'pricing' },
  it: { acquisition: 'acquisizione', conversion: 'conversione', retention: 'fidelizzazione', expansion: 'espansione', positioning: 'posizionamento', offer_design: "architettura dell'offerta", channel: 'canali', operating_model: 'modello operativo', resource_allocation: 'allocazione delle risorse', customer_journey: 'percorso del cliente', pricing: 'prezzi' },
  de: { acquisition: 'Kundengewinnung', conversion: 'Konversion', retention: 'Kundenbindung', expansion: 'Ausbau der Kundenbeziehung', positioning: 'Positionierung', offer_design: 'Angebotsarchitektur', channel: 'Kanäle', operating_model: 'Betriebsmodell', resource_allocation: 'Ressourcenverteilung', customer_journey: 'Kundenweg', pricing: 'Preisgestaltung' },
};

/** A customer's action written as the founder's ("you pay 200 lei" when the client pays). */
// Unambiguous second-person forms only ("plătiți" / "rezervați" are also adjectives: "pași plătiți").
const CUSTOMER_ACT_AS_YOURS = /(?<!\p{L})(pl[ăa]te[șs]ti|cumperi|rezervi|you pay|you buy|you book|paghi|compri|prenoti|zahlst|kaufst|buchst)(?!\p{L})/iu;
/** A recommendation: the Understanding names the relationship, Strategy decides what to do with it. */
const SOLUTION = /(?<!\p{L})(ar trebui|trebuie s[ăa]|recomand\p{L}*|should|must|need to|dovrest\p{L}*|bisogna|solltest|musst)(?!\p{L})/iu;
/** Unit economics nobody stated: acquisition cost, margin, profitability (2026-10-17). */
const ECONOMICS = /(?<!\p{L})(cost\p{L}* de achizi\p{L}*|f[ăa]r[ăa] (?:o )?(?:nou[ăa] )?achizi\p{L}*|without (?:a )?(?:new )?acquisition|cac|acquisition cost\p{L}*|cost per (?:client|customer|lead)|marj\p{L}*|margin\p{L}*|profit\p{L}*|rentabil\p{L}*|costo di acquisizione|akquisekosten|marge\p{L}*)(?!\p{L})/iu;
/** An effect the relationship supposedly has (filters, protects, discourages, creates a barrier): a claim, never a fact. */
const EFFECT = /(?<!\p{L})(barier\p{L}*|barrier\p{L}*|fric[țt]iun\p{L}*|friction|filtreaz\p{L}*|filters?|protejeaz\p{L}*|proteja|protects?|selecteaz\p{L}*|selecta|selects?|descurajeaz\p{L}*|discourag\p{L}*|opri|opre[șs]te|stops?|blocheaz\p{L}*|blocks?|separ[ăa]|separates|califica|qualif(?:y|ies))(?!\p{L})/iu;
/** A conclusion drawn from the structure ("which means…"): the facts state structure, never what it means. */
const INFERS = /(?<!\p{L})(ceea ce (?:[îi]nseamn[ăa]|face|arat[ăa]|indic[ăa])|which (?:means|makes|shows|indicates)|il che (?:significa|rende)|was bedeutet)(?!\p{L})/iu;
/** A benchmark nobody stated ("almost everyone continues", "a large share"): a threshold in words. */
const BENCHMARK = /(?<!\p{L})(aproape to[țt]i|aproape toate|majoritatea|cei mai mul[țt]i|cele mai multe|propor[țt]ie mare|o parte (?:mare|semnificativ\p{L}*)|almost (?:all|everyone)|most of|the majority|a large share|a significant share|quasi tutti|la maggior parte|fast alle|die meisten)(?!\p{L})/iu;
/** A sentence that opens on a condition ("If the path is real, …"): a further reading, not the structure. */
const SPECULATIVE_OPENING = /^(dac[ăa]|if|se|wenn|qualora|falls)(?!\p{L})/iu;
/** In a question, "which brings the most" asks; only benchmark assertions count ("do almost all continue?"). */
const BENCHMARK_Q = /(?<!\p{L})(aproape to[țt]i|aproape toate|majoritatea|propor[țt]ie mare|o parte (?:mare|semnificativ\p{L}*)|almost (?:all|everyone)|the majority|a large share|a significant share|quasi tutti|la maggior parte|fast alle)(?!\p{L})/iu;
/** Strength the evidence must state in the same words: "mandatory", "no other (direct) path", "any/every". */
const MANDATORY = /(?<!\p{L})(obligatori\p{L}*|mandatory|required|compulsory|obbligatori\p{L}*|verpflichtend\p{L}*)(?!\p{L})/iu;
const NO_OTHER_PATH = /(?<!\p{L})(nu exist[ăa] (?:o |nicio )?(?:alt[ăa] )?(?:cale|variant[ăa]|drum)\p{L}*|there is no (?:direct |other )?(?:way|path|route)|no (?:direct|other) (?:way|path|route)|non c'è (?:un'altra |una )?(?:via|strada)|kein(?:en)? (?:direkten |anderen )?weg)(?!\p{L})/iu;
const ANY = /(?<!\p{L})(orice|any|every|ogni|jede[rsnm]?)\s+/iu;
/** The same sentence at the strength the evidence states: the unlicensed "mandatory" word, "no other path" clause and
 *  "any" quantifier removed (never anything else). '' when nothing changes. */
export function soften(sentence: string, source: string): string {
  const src = source.toLowerCase();
  let x = sentence;
  const clauses = x.split(/,\s+/u);
  const keep = clauses.filter((c) => !(NO_OTHER_PATH.test(c) && !src.includes(c.match(NO_OTHER_PATH)![0].toLowerCase())));
  x = keep.join(', ');
  const m = x.match(MANDATORY)?.[0];
  if (m && !src.includes(m.toLowerCase())) x = x.replace(new RegExp(`,?\\s*${m}(?!\\p{L})`, 'iu'), '');
  const a = x.match(ANY)?.[0];
  if (a && (MANDATORY.test(sentence) || NO_OTHER_PATH.test(sentence)) && !src.includes(a.trim().toLowerCase())) x = x.replace(ANY, '');
  x = x.replace(/\s{2,}/gu, ' ').replace(/\s+([,.;:])/gu, '$1').replace(/,\s*\./gu, '.').trim();
  if (!/[.!?]$/u.test(x)) x = `${x}.`;
  return x === sentence ? '' : x;
}
/** "if it is real": a conditional, not a claim of certainty. */
const CONDITIONAL_REAL = /((?<!\p{L})(?:dac[ăa]|if|se|wenn)(?!\p{L})[^.,;:]*?)\s(?:este|e|is|sunt|are|è|ist)\s(?:real[ăe]?|reali|real)(?!\p{L})/iu;
/** The strategic decision areas a consequence sentence may name (generic, per content language). */
const DOMAIN = /(?<!\p{L})(reten\p{L}*|fideliz\p{L}*|cross-sell\p{L}*|v[âa]nz\p{L}* (?:[îi]ncruci[șs]at\p{L}*|suplimentar\p{L}*)|parcurs\p{L}*|traseu\p{L}*|journey|lifecycle|poziț?ion\p{L}*|positioning|conversi\p{L}*|conversion|achizi\p{L}*|acquisition|ofert\p{L}*|offer\p{L}*|canal\p{L}*|channel\p{L}*|pre[țt]\p{L}*|pricing|posizionament\p{L}*|acquisizion\p{L}*|fidelizzazion\p{L}*|kundenbindung|positionierung|akquise|angebot\p{L}*|vertrieb\p{L}*)(?!\p{L})/iu;
/** A consequence stays conditional: it says what WOULD change, never that it already has. */
const CONDITIONAL = /(?<!\p{L})(dac[ăa]|if|se|wenn|ar schimba|ar influen[țt]a|ar conta|would|could|cambierebbe|potrebbe|w[üu]rde|k[öo]nnte)(?!\p{L})/iu;
/** What BUSINESS BRAIN does not know yet (the founder knows their own customers: "you don't know" is the wrong actor). */
const UNKNOWN_MARK = /(?<!\p{L})(nu [șs]tiu|nu [șs]tim|nu e clar|nu este clar|nu e [îi]nc[ăa] clar|r[ăa]m[âa]ne de aflat|de aflat|r[ăa]m[âa]ne deschis|we don't know|i don't know|not yet known|unknown|unclear|still open|non so|non sappiamo|non è chiaro|wei[ßs] ich nicht|wissen wir nicht|unklar|offen)(?!\p{L})/iu;
/** A threshold the question invents: a sample size, a time window or a percentage nobody stated. */
const SAMPLE = /(?<!\p{L})(din|out of|of every|su|von)\s+\d+(?!\p{L})/iu;
const WINDOW = /(?<!\p{L})(în|in|within|entro|innerhalb)\s+(?:următoarele|următorii|primele|primii|the next|the first|i prossimi|le prossime|den n[äa]chsten|den ersten)?\s*(?:\d+|o|un|una|două|doi|trei|one|two|three|a|uno|due|tre|ein\p{L}*|zwei|drei)?\s*(zile|zi|săptămâni|săptămână|luni|lună|days?|weeks?|months?|giorni|settimane|mesi|tage[n]?|wochen|monate[n]?)(?!\p{L})/iu;
const PERCENT = /\d+\s*%/u;
export function inventedThreshold(q: string, source: string): string {
  const nums = new Set(numbersIn(source));
  const n = numbersIn(q).find((x) => !nums.has(x));
  if (n) return `a number nobody stated (${n})`;
  const m = q.match(SAMPLE)?.[0] ?? q.match(WINDOW)?.[0] ?? q.match(PERCENT)?.[0] ?? q.match(BENCHMARK_Q)?.[0];
  return m && !source.toLowerCase().includes(m.toLowerCase()) ? `a threshold nobody stated ("${m}")` : '';
}

/**
 * Deterministic governance of the projection, with the stored copy as the fallback (every rule applied to it too):
 *   MY READ ≤ 3 sentences that together touch every top thesis, each grounded and fact-checked;
 *   each MATTERS item = relationship (grounded, no behaviour/causality/economics, no solution) + consequence (names a
 *   decision area, stays conditional) + unknown (says what is not known), ≤ 3 sentences;
 *   questions without invented thresholds; actor ownership kept (a customer's action is never the founder's).
 */
export function governProjection(out: FounderProjectionOutput | null, record: ThesisRecord, input: ThesisInput): ThesisRecord {
  const check = makeChecker(input);
  const source = input.facts.map((f) => f.text).join(' ');
  const dropped: ThesisRecord['dropped'][number][] = [];
  const top = record.top.map((id) => record.theses.find((t) => t.id === id)).filter((t): t is StrategicThesis => Boolean(t));
  /** The continuation forms of the motion a thesis sits in (the motion sharing most of its facts), else of the business. */
  const formsOf = (t: StrategicThesis): string[] => {
    const scored = record.businessModel.motions.map((m) => ({ m, n: (m.refs ?? []).filter((r) => t.facts.includes(r)).length })).sort((a, b) => b.n - a.n);
    const pick = scored[0] && scored[0].n > 0 ? [scored[0].m] : record.businessModel.motions;
    return pick.flatMap((m) => m.continuation).filter((c) => c && c !== 'none_observed');
  };
  /** '' when a founder sentence passes every copy rule. */
  /** `names` = the sentence names decision areas (retention, conversion…): that is its job, not a performance claim.
   *  `reading` = MY READ: a sentence that reads as a possibility ("may", "pot", "pare") is a reading, not a behaviour claim.
   *  `cut` = the stored copy may be shortened at a clause; a projected sentence never is (a cut can break its meaning). */
  const copyWhy = (sentence: string, names = false, reading = false, cut = false): string => {
    const s = cut ? shorten(sentence) || sentence : sentence;
    if (words(s) > MAX_WORDS) return 'too long for the founder screen';
    const sol = s.match(SOLUTION)?.[0]; if (sol) return `a recommendation, not the relationship ("${sol}")`;
    const econ = s.match(ECONOMICS)?.[0]; if (econ && !source.toLowerCase().includes(econ.toLowerCase())) return `economics nobody stated ("${econ}")`;
    const effect = s.match(EFFECT)?.[0]; if (effect && !source.toLowerCase().includes(effect.toLowerCase())) return `an effect nobody established ("${effect}")`;
    const actor = s.match(CUSTOMER_ACT_AS_YOURS)?.[0]; if (actor) return `a customer action written as the founder's ("${actor}")`;
    const infers = s.match(INFERS)?.[0]; if (infers) return `draws a conclusion the facts do not state ("${infers}")`;
    const bench = s.match(BENCHMARK)?.[0]; if (bench && !source.toLowerCase().includes(bench.toLowerCase())) return `a benchmark nobody stated ("${bench}")`;
    const must = s.match(MANDATORY)?.[0] ?? s.match(NO_OTHER_PATH)?.[0]; if (must && !source.toLowerCase().includes(must.toLowerCase())) return `a strength the evidence does not state ("${must}")`;
    if (/(?<!\p{L})nu [șs]tii(?!\p{L})|you don't know/iu.test(s)) return 'says the founder does not know (it is Business Brain that does not know)';
    const c = check(s.replace(CONDITIONAL_REAL, '$1'), true, true, names); if (c) return c;
    // BB's own unknown ("Nu știu încă câți…", "I don't know yet whether…") asks; it does not claim what customers do. Only a
    // sentence that OPENS in BB's first person counts ("Medicii nu știu de tine" is a claim about doctors).
    const asksAsBB = /^(nu [șs]tiu|i don't know|non so|ich wei[ßs] (?:noch )?nicht)(?!\p{L})/iu.test(s.trim());
    const b = asksAsBB || (reading && READING.test(s)) ? null : behaviourFinding(s, [], false); if (b) return b.reason;
    return '';
  };
  const ok = (part: string, s: string, names = false, reading = false, cut = false): boolean => { const why = copyWhy(s, names, reading, cut); if (why) dropped.push({ part, text: s, reason: why }); return !why; };


  // MATTERS: the projection's three parts, or the stored body filtered by the same rules.
  const matters: ThesisRecord['founder']['matters'][number][] = [];
  for (const t of top) {
    const p = out?.matters.find((m) => m.thesisId === t.id);
    const stored = record.founder.matters.find((m) => m.thesisId === t.id);
    let item: ThesisRecord['founder']['matters'][number] | null = null;
    if (p) {
      const rel = sentencesOf(p.relationship).slice(0, 1)[0] ?? '';
      const dom = sentencesOf(p.domains).slice(0, 1)[0] ?? '';
      const unk = sentencesOf(p.unknown).slice(0, 1)[0] ?? '';
      const headline = p.headline.trim().replace(/[.:]\s*$/, '');
      const parts = [
        ok(`projection ${t.id} relationship`, rel),
        ok(`projection ${t.id} consequence`, dom, true) && (DOMAIN.test(dom) && CONDITIONAL.test(dom) ? true : (dropped.push({ part: `projection ${t.id} consequence`, text: dom, reason: 'names no decision area, or states the consequence as already true' }), false)),
        ok(`projection ${t.id} unknown`, unk) && (UNKNOWN_MARK.test(unk) ? true : (dropped.push({ part: `projection ${t.id} unknown`, text: unk, reason: 'does not say what is still unknown' }), false)),
        Boolean(headline) && !check(headline.replace(/\?\s*$/, '.'), true, true) && !CUSTOMER_ACT_AS_YOURS.test(headline),
      ];
      if (parts.every(Boolean)) item = { thesisId: t.id, headline, body: [rel, isLifecycle(t) ? thesisConsequence(t, input.language) : dom, continuationWording(unk, input.language, formsOf(t))].join(' ') };
      else dropped.push({ part: `projection ${t.id}`, text: [headline, rel, dom, unk].join(' | '), reason: 'incomplete after checks: the stored copy is used' });
    }
    // Deterministic chain when the projection does not pass: the governed relationship, a fixed consequence line over the
    // thesis's decision areas, and what Business Brain does not know yet. Nothing here is written by a model at this step.
    if (!item) {
      // The relationship: the projected sentence, else the stored governed founder sentence for this thesis (what the card
      // already showed), else the thesis's own relationship; the first that passes every rule. A stored sentence that
      // states the structure ("the offer covers two successive stages") keeps it without claiming customers move.
      const rel = [...sentencesOf(p?.relationship ?? ''), ...sentencesOf(stored?.body ?? ''), ...sentencesOf(t.founder?.body ?? ''), ...sentencesOf(t.relationship)]
        .map((x) => (copyWhy(x).startsWith('a strength the evidence does not state') ? soften(x, source) || x : x))
        .find((x) => !/\?\s*["”»)]*$/.test(x) && !BACK_REFERENCE.test(x.trim()) && copyWhy(x) === '');
      const dom = thesisConsequence(t, input.language);
      const unk = continuationWording(unknownLine(t.unknown, input.language), input.language, formsOf(t));
      const headline = [p?.headline ?? '', t.founder?.headline ?? ''].map((h) => h.trim().replace(/[.:]\s*$/, '')).find((h) => h && !check(h.replace(/\?\s*$/, '.'), true, true) && !CUSTOMER_ACT_AS_YOURS.test(h) && !EFFECT.test(h.replace(/\?\s*$/, '')) ) ?? '';
      if (rel && dom && unk && !copyWhy(unk) && headline) {
        item = { thesisId: t.id, headline, body: [rel, dom, unk].join(' ') };
        dropped.push({ part: `matters ${t.id}`, text: item.body, reason: 'deterministic chain used (projection did not pass)' });
      }
    }
    if (!item && stored) {
      const parts = sentencesOf(stored.body);
      const keep = parts.map((x) => ok(`matters ${t.id} (stored)`, x, false, false, true));
      // A kept sentence that leans on a removed one no longer reads as one thought: the item is left out.
      const dangling = parts.some((x, i) => i > 0 && keep[i] && !keep[i - 1] && BACK_REFERENCE.test(x.trim()));
      const kept = parts.filter((_, i) => keep[i]);
      if (dangling) dropped.push({ part: `matters ${t.id} (stored)`, text: stored.body, reason: 'incoherent after removal (refers back to a removed sentence)' });
      else if (kept.length) item = { ...stored, body: kept.slice(0, 3).join(' ') };
    }
    if (item) {
      const headline = relationshipHeadline(item.headline, t, input.language);
      if (headline !== item.headline) dropped.push({ part: `matters ${t.id} headline`, text: item.headline, reason: 'a fork of two effects nobody established: the relationship headline is used' });
      matters.push({ ...item, headline });
    }
  }

  // MY READ: the projection's sentences when, together, they read through every top thesis; else the stored read, same rule.
  /** A projected MY READ sentence that fails ONLY on length is shortened by leaving out elaborating clauses: the version
   *  kept still covers the same top theses and passes every rule (fewest clauses removed, then the longest). */
  const salvage = (x: string): string => {
    const clauses = x.replace(/[.!?]+$/u, '').split(/,\s+/u);
    if (clauses.length < 2) return '';
    const must = myReadCoverage([x], top).filter((c) => c.sentence !== null).map((c) => c.thesisId);
    const options: string[] = [];
    for (let i = 1; i < clauses.length; i++) {
      options.push(clauses.filter((_, k) => k !== i).join(', '));
      for (let j = i + 1; j < clauses.length; j++) options.push(clauses.filter((_, k) => k !== i && k !== j).join(', '));
    }
    const fits = options.map((o) => `${o}.`).filter((o) => copyWhy(o, false, true) === ''
      && myReadCoverage([o], top).filter((c) => c.sentence !== null).map((c) => c.thesisId).join() === must.join());
    return fits.sort((a, b) => words(b) - words(a))[0] ?? '';
  };
  const readFrom = (sentences: string[], part: string): string[] => {
    const passing = sentences.map((x) => {
      const why = copyWhy(x, false, true);
      if (why === 'too long for the founder screen') { const short = salvage(x); if (short) { dropped.push({ part, text: x, reason: `shortened to fit (clauses left out): ${short}` }); return short; } }
      if (why.startsWith('a strength the evidence does not state')) { const soft = soften(x, source); if (soft && copyWhy(soft, false, true) === '') { dropped.push({ part, text: x, reason: `softened to the evidence: ${soft}` }); return soft; } }
      return x;
    }).filter((x) => ok(part, x, false, true));
    // Concise by construction (2026-10-17): once the sentences so far cover every top thesis, a conditional sentence adds a
    // new speculative reading and is left out, and nothing goes beyond two sentences. No filler replaces what is removed.
    const kept: string[] = [];
    for (const x of passing) {
      const covered = myReadCoverage(kept, top).every((c) => c.sentence !== null);
      if (covered && SPECULATIVE_OPENING.test(x.trim())) { dropped.push({ part, text: x, reason: 'a new speculative reading, not needed to cover a top thesis' }); continue; }
      if (kept.length >= 3 || covered) { dropped.push({ part, text: x, reason: 'beyond the sentences that already cover the top theses (mechanics, not the read)' }); continue; }
      kept.push(x);
    }
    const coversAll = myReadCoverage(kept, top).every((c) => c.sentence !== null);
    if (kept.length && !coversAll) dropped.push({ part, text: kept.join(' '), reason: 'does not read through every top thesis' });
    return coversAll ? kept : [];
  };
  const valid = new Set([...input.facts.map((f) => f.ref), ...top.map((t) => t.id)]);
  const projected = (out?.myRead ?? []).filter((m) => (m.refs ?? []).some((r) => valid.has(r))).flatMap((m) => sentencesOf(m.text));
  const fromProjection = readFrom(projected, 'projection myRead');
  const body = fromProjection.length ? fromProjection : readFrom(sentencesOf(record.founder.myRead), 'myRead (stored)');
  // The business-level line: two or more genuinely different buying motions in the governed model (fixed copy, no name).
  const buyingKinds = new Set(record.businessModel.motions.filter((m) => (m.refs ?? []).length).map((m) => [...m.buying].sort().join('+')).filter(Boolean));
  const opener = body.length && buyingKinds.size >= 2 ? (MORE_THAN_ONE_PATH[input.language.slice(0, 2)] ?? MORE_THAN_ONE_PATH['en']!) : '';
  const myRead = [...(opener ? [opener] : []), ...body].slice(0, 3).join(' ');

  // QUESTIONS: per top thesis the projected wording, else the stored one, without invented thresholds.
  const askable = (q: string): boolean => /\?\s*$/.test(q.trim()) && !presupposesFuture(q) && words(q) <= 45;
  const clean = (q: string, part: string): boolean => {
    const why = !askable(q) ? 'not an askable question' : inventedThreshold(q, source) || (CUSTOMER_ACT_AS_YOURS.test(q) ? 'a customer action written as the founder\'s' : '');
    if (why) dropped.push({ part, text: q, reason: why });
    return !why;
  };
  const questions = record.questions.map((q) => {
    if (!q.resolves) { const why = inventedThreshold(q.question, source); if (why) dropped.push({ part: 'question (stored)', text: q.question, reason: why }); return why ? null : q; }
    const thesis = top.find((t) => t.id === q.resolves);
    const general = (x: string): string => (thesis?.decisions.includes('conversion') ? continuationWording(x, input.language, formsOf(thesis)) : x);
    const p = general(out?.questions.find((x) => x.thesisId === q.resolves)?.question.trim() ?? '');
    if (p && clean(p, `projection question ${q.resolves}`)) return { ...q, question: p };
    return clean(general(q.question), `question ${q.resolves} (stored)`) ? { ...q, question: general(q.question) } : null;
  }).filter((q): q is ThesisQuestion => Boolean(q));

  const tidy = (x: string): string => tidyFounderCopy(x, input.language);
  return {
    ...record,
    founder: { myRead: tidy(myRead), matters: matters.map((m) => ({ ...m, headline: tidy(m.headline), body: tidy(m.body) })) },
    // the current-driver question (tier A) is the fixed, plain one; the thesis questions keep their own wording
    questions: questions.map((q) => (q.tier === 'A' && q.dimension === 'performance' ? { ...q, question: driverQuestion(input.language) } : q)),
    dropped: [...record.dropped, ...dropped],
  };
}

/** MY READ's business-level line when the business has more than one way of being bought (per language). */
const MORE_THAN_ONE_PATH: Record<string, string> = {
  ro: 'Afacerea ta are mai mult de un traseu comercial sub același brand.',
  en: 'Your business has more than one commercial path under one brand.',
  it: 'La tua attività ha più di un percorso commerciale sotto lo stesso marchio.',
  de: 'Dein Unternehmen hat mehr als einen kommerziellen Weg unter einer Marke.',
};
/** The consequence line: which decision areas would change if the relationship is real (fixed copy, per language). */
const CONSEQUENCE: Record<string, (areas: string) => string> = {
  ro: (a) => `Dacă legătura există în practică, asta ar schimba cum gândești ${a}.`,
  en: (a) => `If this link exists in practice, it would change how you think about ${a}.`,
  it: (a) => `Se questo legame esiste davvero, cambierebbe il modo in cui pensi a ${a}.`,
  de: (a) => `Wenn es diesen Zusammenhang in der Praxis gibt, ändert das, wie du über ${a} nachdenkst.`,
};
const AND: Record<string, string> = { ro: 'și', en: 'and', it: 'e', de: 'und' };
export function consequenceLine(decisions: readonly DecisionArea[], language: string, max = 3): string {
  const l = CONSEQUENCE[language.slice(0, 2)] ? language.slice(0, 2) : 'en';
  const labels = [...new Set(decisions.map((d) => AREA_LABEL[l]![d]).filter((x): x is string => Boolean(x)))].slice(0, max);
  if (!labels.length) return '';
  const list = labels.length === 1 ? labels[0]! : `${labels.slice(0, -1).join(', ')} ${AND[l]} ${labels[labels.length - 1]}`;
  return CONSEQUENCE[l]!(list);
}
/** What Business Brain does not know yet, from the thesis's own unknown (first person, per language). */
const UNKNOWN_LEAD: Record<string, string> = { ro: 'Nu știu încă', en: "I don't know yet", it: 'Non so ancora', de: 'Ich weiß noch nicht' };
export function unknownLine(unknown: string, language: string): string {
  const u = unknown.trim().replace(/[.?!]+$/u, '');
  if (!u) return '';
  const lead = UNKNOWN_LEAD[language.slice(0, 2)] ?? UNKNOWN_LEAD['en']!;
  return `${lead}: ${u.charAt(0).toLowerCase()}${u.slice(1)}.`;
}

/**
 * MY READ COVERAGE (2026-10-17): a top thesis is represented only when a MY READ sentence carries its DISTINCTIVE terms
 * (at least two): the words of its own relationship that the other top theses do not share, minus generic business
 * words (studio, path, client, service, offer, package, location…). Shared generic words never count.
 */
/** Five-letter prefixes of generic business words (RO/EN/IT/DE, any inflection): never evidence of a thesis. */
const GENERIC_PREFIX = new Set(['studi', 'trase', 'clien', 'servi', 'ofert', 'abona', 'aface', 'locaț', 'locat', 'busin', 'pentr', 'înain', 'inain', 'custo', 'packa', 'offer', 'journ', 'kunde', 'angeb', 'perco', 'parcu']);
const stemsOf = (t: string): Set<string> => new Set((t.toLowerCase().match(/\p{L}{5,}/gu) ?? []).filter((w) => !GENERIC_PREFIX.has(w.slice(0, 5))).map((w) => w.slice(0, 6)));
export function distinctiveStems(t: StrategicThesis, others: readonly StrategicThesis[]): string[] {
  const text = (x: StrategicThesis): string => `${x.headline} ${x.relationship} ${x.founder?.headline ?? ''}`;
  const other = stemsOf(others.filter((o) => o.id !== t.id).map(text).join(' '));
  return [...stemsOf(text(t))].filter((w) => !other.has(w));
}
/** For each top thesis: the first MY READ sentence that carries ≥ 2 of its distinctive terms, and which terms. */
export function myReadCoverage(sentences: readonly string[], top: readonly StrategicThesis[]): { thesisId: string; distinctive: string[]; sentence: string | null; matched: string[] }[] {
  return top.map((t) => {
    const distinctive = distinctiveStems(t, top);
    for (const x of sentences) {
      const own = stemsOf(x);
      const matched = distinctive.filter((w) => own.has(w));
      if (matched.length >= 2) return { thesisId: t.id, distinctive, sentence: x, matched };
    }
    return { thesisId: t.id, distinctive, sentence: null, matched: [] };
  });
}

/**
 * LIFECYCLE CONSEQUENCE (2026-10-17): continuity between offers matters because the relationship may be kept and grow as
 * the customer's needs change, so a continuity thesis (retention among its decision areas) names retention, expansion,
 * the customer journey and positioning, never acquisition in their place.
 */
const LIFECYCLE_AREAS: readonly DecisionArea[] = ['retention', 'expansion', 'customer_journey', 'positioning'];
export const isLifecycle = (t: Pick<StrategicThesis, 'decisions'>): boolean => t.decisions.includes('retention');
export function thesisConsequence(t: Pick<StrategicThesis, 'decisions'>, language: string): string {
  return isLifecycle(t) ? consequenceLine(LIFECYCLE_AREAS, language, 4) : consequenceLine(t.decisions, language);
}

/** A headline that frames an open step as a fork of two EFFECTS ("gateway or obstacle?", "filter or barrier?"). */
const EFFECT_NOUN = /(?<!\p{L})(poart[ăa]|obstacol\p{L}*|filtr\p{L}*|barier\p{L}*|prag\p{L}*|blocaj\p{L}*|gateway|obstacles?|filters?|barriers?|thresholds?|hurdles?|ostacol\p{L}*|filtro|barriera|h[üu]rde|schranke)(?!\p{L})/iu;
const FORK = /\s(sau|or|o|oder)\s/iu;
const BUYING_PATH: Record<string, (x: string) => string> = {
  ro: (x) => `${x} schimbă parcursul de cumpărare`, en: (x) => `${x} changes the buying path`,
  it: (x) => `${x} cambia il percorso d'acquisto`, de: (x) => `${x} verändert den Kaufweg`,
};
/** The relationship headline: a fork of two effects becomes the relationship it is about (generic, per language). */
export function relationshipHeadline(headline: string, t: Pick<StrategicThesis, 'decisions'>, language: string): string {
  const h = headline.trim();
  const [subject, fork] = h.includes(':') ? [h.slice(0, h.indexOf(':')).trim(), h.slice(h.indexOf(':') + 1)] : ['', h];
  if (!/\?\s*$/.test(h) || !FORK.test(fork) || !EFFECT_NOUN.test(fork) || !subject) return h;
  const l = BUYING_PATH[language.slice(0, 2)] ? language.slice(0, 2) : 'en';
  return t.decisions.includes('conversion') ? BUYING_PATH[l]!(subject) : subject;
}

/**
 * CONTINUATION, NOT ONE PRODUCT (2026-10-17): when the business continues in more than one way (packages, sessions, an
 * ongoing service), asking whether people "buy a subscription" after a step narrows the answer to one product. The
 * question and the unknown ask whether people continue.
 */
const ONE_PRODUCT: Record<string, RegExp> = {
  ro: /cump[ăa]r[ăa]\p{L}* (?:apoi |dup[ăa] aceea )?(?:un |o )?(?:abonament|pachet)\p{L}*(?:\s+(?:dup[ăa]|apoi))?/iu,
  en: /(?:buys?|purchases?|buying|purchasing) (?:then |afterwards )?(?:a |an )?(?:subscription|package|plan)s?(?:\s+(?:after(?:wards)?|then))?/iu,
  it: /(?:compra\p{L}*|acquista\p{L}*) (?:poi )?(?:un |una )?(?:abbonamento|pacchetto)(?:\s+(?:dopo|poi))?/iu,
  de: /(?:kauf\p{L}*) (?:danach )?(?:ein\p{L}* )?(?:abo\p{L}*|paket\p{L}*)(?:\s+(?:danach|dann))?/iu,
};
/** How the business says a relationship continues, from its own continuation forms (generic, per language). */
const FORM_WORDS: Record<string, Partial<Record<string, string>>> = {
  ro: { repeat_purchase: 'ședințe', ongoing_service: 'ședințe', usage: 'ședințe', package: 'un pachet', subscription: 'un abonament' },
  en: { repeat_purchase: 'more sessions', ongoing_service: 'more sessions', usage: 'more sessions', package: 'a package', subscription: 'a subscription' },
  it: { repeat_purchase: 'altre sedute', ongoing_service: 'altre sedute', usage: 'altre sedute', package: 'un pacchetto', subscription: 'un abbonamento' },
  de: { repeat_purchase: 'weiteren Terminen', ongoing_service: 'weiteren Terminen', usage: 'weiteren Terminen', package: 'einem Paket', subscription: 'einem Abo' },
};
const CONTINUE_WITH: Record<string, (x: string) => string> = { ro: (x) => `continuă apoi cu ${x}`, en: (x) => `continue with ${x}`, it: (x) => `continuano con ${x}`, de: (x) => `machen mit ${x} weiter` };
const OR: Record<string, string> = { ro: 'sau', en: 'or', it: 'o', de: 'oder' };
/** `forms`: the continuation forms of the motion this thesis sits in ("package", "ongoing_service"…). */
export function continuationWording(text: string, language: string, forms: readonly string[]): string {
  const l = ONE_PRODUCT[language.slice(0, 2)] ? language.slice(0, 2) : 'en';
  const ORDER = ['repeat_purchase', 'ongoing_service', 'usage', 'package', 'subscription'];
  const words = [...new Set([...forms].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((f) => FORM_WORDS[l]![f]).filter((x): x is string => Boolean(x)))];
  if (words.length < 2) return text; // one way to continue: that product IS the continuation
  return text.replace(ONE_PRODUCT[l]!, CONTINUE_WITH[l]!(`${words.slice(0, -1).join(', ')} ${OR[l]} ${words[words.length - 1]}`));
}

/**
 * FINAL FOUNDER-COPY TIDY (2026-10-17, generic per language):
 *  - no exclusivity the relationship does not need ("a single continuous path" → "a continuous path");
 *  - an unknown asks for a count the founder can give, not a percentage to calculate ("what percentage of" → "how many of");
 *  - the driver question asks which service families bring the most active customers and monthly revenue today.
 */
const SINGLE_PATH = /(?<!\p{L})(un singur|a single|one single|un unico|einen einzigen)\s+(traseu|parcurs|drum|path|journey|route|percorso|weg)(?!\p{L})/giu;
const ARTICLE_OF: Record<string, string> = { 'un singur': 'un', 'a single': 'a', 'one single': 'one', 'un unico': 'un', 'einen einzigen': 'einen' };
const PERCENT_ASK = /(?<!\p{L})(ce procent din|ce proporție din|ce propor[țt]ie din|what (?:percentage|share|proportion) of|che percentuale (?:di|dei|delle)|quale percentuale (?:di|dei|delle)|welche[rn]? anteil (?:der|an)|wie viel prozent der)(?!\p{L})/iu;
const HOW_MANY_OF: Record<string, string> = { ro: 'câți dintre', en: 'how many of', it: 'quanti dei', de: 'wie viele der' };
export function tidyFounderCopy(text: string, language: string): string {
  const l = HOW_MANY_OF[language.slice(0, 2)] ? language.slice(0, 2) : 'en';
  return text
    .replace(SINGLE_PATH, (_m, single: string, noun: string) => `${ARTICLE_OF[single.toLowerCase()] ?? single} ${noun}`)
    .replace(PERCENT_ASK, (m) => (/^[A-ZĂÂÎȘȚ]/u.test(m) ? HOW_MANY_OF[l]!.charAt(0).toUpperCase() + HOW_MANY_OF[l]!.slice(1) : HOW_MANY_OF[l]!));
}
const DRIVER_QUESTION: Record<string, string> = {
  ro: 'Care familii de servicii aduc azi cei mai mulți clienți activi și cel mai mult venit lunar?',
  en: 'Which service families bring the most active customers and the most monthly revenue today?',
  it: 'Quali famiglie di servizi portano oggi più clienti attivi e più fatturato mensile?',
  de: 'Welche Leistungsbereiche bringen heute die meisten aktiven Kunden und den meisten Monatsumsatz?',
};
export const driverQuestion = (language: string): string => DRIVER_QUESTION[language.slice(0, 2)] ?? DRIVER_QUESTION['en']!;
