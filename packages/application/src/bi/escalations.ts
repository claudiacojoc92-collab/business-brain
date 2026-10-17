/**
 * CONSERVATIVE LANGUAGE (2026-10-16): escalations beyond what the founder established. "Brings less" is a fact;
 * "stagnates / is not growing" is not. "Comes from referrals" is a fact; "exclusively / no channel at all" is not. Also
 * "the biggest potential", "in the right place", and magnitude words. A sentence using one is removed unless the
 * founder's OWN words used it. Word-start match, so a term never fires inside a longer unrelated word.
 */
/**
 * ABSOLUTES (2026-10-17): exclusive or unmatched claims ("the only way", "no other channel", "exclusively"). Framing the
 * sentence as a test does not license one ("the only way to test… is…" still ranks every alternative out); only
 * evidence that itself says it does.
 */
export const ABSOLUTES = [
  // exclusivity from an absence of named channels
  'exclusiv', 'numai din', 'only from', 'solely', 'esclusivamente', 'solo da', 'ausschließlich', 'nur aus',
  'niciun canal', 'fără niciun', 'fara niciun', 'no channel', 'nessun canale', 'kein kanal', 'nu există nimeni', 'nu exista nimeni', 'nobody', 'nessuno', 'niemand',
  // "the only way", "no other channel"
  'singurul', 'singura$', 'singurii', 'singurele', 'niciun alt', 'nicio altă', 'nicio alta', 'nimic altceva', 'the only', 'no other', 'nothing else',
  "l'unico", "l'unica", 'nessun altro', 'der einzige', 'die einzige', 'kein anderer',
];
export const ESCALATIONS = [
  // performance direction
  'stagn', 'nu crește', 'nu creste', 'nu mai crește', 'nu mai creste', 'în scădere', 'in scadere', 'declin',
  'not growing', "isn't growing", 'is not growing', 'shrink', 'non cresce', 'in calo', 'ristagn', 'wächst nicht', 'schrumpf',
  ...ABSOLUTES,
  // potential / placement / magnitude
  'cel mai mare potențial', 'cel mai mare potential', 'potențialul cel mai mare', 'highest potential', 'biggest potential', 'most potential',
  'maggior potenziale', 'potenziale più alto', 'größte potenzial', 'unde trebuie', 'locul potrivit', 'right place', 'where it should be',
  'al posto giusto', 'am richtigen ort', 'cel mai mare gap', 'biggest gap', 'enorm', 'masiv', 'uriaș', 'urias', 'huge', 'massive', 'riesig',
  // certainty / intensity the evidence rarely carries (licensed only when the evidence itself uses it)
  'real$', 'reală$', 'reale$', 'reali$', 'complet$', 'completă$', 'completa$', 'complete$', 'completo$', 'vollständig', 'completely', 'entirely', 'totally', 'fundamental', 'radical', 'high-intent', 'high intent', 'clearly', 'clar$',
  // magnitude of an effect nobody measured
  'semnificativ', 'significantly', 'substantially', 'substanțial', 'considerabil', 'considerably', 'dramatic', 'notevolmente', 'erheblich',
  // unsupported superlatives (2026-10-16): a comparison needs evidence that makes it
  'central bottleneck', 'blocajul central', 'blocaj central', 'biggest opportunity', 'cea mai mare oportunitate', 'strongest engine',
  'cel mai puternic motor', 'most profitable', 'cel mai profitabil', 'cea mai profitabil', 'best channel', 'cel mai bun canal', 'collo di bottiglia principale', 'größter engpass',
];
/** A term ending in "$" is a whole word ("complet$" never fires inside "completează"); others match a word start. */
const startsAt = (t: string, rawTerm: string): boolean => {
  const exact = rawTerm.endsWith('$');
  const term = exact ? rawTerm.slice(0, -1) : rawTerm;
  for (let i = t.indexOf(term); i !== -1; i = t.indexOf(term, i + 1)) {
    if ((i === 0 || !/[\p{L}\p{N}]/u.test(t[i - 1]!)) && (!exact || !/[\p{L}\p{N}]/u.test(t[i + term.length] ?? ''))) return true;
  }
  return false;
};
export const escalationsIn = (text: string): string[] => { const t = text.toLowerCase(); return ESCALATIONS.filter((e) => startsAt(t, e)); };

/** Primacy words a FACT sentence may carry only when the governed input itself says so. */
export const PRIMACY = /(?<!\p{L})(principal\p{L}*|main|primary|primar\p{L}*|principale|haupt\p{L}*|cel mai|cea mai|cei mai|cele mai|most|best|biggest|largest|il più|la più|il migliore|la migliore|am meisten|beste\p{L}*)(?!\p{L})/iu;
/** A primacy phrase (the word and the word after it) the evidence does not itself contain. */
export function primacyUnlicensed(sentence: string, source: string): boolean {
  const src = source.toLowerCase();
  const re = new RegExp(`${PRIMACY.source}\\s+(\\p{L}+)`, 'giu');
  // "the most VISIBLE …" describes what the offer shows (observable), not a primacy claim about the business.
  for (const m of sentence.matchAll(re)) if (!/^(vizibil\p{L}*|visible|evident\p{L}*|sichtbar\p{L}*)$/iu.test(m[2]!) && !src.includes(`${m[1]!.toLowerCase()} ${m[2]!.toLowerCase()}`)) return true;
  return PRIMACY.test(sentence) && ![...sentence.matchAll(re)].length && !PRIMACY.test(source);
}

const STEM_STOP = new Set(['client', 'servic', 'busine', 'pentru', 'acest', 'aceast', 'despre', 'which', 'their', 'there', 'about', 'other', 'founder', 'fondat', 'strate', 'decizi', 'decisi']);
/** Shared substance between two texts: distinct 6-letter stems of words with ≥ 5 letters (inflections match). */
export function stemOverlap(a: string, b: string): number {
  const stems = (t: string) => new Set((t.toLowerCase().match(/\p{L}{5,}/gu) ?? []).map((w) => w.slice(0, 6)).filter((w) => !STEM_STOP.has(w)));
  const A = stems(a); const B = stems(b);
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n;
}
