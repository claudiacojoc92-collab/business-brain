/**
 * GROUNDING GUARD — the page describes what the business IS, from its licensed facts, not what the strategy wishes
 * it were. Found live on Body Move (2026-10-07, BUS-16): the strategy targets doctor-referred women, and the draft
 * wrote "un studio dedicat femeilor" and "la recomandarea medicului" as facts about a studio that also runs
 * children's and adult ballet classes and never mentions referrals. Every other layer and the judge passed it.
 *
 * Two closed claim families, deterministic, RO / EN / IT:
 *   - REFERRAL: the business works on / receives a doctor's referral or medical recommendation. Allowed only when a
 *     licensed fact contains the same phrase (diacritic-folded).
 *   - EXCLUSIVITY: the business is dedicated to / exclusively / only for a group. Allowed only when the group word
 *     appears in a licensed fact ("dedicat sănătății" passes on Body Move because the site says it).
 * Addressing the reader's need ("dacă ai nevoie de recuperare după naștere") is NOT a claim and is not matched.
 */
export interface GroundingFinding { readonly kind: 'referral' | 'exclusivity'; readonly clause: string }

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const REFERRAL: RegExp[] = [
  // RO
  /\brecomandar\w*\s+(?:din\s+partea\s+)?(?:medic\w*|doctor\w*)/, // recomandarea medicului / recomandare medicală
  /\btrimis\w*\s+de\s+(?:catre\s+)?(?:medic\w*|doctor\w*)/,      // trimise de medic
  /\bindicati\w*\s+(?:medic\w*|doctor\w*)/,                       // indicația medicului
  /\bprescripti\w*\s+medical\w*/,
  // EN
  /\bdoctor'?s?\s+(?:referral|recommendation|orders?)\b/,
  /\breferred\s+(?:to\s+us\s+)?by\s+(?:a|your|their)\s+(?:doctor|physician|gp)\b/,
  /\bmedical\s+(?:referral|recommendation)\b/,
  /\bon\s+(?:medical|your\s+doctor'?s?)\s+advice\b/,
  // IT
  /\bsu\s+(?:indicazione|prescrizione|consiglio)\s+(?:del\s+)?medic\w*/,
  /\bindicazione\s+medica\b/,
  /\binviat\w*\s+dal\s+(?:medico|dottore)\b/,
  // The same route as a condition on the reader ("if your doctor recommended…"): still the strategy's channel.
  /\b(?:medicul|doctorul)\s+(?:tau|dumneavoastra|vostru)\b[^.!?]{0,30}\b(?:recomandat|trimis|indicat|prescris)/,
  /\byour\s+(?:doctor|physician|gp)\s+(?:has\s+)?(?:recommended|referred|prescribed|sent)\b/,
  /\bil\s+tuo\s+medico\s+ti\s+ha\s+(?:consigliato|prescritto|indirizzato|inviato)\b/,
];

// "dedicated to X" family: capture the group word X. Determiners/pronouns are not a group.
const EXCLUSIVITY: RegExp[] = [
  /\b(?:dedicat[aei]?|destinat[aei]?|rezervat[aei]?)\s+(?:exclusiv\s+|doar\s+|numai\s+)?([a-z]+)/,   // RO dedicat femeilor
  /\b(?:exclusiv|doar|numai)\s+pentru\s+([a-z]+)/,                                                    // RO doar pentru mame
  /\b(?:dedicated|exclusively|only|reserved)\s+(?:to|for)\s+([a-z]+)/,                               // EN
  /\b(?:dedicat[oaie]|riservat[oaie])\s+(?:a|ai|alle?|agli|per)\s+([a-z]+)/,                          // IT dedicato alle donne
  /\b(?:esclusivamente|solo)\s+per\s+([a-z]+)/,
  // Gender as the condition for being served ("dacă ești femeie…"): an audience restriction in disguise.
  /\b(?:daca\s+esti\s+|if\s+you(?:'re|\s+are)\s+(?:a\s+)?|se\s+sei\s+(?:una?\s+)?)(femeie|barbat|woman|man|donna|uomo)\b/,
];
// Determiners / pronouns ("dedicate acestor nevoi" = "dedicated to these needs") are not a group.
const NOT_A_GROUP = new Set([
  'celor', 'tuturor', 'tine', 'voi', 'noi', 'cei', 'cele', 'oricui', 'acestor', 'acestora', 'aceste', 'acestei', 'lor', 'fiecarui', 'fiecarei',
  'the', 'these', 'those', 'this', 'that', 'them', 'you', 'your', 'everyone', 'anyone', 'people', 'each',
  'chi', 'te', 'tutti', 'questi', 'queste', 'loro', 'a', 'an', 'un', 'o',
]);

/** Folded clauses of the draft that voice a referral or an exclusivity the licensed facts do not contain. */
export function detectUngroundedFraming(draftText: string, licensedFacts: readonly string[]): GroundingFinding[] {
  const text = fold(draftText);
  const facts = fold(licensedFacts.join(' \n '));
  const out: GroundingFinding[] = [];
  for (const re of REFERRAL) {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
      if (!facts.includes(m[0])) out.push({ kind: 'referral', clause: m[0] });
    }
  }
  for (const re of EXCLUSIVITY) {
    for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
      const group = m[1] ?? '';
      if (!group || NOT_A_GROUP.has(group)) continue;
      // Stem match (first 5 letters) so inflection on either side ("femei" / "femeilor") still counts as present.
      if (!facts.includes(group.slice(0, Math.min(5, group.length)))) out.push({ kind: 'exclusivity', clause: m[0] });
    }
  }
  return [...new Map(out.map((f) => [`${f.kind}:${f.clause}`, f])).values()];
}
