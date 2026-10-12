import type { ArcEmail } from './contracts';

/**
 * The email must not say a date is CONFIRMED when the founder never said so (operator, 2026-10-12: "We have a confirmed
 * testnet date of [date]" on a business that has none; a bank finding out costs the founder their credibility). A
 * placeholder date is the founder's to fill, so it is a TARGET or a promise to confirm, never a fact. Only PRESENT
 * claims count: "once the date is confirmed" or "we will send the final date" are promises, not claims. Detected
 * claims trigger ONE repair pass (ArcService.draftEmail); `softenUnbackedClaims` is the last resort.
 */
const D = String.raw`(?:[\p{L}-]+\s+){0,2}date`; // "date", "testnet date", "pilot start date"
const HAVE = new RegExp(String.raw`\b(?:we|you)\s+(?:now\s+)?(?:have|'ve got|have got)\s+(?:a|the|our)\s+(?:confirmed|firm|fixed|locked(?:-in)?|final)\s+${D}\b`, 'iu');
const CONFIRMED_OF = new RegExp(String.raw`\b(?:a|the|our)\s+confirmed\s+${D}\s+(?:of|is|:)`, 'iu');
const WE_HAVE_A_DATE = /\bwe(?:\s+now)?\s+have\s+a\s+date\b/iu;
const IS_CONFIRMED = new RegExp(String.raw`\b${D}\s+(?:is|has been)\s+(?:now\s+)?(?:confirmed|set|locked(?:\s+in)?|fixed)\b`, 'iu');
// "once / when / the moment … the date is confirmed" is a promise, not a claim: checked over the whole clause.
const CONDITIONAL = /\b(?:once|when|until|as soon as|after|before|if|whether|the moment|by the time)\b/iu;
const clauseOf = (all: string, start: number, end: number): string => (all.slice(Math.max(0, start - 60), end).split(/[.!?\n;]/).pop() ?? '');

function claimsIn(text: string): string[] {
  const out: string[] = [];
  for (const re of [HAVE, CONFIRMED_OF, WE_HAVE_A_DATE]) { const m = text.match(re); if (m) out.push(m[0]); }
  const g = new RegExp(IS_CONFIRMED.source, 'giu');
  for (let m = g.exec(text); m; m = g.exec(text)) {
    if (!CONDITIONAL.test(clauseOf(text, m.index, m.index + m[0].length))) out.push(m[0]);
  }
  return out;
}

/** "Confirmed" is licensed only when the founder's own context says something is confirmed. */
export function unbackedClaims(email: ArcEmail, founderContext: readonly string[]): string[] {
  if (/\bconfirm(?:ed)?\b/i.test(founderContext.join('\n'))) return [];
  return claimsIn(`${email.subject}\n${email.body}`);
}

/** Last resort, for the claim shapes only: a confirmed date becomes a target date. Promises are left untouched. */
export function softenUnbackedClaims(email: ArcEmail): ArcEmail {
  const fix = (s: string): string => s
    .replace(new RegExp(String.raw`\b(we|you)(\s+(?:now\s+)?(?:have|'ve got|have got)\s+(?:a|the|our)\s+)(?:confirmed|firm|fixed|locked(?:-in)?|final)(\s+${D})\b`, 'giu'), '$1$2target$3')
    .replace(new RegExp(String.raw`\b(a|the|our)\s+confirmed(\s+${D}\s+(?:of|is|:))`, 'giu'), '$1 target$2')
    .replace(/\b(w)e(\s+now)?\s+have\s+a\s+date\b/giu, '$1e are targeting a date')
    .replace(new RegExp(String.raw`\b(${D})\s+(is|has been)\s+(?:now\s+)?(?:confirmed|set|locked(?:\s+in)?|fixed)\b`, 'giu'), (whole, d: string, verb: string, off: number, all: string) => {
      return CONDITIONAL.test(clauseOf(all, off, off + whole.length)) ? whole : `${d} ${verb === 'is' ? 'is' : 'has been'} planned`;
    });
  return { subject: fix(email.subject), body: fix(email.body) };
}
