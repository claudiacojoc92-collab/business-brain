/**
 * LOSSLESS COUNTED FACTS (Result Loop V1, 2026-10-14). Social proof and quantities are checked deterministically, never by
 * a model: a counted fact keeps its SUBJECT, its QUANTITY, its ACTION and its OUTCOME as the founder stated them.
 *
 *   held:  "2 medici confirmați, unul a trimis 3 paciente"
 *          → [2 × medic: confirm]  [1 × medic: trimis, 3 paciente]
 *   ok:    "avem 2 medici confirmați" · "un medic a trimis deja 3 paciente" · "un medic ne-a trimis paciente" (says less)
 *   fails: "2 medici trimit pacienți"     (the action of 1 attached to 2)
 *          "medicii trimit constant"      (the quantity dropped: a generalisation)
 *          "un medic a trimis 5 paciente" (the outcome changed)
 *
 * Generic: number words and clause splitting for en / ro / it / de, a crude 5-letter stem, nothing about one business.
 * Vague quantities ("several doctors") and success claims ("works well") are caught by the evidence-discipline layer.
 */

const NUMBER_WORDS: Record<string, number> = {
  // en
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  // ro
  un: 1, unu: 1, unul: 1, una: 1, o: 1, doi: 2, doua: 2, trei: 3, patru: 4, cinci: 5, sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10,
  // it
  uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
  // de
  ein: 1, eine: 1, einer: 1, eins: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
};
/** Number words that stand alone for "one of them" (the subject is the previous clause's). */
const PRONOUN_NUMBERS = new Set(['one', 'unul', 'una', 'uno', 'einer', 'eine', 'eins']);
/** Words that frame the sender's side ("we have", "I work with") or glue a clause; never an action of the counted subject. */
const FRAME = new Set([
  'avem', 'lucrez', 'lucram', 'colaborez', 'colaboram', 'deja', 'care', 'acum', 'pana', 'there', 'already', 'which', 'with', 'have',
  'work', 'working', 'abbiamo', 'lavoro', 'gia', 'haben', 'arbeite', 'bereits', 'schon', 'dintre', 'among', 'them', 'acestia', 'noastra',
  'nostri', 'nostre', 'nostro', 'nostra',
]);

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const stem = (w: string): string => fold(w).slice(0, 5);
/** An action's key: short enough that send / sent / sends, trimis / trimit meet; compared by prefix (≥ 3 letters). */
const actionKey = (w: string): string => fold(w).slice(0, Math.max(3, Math.min(5, w.length - 1)));
const sameAction = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);
const hasAction = (set: Iterable<string>, a: string): boolean => [...set].some((x) => sameAction(x, a));
const words = (s: string): string[] => fold(s).split(/[^\p{L}\d]+/u).filter(Boolean);
const num = (w: string): number | null => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w] ?? null);

export interface CountedClause {
  readonly quantity: number | null;
  readonly subject: string;
  /** Action / state stems the clause attaches to its subject. */
  readonly actions: Set<string>;
  /** Other counted things in the clause (noun stem → number): the outcome ("3 paciente"). */
  readonly objects: Map<string, number>;
  readonly text: string;
}

const clauses = (s: string): string[] => s.split(/[,;.:!?\n—–]|\s-\s|\s(?:și|si|iar|dar|and|but|while|e|ed|ma|und|aber)\s/i).map((x) => x.trim()).filter(Boolean);

/** The counted clauses of the HELD facts: "<N> <noun> <action…>", or "<one> <action…>" referring back to the last subject. */
export function heldCountedClauses(facts: readonly string[]): CountedClause[] {
  const out: CountedClause[] = [];
  for (const fact of facts) {
    let last: string | null = null;
    for (const c of clauses(fact)) {
      const w = words(c);
      let subject: string | null = null;
      let quantity: number | null = null;
      let subjectAt = -1;
      for (let i = 0; i < w.length; i++) {
        const n = num(w[i]!);
        if (n === null) continue;
        const next = w[i + 1];
        // "one" / "unul" after a counted subject refers back to it ("2 doctors confirmed, one sent 3 patients").
        if (PRONOUN_NUMBERS.has(w[i]!) && last) { subject = last; quantity = n; subjectAt = next && stem(next) === last ? i + 1 : i; break; }
        if (next && num(next) === null && next.length >= 4) { subject = stem(next); quantity = n; subjectAt = i + 1; break; }
      }
      if (!subject) continue;
      last = subject;
      const actions = new Set<string>();
      const objects = new Map<string, number>();
      for (let i = subjectAt + 1; i < w.length; i++) {
        const n = num(w[i]!);
        if (n !== null && w[i + 1] && w[i + 1]!.length >= 4) { objects.set(stem(w[i + 1]!), n); i++; continue; }
        if (w[i]!.length >= 4 && !FRAME.has(w[i]!)) actions.add(actionKey(w[i]!));
      }
      out.push({ quantity, subject, actions, objects, text: c });
    }
  }
  return out;
}

export interface CountedFactFailure { readonly claim: string; readonly detail: string }
export interface CountedClaim { readonly claim: string; readonly ok: boolean; readonly detail: string }

/**
 * Every clause of the message that speaks about a COUNTED subject of the held facts (it carries a number, or one of that
 * subject's held actions) must match one held clause: same subject, same quantity, no action the held clause does not
 * attach to that quantity, and no counted outcome it does not state. Saying less is fine.
 */
export function checkCountedFacts(message: string, facts: readonly string[], context = ''): CountedFactFailure[] {
  return countedClaims(message, facts, context).filter((c) => !c.ok).map(({ claim, detail }) => ({ claim, detail }));
}

/**
 * Every counted claim the message makes about the held facts, matched (ok) or not. `context` = the brief's NON-fact text
 * (offer, place, recipient, sender): its words are neutral in a counted claim ("2 medici confirmați în Cluj").
 */
export function countedClaims(message: string, facts: readonly string[], context = ''): CountedClaim[] {
  const held = heldCountedClauses(facts);
  if (!held.length) return [];
  const neutral = new Set(words(context).filter((x) => x.length >= 4).map(stem));
  const subjects = new Set(held.map((h) => h.subject));
  // Only held ACTIONS mark a counted claim; an outcome noun alone ("patients") does not ("you see patients after surgery").
  const actionsOf = (s: string): Set<string> => new Set(held.filter((h) => h.subject === s).flatMap((h) => [...h.actions]));
  const out: CountedClaim[] = [];
  for (const c of clauses(message)) {
    const w = words(c);
    const at = w.findIndex((x) => subjects.has(stem(x)) && x.length >= 4);
    if (at < 0) continue;
    const subject = stem(w[at]!);
    const prev = at > 0 ? num(w[at - 1]!) : null;
    const prev2 = at > 1 ? num(w[at - 2]!) : null; // "2 medici" / "un singur medic"
    const quantity = prev ?? prev2;
    const known = actionsOf(subject);
    const rest = w.slice(at + 1);
    const objects = new Map<string, number>();
    const objectWords = new Set<number>();
    rest.forEach((x, i) => { const n = num(x); const nx = rest[i + 1]; if (n !== null && nx && nx.length >= 4) { objects.set(stem(nx), n); objectWords.add(i + 1); } });
    const content = rest.filter((x, i) => x.length >= 4 && !FRAME.has(x) && num(x) === null && !objectWords.has(i));
    // With a stated number, EVERY word attached to the counted subject is part of the claim ("2 medici ne recomandă" is a
    // new action for 2), unless it is neutral context. Without a number, only held actions mark it as a counted claim.
    const actions = new Set((quantity !== null ? content.filter((x) => !neutral.has(stem(x))) : content).map(actionKey)
      .filter((s) => quantity !== null || hasAction(known, s)));
    if (quantity === null && !actions.size && !objects.size) continue; // not a counted claim (e.g. "as an orthopaedic doctor")
    const match = held.find((h) => h.subject === subject && h.quantity === quantity
      && [...actions].every((a) => hasAction(h.actions, a) || hasAction(h.objects.keys(), a)) // an outcome without its number says less
      && [...objects].every(([k, v]) => h.objects.get(k) === v));
    if (match) { out.push({ claim: c, ok: true, detail: `matches "${match.text}"` }); continue; }
    const sameQty = held.filter((h) => h.subject === subject && h.quantity === quantity);
    const detail = quantity === null
      ? `"${c}" generalises a counted fact: the founder said ${held.filter((h) => h.subject === subject).map((h) => `"${h.text}"`).join(' and ')}. Keep the exact number.`
      : !sameQty.length
        ? `"${c}": the founder never said ${quantity} of these. She said ${held.filter((h) => h.subject === subject).map((h) => `"${h.text}"`).join(' and ')}.`
        : `"${c}" changes what ${quantity} of them did. The founder said "${sameQty.map((h) => h.text).join('" / "')}".`;
    out.push({ claim: c, ok: false, detail });
  }
  return out;
}
