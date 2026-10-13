/**
 * ONE voice for everything Business Brain writes to a founder (operator, 2026-10-12: "one rule set across every
 * surface, not just some"). Two halves, used together everywhere:
 *   - VOICE_RULES: the prompt block every founder-facing model call carries (understanding, conversation, correction
 *     reply, mirror, strategy, week, email, Talk). Case-free examples only — never a real business in a prompt.
 *   - spoken(): the deterministic backstop for what code can fix without changing meaning:
 *       · no dashes: an em/en dash between words becomes a comma, or a colon when it introduces a list
 *         ("intervene — commands that fail, values that live…" → "intervene: commands that fail, values…"),
 *       · bullets stay bullets ("- item" lines are never collapsed),
 *       · a placeholder is one short phrase: "[specific date — to be confirmed by Friday]" → "[specific date]",
 *       · manager verbs become plain ones (identify → find, ensure → make sure, align on → go over, leverage → use),
 *       · text inside quotation marks is never touched: a quote of the founder's own words or of their site stays exact,
 *       · doubled punctuation from joined fragments is collapsed: ".;" → ";", ".." → ".", ",." → "." (an ellipsis stays),
 *       · a common opening word right after a semicolon is lowercased ("; No named" → "; no named"); names never are.
 * spoken() is for BB-AUTHORED text only. Founder words (a goal candidate, a mirror's "you said") are never rewritten.
 */
const AND: Record<string, string> = { en: 'and', ro: 'și', it: 'e' };

export const VOICE_RULES = [
  'VOICE — the same rules for everything you write to this founder:',
  '- THE COFFEE TEST: write what a sharp friend would say out loud over coffee, not what a consultant puts in a deck.',
  '- Second person, active voice: "you", "we". "We close every gap before we hand it over", never "each gap gets closed".',
  '- Verbs, not nouns: "get the booking page live", not "booking page readiness".',
  '- Plain verbs: find, pick, write, send, call, fix. Never identify, ensure, align, leverage, utilize, facilitate,',
  '  streamline, optimize.',
  '- No consultant words: perimeter, stakeholders, alignment, deliverables, critical path, de-risk, value proposition,',
  '  go-to-market, actionable, discrete item.',
  '- People act, things do not: a buyer reads, decides, signs. A report or "credibility" does not "move" anyone.',
  '- NO DASHES: never the em-dash "—", the en-dash "–", or a hyphen used as a dash. Join clauses with a period or a',
  '  comma; introduce a list with a colon. No "+", "/", "&" or "·" as joiners.',
  '- Never cut a sentence short with "…". Write a shorter sentence instead.',
].join('\n');

/** Split into [outside, inside-quotes, outside, …] so cleanup never rewrites quoted words. */
const QUOTED = /("[^"\n]*"|“[^”\n]*”|„[^“”\n]*[“”]|«[^»\n]*»)/g;
const outsideQuotes = (s: string, fn: (part: string) => string): string =>
  (s ?? '').split(QUOTED).map((part, i) => (i % 2 === 1 ? part : fn(part))).join('');

function dashLine(rest: string): string {
  return rest
    .replace(/[ \t]+[—–][ \t]+(?=[\])])/g, '')                          // dash right before a closing bracket
    // a dash that introduces a list (2+ commas before the sentence ends) → colon
    .replace(/[ \t]*[—–][ \t]*(?=[^.!?—–]*,[^.!?—–]*,)/g, ': ')
    .replace(/[ \t]*[—–][ \t]*/g, ', ')                                // any other em/en dash → comma
    .replace(/[ \t]+-[ \t]+/g, ', ')                                             // a spaced hyphen used as a dash
    .replace(/([,:])[ \t]*[,:]/g, '$1')
    .replace(/[,:][ \t]*([.!?;])/g, '$1');
}

export function withoutDashes(s: string): string {
  // Within a line only: a dash that STARTS a line is a bullet and stays.
  return (s ?? '').split('\n').map((line) => {
    const bullet = line.match(/^(\s*[-—–•*]\s+)/)?.[1] ?? '';
    const rest = outsideQuotes(line.slice(bullet.length), dashLine);
    return bullet ? `${bullet.replace(/[—–]/, '-')}${rest}` : rest;
  }).join('\n');
}

export function simplePlaceholders(s: string): string {
  // Only bracketed slots with an explanation tucked inside ("[date, to be confirmed by…]") are cut to their first phrase.
  return (s ?? '').replace(/\[([^\]\n]{1,400})\]/g, (whole, inner: string) => {
    const head = inner.split(/\s*(?:,|;|—|–|\s-\s|\(|\bto be\b|\btbc\b|\btbd\b|\be\.g\.)\s*/i)[0]!.trim();
    return head && head.length < inner.trim().length ? `[${head}]` : whole;
  });
}

const VERBS: [RegExp, string][] = [
  [/\bidentifying\b/g, 'finding'], [/\bIdentifying\b/g, 'Finding'], [/\bidentified\b/g, 'found'], [/\bIdentified\b/g, 'Found'],
  [/\bidentify\b/g, 'find'], [/\bIdentify\b/g, 'Find'],
  [/\bensuring\b/g, 'making sure'], [/\bEnsuring\b/g, 'Making sure'], [/\bensures\b/g, 'makes sure'], [/\bensured\b/g, 'made sure'],
  [/\bensure\b/g, 'make sure'], [/\bEnsure\b/g, 'Make sure'],
  [/\balign on\b/g, 'go over'], [/\bAlign on\b/g, 'Go over'], [/\balign with\b/g, 'agree with'], [/\bAlign with\b/g, 'Agree with'],
  [/\bleverage\b/g, 'use'], [/\bLeverage\b/g, 'Use'], [/\butilize\b/g, 'use'], [/\bUtilize\b/g, 'Use'],
];
export function plainVerbs(s: string): string {
  return outsideQuotes(s, (part) => VERBS.reduce((acc, [re, rep]) => acc.replace(re, rep), part));
}

export function plainSubject(s: string, language: string): string {
  return plainVerbs(withoutDashes((s ?? '').replace(/\s*\+\s*/g, ` ${AND[language] ?? 'and'} `))).replace(/\s{2,}/g, ' ').trim();
}

/** Common words a clause opens with (EN/RO/IT). After a semicolon only these are lowercased: a name stays as written. */
const OPENERS = new Set(('a an the no none not this that these those there it its each every all any some one two three our your ' +
  'their they we you he she his her nothing only most many few both neither either but and or so yet ' +
  'un o nu niciun nicio cele cei acest această aceste există il lo la le gli uno una non nessun nessuna questo questa').split(' '));
export function lowerAfterSemicolon(s: string): string {
  return (s ?? '').replace(/;([ \t]+)(\p{Lu}\p{Ll}*)(?=[\s,.;:!?)]|$)/gu, (whole, sp: string, w: string) =>
    (OPENERS.has(w.toLowerCase()) ? `;${sp}${w.toLowerCase()}` : whole));
}

/** Collapse punctuation doubled where fragments were joined ("actuals.; ", "happened..", "too,."). "..." stays. */
export function tidyPunctuation(s: string): string {
  return (s ?? '')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')                        // ".." → "." (never an ellipsis)
    .replace(/[.,]+[ \t]*;/g, ';')                                // ".;" ",;" → ";"
    .replace(/[,;:]+[ \t]*\./g, '.')                              // ",." ";." ":." → "."
    .replace(/\.[ \t]*,/g, ',');                                  // ".," → ","
}

/** BB-authored text: placeholders first (so their inner dash is cut, not turned into a comma), then dashes, then verbs. */
export function spoken(s: string): string {
  return lowerAfterSemicolon(tidyPunctuation(plainVerbs(withoutDashes(simplePlaceholders(s)))));
}
