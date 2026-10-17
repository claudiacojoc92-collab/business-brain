import { businessEntities, claimTermsIn, escalationsIn, primacyUnlicensed, presupposesFuture, sameInsight, ungroundedInference, type GovernedUnderstanding, type ModelDimension } from '../bi/index';

/**
 * STRATEGIC THESES (2026-10-16). Understanding is a strategic model of how the business works, not a summary.
 *
 *   governed understanding (facts, model, synthesis, hypotheses)
 *   → ONE model call: a generic business-model sketch + 4–8 candidate theses + founder-facing copy
 *   → ELIGIBILITY (code): grounding is a gate, never a score
 *   → RANKING (code): decision leverage > consequence > non-obviousness > cross-dimension > specificity >
 *     reversibility > grounding (tie-breaker); an observation-only thesis can never be top-ranked
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
  readonly score?: readonly number[];  // lexicographic: leverage, consequence, nonObvious, crossDim, specificity, reversibility, −priority, grounding
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
const READING = /(?<!\p{L})(sugereaz\p{L}*|pare|par|citirea mea|interpretarea mea|cred c[ăa]|suggest\p{L}*|seems?|appears?|my reading|i read|reading is|suggerisc\p{L}*|sembra|la mia lettura|deutet|scheint|meine lesart|probabil|likely|may|might|poate|ar putea|dac[ăa]|if)(?!\p{L})/iu;
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
function score(t: Omit<StrategicThesis, 'score' | 'rank'>, input: ThesisInput, entities: string[], others: Omit<StrategicThesis, 'score' | 'rank'>[]): number[] {
  const decisions = [...new Set(t.decisions.filter((d) => DECISION_AREAS.includes(d)))];
  const leverage = Math.min(3, decisions.filter((d) => HIGH_LEVERAGE.has(d)).length + (t.ifTrue.trim() ? 1 : 0));
  const consequence = Math.min(3, decisions.length);
  const text = `${t.relationship} ${t.implication}`;
  const overlap = Math.max(0, ...input.facts.map((f) => { const c = coveredBy(text, f.text); return c >= 0.6 ? 2 : c >= 0.4 ? 1 : 0; }), ...others.filter((o) => o.id !== t.id).map((o) => (sameInsight(text, `${o.relationship} ${o.implication}`, 0.6) ? 1 : 0)));
  const nonObvious = 2 - overlap;
  const crossDim = Math.min(3, new Set(t.dimensions).size);
  const specificity = Math.min(2, entities.filter((e) => e.length >= 3 && text.toLowerCase().includes(e.toLowerCase())).length);
  const reversibility = t.weakenedBy.trim() && t.unknown.trim() ? 1 : 0;
  const grounding = Math.min(4, t.facts.length);
  return [leverage, consequence, nonObvious, crossDim, specificity, reversibility, -Math.max(1, t.priority || 9), grounding];
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
  const entities = businessEntities(u);

  // 1. Eligibility (a gate), then the canonical ranking among the eligible.
  const raw = (out.theses ?? []).slice(0, 10).map((t, i) => ({ ...t, id: `T${i + 1}`, facts: [...new Set((t.facts ?? []).filter((r) => valid.has(r)))], decisions: (t.decisions ?? []).filter((d) => DECISION_AREAS.includes(d)), dimensions: t.dimensions ?? [] }));
  const judged = raw.map((t) => ({ ...t, eligibility: eligibility(t, input, internal) }));
  for (const t of judged) if (!t.eligibility.pass) dropped.push({ part: `thesis ${t.id}`, text: t.headline, reason: t.eligibility.reasons.join('; ') });
  const eligible = judged.filter((t) => t.eligibility.pass);
  const scored = eligible.map((t) => ({ ...t, score: score(t, input, entities, eligible) }));
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
