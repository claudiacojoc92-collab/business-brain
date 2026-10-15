import type { PageObservation } from './contracts';
import { anchorClaimEvidence } from './evidence-anchor';

/**
 * NUMERIC GROUNDING (2026-10-15). Every number BB shows about the business must be either
 *  A. a SOURCE NUMBER: present in a verbatim quote from a trusted source, tied to the SAME entity (offer, package,
 *     location) and, when given, the same qualifier (package size, duration, tier) — the value must be the first number
 *     after the qualifier in that quote, and no other known entity may stand between the entity and the value; or
 *  B. a DERIVED NUMBER: the recomputed result of an explicit calculation on grounded numbers.
 * A number merely "somewhere on the page" proves nothing: "600 lei" next to "Abon. 8" is not the price of 12 sessions.
 * Deterministic. Generic: no business vocabulary beyond what the synthesis itself names.
 */

export interface NumberClaim {
  /** The number as it appears in the source (e.g. 500). */
  readonly value: number | string;
  /** What it belongs to, as named in the source (an offer, a package, a location). */
  readonly entity: string;
  /** The package / duration / tier marker exactly as written before the number (e.g. "Abon. 12"). Optional. */
  readonly qualifier?: string;
  readonly ref: string;
  /** One line or sentence copied verbatim from that source, containing the entity, the qualifier and the value. */
  readonly quote: string;
}
export type CalcOperation = 'divide' | 'multiply' | 'add' | 'subtract' | 'percent_less' | 'percent_more';
export const CALC_OPERATIONS: readonly CalcOperation[] = ['divide', 'multiply', 'add', 'subtract', 'percent_less', 'percent_more'];
/** An explicit calculation: percent_less = (1 − a/b)·100 (a discount of a against b); percent_more = (a/b − 1)·100. */
export interface Calculation { readonly operation: CalcOperation; readonly operands: (number | string)[]; readonly result: number | string }

export interface NumericGroundingResult {
  readonly ok: boolean;
  readonly problems: string[];
  /** Grounded source numbers and checked calculations (for the audit trail). */
  readonly grounded: { value: number; entity: string; qualifier: string | null; ref: string }[];
  readonly calculations: { operation: CalcOperation; operands: number[]; result: number; ok: boolean }[];
}

const fold = (s: string): string => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Numbers written in text: "41,7" / "41.7" decimals, "1.080" thousands, "54%". A space never joins two numbers
 *  ("Abon. 12 500 lei" is 12 and 500, as price lists write it). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of (text ?? '').matchAll(/(?<![\p{L}\d])(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)(?![\p{L}\d])/gu)) {
    const raw = m[1]!;
    const thousands = /^\d{1,3}(?:\.\d{3})+$/.test(raw);
    out.push(thousands ? Number(raw.replace(/\./g, '')) : Number(raw.replace(',', '.')));
  }
  return out.filter((n) => Number.isFinite(n));
}
const num = (v: number | string): number => (typeof v === 'number' ? v : numbersIn(String(v))[0] ?? NaN);
const close = (a: number, b: number, abs: number): boolean => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * 0.01);

function compute(op: CalcOperation, [a, b]: number[]): number {
  switch (op) {
    case 'divide': return a! / b!;
    case 'multiply': return a! * b!;
    case 'add': return a! + b!;
    case 'subtract': return a! - b!;
    case 'percent_less': return (1 - a! / b!) * 100;
    case 'percent_more': return (a! / b! - 1) * 100;
  }
}

/** Positions of a number token in a text (index of each occurrence, by token value). */
function numberTokens(text: string): { value: number; index: number }[] {
  const out: { value: number; index: number }[] = [];
  for (const m of (text ?? '').matchAll(/(?<![\p{L}\d])(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)(?![\p{L}\d])/gu)) {
    const raw = m[1]!;
    const thousands = /^\d{1,3}(?:\.\d{3})+$/.test(raw);
    out.push({ value: thousands ? Number(raw.replace(/\./g, '')) : Number(raw.replace(',', '.')), index: m.index! });
  }
  return out;
}

/**
 * Check one claim's numbers. `texts` = every string shown (the finding, why it matters, the implication); `entities` =
 * the business's named entities (offers, packages, locations) used to detect a number borrowed from a neighbour.
 */
export function groundNumbers(
  texts: string[],
  claims: readonly NumberClaim[] | undefined,
  calcs: readonly Calculation[] | undefined,
  observations: readonly PageObservation[],
  entities: readonly string[],
  trusted: (ref: string) => boolean,
): NumericGroundingResult {
  const problems: string[] = [];
  const grounded: NumericGroundingResult['grounded'] = [];
  const qualifierNumbers: { n: number; claimValue: number }[] = [];
  const vocab = [...new Set([...entities, ...(claims ?? []).map((c) => c.entity)].map((e) => (e ?? '').trim()).filter((e) => e.length >= 3))];

  for (const c of claims ?? []) {
    const value = num(c.value);
    const quote = (c.quote ?? '').trim();
    const entity = (c.entity ?? '').trim();
    const qualifier = (c.qualifier ?? '').trim();
    if (!Number.isFinite(value) || !quote || !entity) { problems.push(`number ${c.value}: missing value, entity or quote`); continue; }
    if (!trusted(c.ref)) { problems.push(`number ${value}: its source is not trusted`); continue; }
    if (!anchorClaimEvidence([{ ref: c.ref, quote }], observations).length) { problems.push(`number ${value}: the quote is not on the cited page`); continue; }
    if (!numberTokens(quote).some((t) => close(t.value, value, 0.001))) { problems.push(`number ${value}: it is not in its quote`); continue; }
    // The association is checked on the PAGE, not on the model's word: within this entity's section (from its name to
    // the next named entity), the value must be the first number after the qualifier (or appear, without one).
    const page = observations.find((o) => o.ref === c.ref || fold(o.ref) === fold(c.ref));
    const why = page ? associate(page.text, entity, qualifier, value, vocab) : 'the cited page was not read';
    if (why) { problems.push(`number ${value}: ${why}`); continue; }
    if (qualifier) for (const n of numbersIn(qualifier)) qualifierNumbers.push({ n, claimValue: value });
    grounded.push({ value, entity, qualifier: qualifier || null, ref: c.ref });
  }

  const groundedValues = grounded.map((g) => g.value);
  const operandPool = [...groundedValues, ...qualifierNumbers.map((q) => q.n)];
  const checked: NumericGroundingResult['calculations'] = [];
  for (const k of calcs ?? []) {
    const operands = (k.operands ?? []).map(num);
    const result = num(k.result);
    if (!CALC_OPERATIONS.includes(k.operation) || operands.length !== 2 || operands.some((o) => !Number.isFinite(o)) || !Number.isFinite(result)) {
      problems.push('a calculation is incomplete'); continue;
    }
    const ungrounded = operands.filter((o) => !operandPool.some((p) => close(p, o, 0.001)));
    const computed = compute(k.operation, operands);
    const ok = !ungrounded.length && close(computed, result, k.operation.startsWith('percent') ? 1 : 0.06);
    if (ungrounded.length) problems.push(`calculation ${k.operation}(${operands.join(', ')}): ${ungrounded.join(', ')} not grounded`);
    else if (!ok) problems.push(`calculation ${k.operation}(${operands.join(', ')}) = ${computed.toFixed(2)}, not ${result}`);
    checked.push({ operation: k.operation, operands, result, ok });
  }
  const results = checked.filter((c) => c.ok).map((c) => c.result);

  // Every number shown must be a grounded value, a qualifier number of a grounded claim, or a checked result.
  for (const text of texts) {
    for (const sentence of (text ?? '').split(/(?<=[.!?;])\s+/)) {
      const shown = numbersIn(sentence);
      for (const n of shown) {
        const isValue = groundedValues.some((v) => close(v, n, 0.001));
        const isResult = results.some((r) => close(r, n, Math.abs(r) < 100 ? 1 : 0.06)) || checked.some((c) => c.ok && c.operands.some((o) => close(o, n, 0.001)));
        const asQualifier = qualifierNumbers.filter((q) => close(q.n, n, 0.001));
        if (isValue || isResult) continue;
        // A package size / duration is shown only next to ITS OWN value (same sentence): "12 sessions … 600" is wrong
        // when 600 belongs to the 8-session package.
        if (asQualifier.some((q) => shown.some((s) => close(s, q.claimValue, 0.001)))) continue;
        problems.push(asQualifier.length ? `${n} is shown without the value it belongs to` : `${n} is not grounded in the sources`);
      }
    }
  }
  return { ok: problems.length === 0, problems, grounded, calculations: checked };
}

/**
 * COUNT GROUNDING (2026-10-15): a count shown to the founder ("10 of the 28 classes", "four therapists") is grounded only
 * when every counted item is listed, each item is a verbatim span of a trusted page, the same line is not counted more
 * often than it occurs on its page, and the list length IS the value. Code recounts; the model's number is not trusted.
 */
export interface CountGroundingResult { readonly ok: boolean; readonly problems: string[]; readonly values: number[] }
export function groundCounts(
  counts: readonly { value: number | string; of: string; items: { ref: string; quote: string }[] }[] | undefined,
  observations: readonly PageObservation[],
  trusted: (ref: string) => boolean,
): CountGroundingResult {
  const problems: string[] = [];
  const values: number[] = [];
  const squash = (s: string): string => fold(s).replace(/\s+/g, ' ').trim();
  for (const c of counts ?? []) {
    const value = num(c.value);
    const items = Array.isArray(c.items) ? c.items : [];
    if (!Number.isFinite(value) || value < 1) { problems.push(`count of ${c.of}: no value`); continue; }
    if (items.length !== value) { problems.push(`count of ${c.of}: ${value} claimed, ${items.length} listed`); continue; }
    const uses = new Map<string, { page: string; times: number }>();
    let bad = '';
    for (const it of items) {
      if (!trusted(it?.ref ?? '')) { bad = 'an item rests on an untrusted source'; break; }
      const anchored = anchorClaimEvidence([it], observations)[0];
      if (!anchored) { bad = `"${(it?.quote ?? '').slice(0, 40)}" is not on its page`; break; }
      const page = observations.find((o) => o.ref === anchored.ref);
      const key = `${anchored.ref}\u0000${squash(anchored.quote)}`;
      const u = uses.get(key) ?? { page: squash(page?.text ?? ''), times: 0 };
      u.times++;
      uses.set(key, u);
    }
    if (!bad) {
      for (const [key, u] of uses) {
        const q = key.split('\u0000')[1]!;
        let n = 0;
        for (let at = u.page.indexOf(q); at !== -1; at = u.page.indexOf(q, at + q.length)) n++;
        if (n < u.times) { bad = `"${q.slice(0, 40)}" is counted ${u.times} times but appears ${n}`; break; }
      }
    }
    if (bad) { problems.push(`count of ${c.of}: ${bad}`); continue; }
    values.push(value);
  }
  return { ok: problems.length === 0, problems, values };
}

/**
 * Null when `value` belongs to `entity` (and `qualifier`) on the page; else why not. An entity's section runs from an
 * occurrence of its name to the next occurrence of any OTHER named entity; inside it, the value must be the first number
 * after the qualifier (or, without a qualifier, present). Any occurrence of the entity may carry it.
 */
function associate(text: string, entity: string, qualifier: string, value: number, vocab: string[]): string | null {
  const f = fold(text);
  const fe = fold(entity);
  const others = vocab.map(fold).filter((e) => e !== fe && !fe.includes(e) && !e.includes(fe));
  const tokens = numberTokens(text);
  let seen = false;
  for (let at = f.indexOf(fe); at !== -1; at = f.indexOf(fe, at + 1)) {
    seen = true;
    const from = at + fe.length;
    const nextOther = Math.min(...others.map((e) => { const i = f.indexOf(e, from); return i === -1 ? Infinity : i; }), text.length);
    if (qualifier) {
      const fq = fold(qualifier);
      for (let q = f.indexOf(fq, from); q !== -1 && q < nextOther; q = f.indexOf(fq, q + 1)) {
        const after = tokens.find((t) => t.index >= q + fq.length);
        if (after && after.index < nextOther && close(after.value, value, 0.001)) return null;
      }
    } else if (tokens.some((t) => t.index > from && t.index < nextOther && close(t.value, value, 0.001))) return null;
  }
  return seen ? `on the page, ${value} is not ${qualifier ? `the number after "${qualifier}" ` : ''}in the section of "${entity}"` : `"${entity}" is not on the cited page`;
}
