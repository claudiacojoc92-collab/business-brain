/**
 * Text gates for founder-facing understanding lines. No imports, so both the contracts (agendaUnknowns) and the
 * validation/projection layers can use them without a cycle.
 */

/**
 * Website HOUSEKEEPING, not business insight: legal pages (their dates, versions, wording) and ANY critique of a
 * quoted phrase or of the site's wording (what a phrase means, implies, signals or frames; that nothing in the
 * sources supports, develops or explains it; a phrase hinting at future scope). Dropped deterministically from every
 * founder-facing understanding field, because the prompt alone did not keep them out.
 */
const LEGAL_PAGE = /\b(privacy policy|terms of service|terms and conditions|data deletion|cookie policy|legal (page|document)s?|last[- ]updated)\b/i;
const Q = `['"\\u2018\\u201c\\u201e][^'"\\u2019\\u201d]{3,120}['"\\u2019\\u201d]`;
// A quoted phrase that is the SUBJECT of a reading ("'X' signals / frames / implies …").
const QUOTED_PHRASE_READ = new RegExp(`${Q}\\s*,?\\s*(?:\\w+\\s+){0,3}(signals|signall?ing|frames|framing|impl(?:y|ies|ying|ied)|hints?|hinting|suggests?|suggesting|reads as|sounds|positions?)\\b`, 'i');
// A quoted phrase that "nothing explains" ("'X' … no page names / describes / defines …").
const QUOTED_PHRASE_UNEXPLAINED = new RegExp(`${Q}[^.]{0,100}\\b(no|nothing|nowhere|never)\\b[^.]{0,40}\\b(names?|describes?|explains?|defines?|elaborates?|says|specif\\w*|supports?|develops?|backs?)\\b`, 'i');
// What a quoted phrase "means" ("What does 'X' mean", "'X' means in practice").
const QUOTED_PHRASE_MEANING = new RegExp(`(\\bwhat\\b[^.?]{0,40}${Q}[^.?]{0,40}\\b(mean|looks? like)|${Q}[^.?]{0,30}\\b(means?|looks? like)\\b[^.?]{0,20}\\bin practice)`, 'i');
// The wording itself as the object ("the phrase 'X'", "this framing", "the tagline").
// (Not "word"/"term": "on your word", "long term" are ordinary prose.)
const WORDING_AS_OBJECT = /\b(the|this|that|its|your)\s+(phrase|phrasing|wording|tagline|slogan|framing|turn of phrase|choice of words)\b/i;
// "Nothing in the sources supports / develops this framing / claim / idea."
const UNSUPPORTED_FRAMING = /\b(nothing|no (page|post|source)s?|none of the (pages|posts|sources))\b[^.]{0,40}\b(supports?|develops?|backs? up|explains?|elaborates?)\b[^.]{0,30}\b(framing|phrase|wording|claim|idea|line|promise)\b/i;
// A phrase read as hinting at future scope / a roadmap ("implies future areas", "suggests expansion beyond …").
const FUTURE_SCOPE = /\b(impl\w+|hint\w*|suggest\w*|signal\w*|fram\w+)\b[^.]{0,60}\b(future|roadmap|expansion|expand|beyond (marketing|this|that|the current)|other (areas|domains|verticals))\b/i;
const OTHER_AREA = /\b(second|next|other|future)\s+(area|domain|vertical)s?\b/i;

export function isHousekeeping(text: string): boolean {
  return [LEGAL_PAGE, QUOTED_PHRASE_READ, QUOTED_PHRASE_UNEXPLAINED, QUOTED_PHRASE_MEANING, WORDING_AS_OBJECT, UNSUPPORTED_FRAMING, FUTURE_SCOPE, OTHER_AREA]
    .some((re) => re.test(text));
}

/**
 * "Something is not shown / demonstrated / exemplified" — the capability gap's point. Used to drop a secondary item
 * that restates it (e.g. the same gap told about one channel) when the capability gap is already the primary.
 */
const NOT_SHOWN = /\b(no|never|not|zero|none|without|neither|nor)\b[^.]{0,60}\b(show|shows|shown|showing|demonstrat\w*|example|examples|evidence|sample|samples|instance|output)\b/i;
const SHOWS_NOTHING = /\b(show|shows|shown|showing|demonstrates?)\s+(nothing|no|none)\b/i;
const NO_CONTENT_ABOUT = /\b(no|zero|nothing|none)\b[^.]{0,30}\b(content|posts?|mention\w*)\b[^.]{0,20}\babout\b/i;
export function restatesNotShown(text: string): boolean {
  return NOT_SHOWN.test(text) || SHOWS_NOTHING.test(text) || NO_CONTENT_ABOUT.test(text);
}

const STOP = new Set(['about', 'after', 'again', 'also', 'because', 'being', 'business', 'does', 'doesn', 'every', 'from', 'have', 'into',
  'just', 'more', 'nothing', 'only', 'other', 'over', 'same', 'show', 'shows', 'shown', 'site', 'some', 'sources', 'than', 'that',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'what', 'when', 'where', 'which', 'while', 'with', 'without', 'your',
  'yours', 'means', 'never', 'posts', 'page', 'pages', 'anywhere', 'single', 'cannot', 'can’t', 'can\'t', 'don\'t', 'don’t']);
// Light stemming so "outputs"/"output" and "connecting"/"connected" count as one word.
const stem = (w: string): string => { for (const suf of ['ing', 'ed', 'es', 's']) if (w.length > 5 && w.endsWith(suf)) return w.slice(0, -suf.length); return w; };
const words = (s: string): Set<string> => new Set((s.toLowerCase().match(/[\p{L}\p{N}']{4,}/gu) ?? []).filter((w) => !STOP.has(w)).map(stem));

/**
 * Two lines make the SAME point when enough of the shorter one's content words appear in the other (overlap
 * coefficient). Used to keep one slot per insight: "What stood out" items are 3-4 DIFFERENT tensions, and a question
 * never restates an observation that is already shown. Calibrated on the 2026-10-09 dogfood runs: the same gap told
 * twice overlapped 0.50-0.76, different dimensions 0.00-0.22.
 */
export function sameInsight(a: string, b: string, threshold = 0.45): boolean {
  const A = words(a); const B = words(b);
  const n = Math.min(A.size, B.size);
  if (n < 3) return false;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / n >= threshold;
}

/** The first sentence, so a summary line stays one line (the model sometimes writes a paragraph). */
export function firstSentence(s: string): string {
  const t = (s ?? '').trim();
  const m = t.match(/^.+?[.!?](?=\s+[\p{Lu}"“„'‘(]|$)/u);
  return (m ? m[0] : t).trim();
}
