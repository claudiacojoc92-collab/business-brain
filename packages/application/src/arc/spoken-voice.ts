/**
 * Spoken-voice cleanup shared by the arc's written surfaces (week story, email). Operator, 2026-10-12: one rule set
 * everywhere, not per surface. The prompts carry the rules; this is the deterministic backstop for the parts code can
 * fix safely without rewriting meaning:
 *   - no dashes: an em/en dash used between words becomes a comma ("runbook — scheduling" → "runbook, scheduling"),
 *   - no "+" joiner in a subject ("date + runbook" → "date and runbook", in the content language),
 *   - a placeholder is one short phrase: "[specific date — to be confirmed by Friday]" → "[specific date]".
 */
const AND: Record<string, string> = { en: 'and', ro: 'și', it: 'e' };

export function withoutDashes(s: string): string {
  return (s ?? '')
    .replace(/\s+[—–]\s+(?=[\])])/g, '')           // a dash right before a closing bracket: drop it
    .replace(/\s*[—–]\s*/g, ', ')                   // em/en dash between words → comma
    .replace(/\s+-\s+/g, ', ')                                // a spaced hyphen used as a dash
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?;:])/g, '$1');
}

export function simplePlaceholders(s: string): string {
  // Only bracketed slots with an explanation tucked inside ("[date, to be confirmed by…]") are cut to their first phrase.
  return (s ?? '').replace(/\[([^\]\n]{1,400})\]/g, (whole, inner: string) => {
    const head = inner.split(/\s*(?:,|;|—|–|\s-\s|\(|\bto be\b|\btbc\b|\btbd\b)\s*/i)[0]!.trim();
    return head && head.length < inner.trim().length ? `[${head}]` : whole;
  });
}

export function plainSubject(s: string, language: string): string {
  return withoutDashes((s ?? '').replace(/\s*\+\s*/g, ` ${AND[language] ?? 'and'} `)).replace(/\s{2,}/g, ' ').trim();
}

/** Body/field text: placeholders first (so their inner dash is cut, not turned into a comma), then dashes. */
export function spoken(s: string): string {
  return withoutDashes(simplePlaceholders(s));
}
