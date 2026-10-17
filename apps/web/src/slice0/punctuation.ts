/**
 * PUNCTUATION AFTER COMPOSITION (2026-10-17). Founder copy is often joined from pieces (a headline + ". " + a body)
 * or arrives from a model with a stray mark, which gave "pas în plus?." on the first read. Small and generic: a
 * sentence mark followed by a period keeps the first mark, a doubled period becomes one (an ellipsis stays), and
 * no space is left before punctuation.
 */
export function tidyPunctuation(text: string): string {
  return text
    .replace(/([?!:;])\.(?!\.)/gu, '$1')
    .replace(/(?<!\.)\.\.(?!\.)/gu, '.')
    .replace(/\s+([.,;:?!])(?=\s|$)/gu, '$1');
}

/** End a composed sentence: add a period only when it has no sentence mark of its own. */
export function endSentence(text: string): string {
  const t = text.trimEnd();
  return /[.?!…:]$/u.test(t) ? t : `${t}.`;
}
