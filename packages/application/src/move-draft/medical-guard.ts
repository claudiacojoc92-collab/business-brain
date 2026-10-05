/**
 * The regulated-claim guard — the deterministic medical/therapeutic/clinical gate for founder-facing landing
 * copy. Definition + Romanian spec: intent/2026-10-05-landing-move/plan.md and ./landing-medical-cases.ro.ts.
 *
 * It catches the three blocked classes: (1) promising a health outcome, (2) claiming a therapeutic effect,
 * (3) implying clinical competence beyond stated credentials. It is keyed on CONSTRUCTIONS, not a "we"-verb
 * list — Romanian clinic copy is often second person ("Scapi de durere în trei ședințe."). It is deliberately
 * NOT a general claim checker: naming a condition as the context of a service ("terapie pentru dureri lombare")
 * PASSES; only a treatment/outcome verb or an outcome construction fails. The "Dureri lombare? Terapie manuală."
 * juxtaposition has no verb to key on and passes here BY DESIGN — that gap is covered only by the Layer-3 judge.
 *
 * This is the non-stochastic floor. It is a PRODUCT rule, not legal advice.
 */

export type GuardLanguage = 'ro' | 'en' | 'it';
export type RegulatedClass = 1 | 2 | 3;
export interface RegulatedFinding { readonly clause: string; readonly blockedClass: RegulatedClass; readonly reason: string }

/**
 * Languages whose guard vocabulary a speaker has REVIEWED. Generation must never emit a language not listed
 * here (plan §Language coverage): the generator gates on this set. Deliberate config, not a TODO.
 */
export const GUARD_ENABLED_LANGUAGES: readonly GuardLanguage[] = [
  'ro', // reviewed by Claudia 2026-10-05 (landing-medical-cases.ro.ts)
  'en', // English is the base definition language
  // 'it' — DISABLED: the Italian guard vocabulary has NOT been read by a native speaker. Do not enable (and do
  //        not let the generator emit Italian) until one has. This absence is intentional.
];

export function isGuardLanguageEnabled(language: string): language is GuardLanguage {
  return (GUARD_ENABLED_LANGUAGES as readonly string[]).includes(language);
}

/** Fold RO/IT diacritics so the guard is robust to copy typed without them (common in Romanian). */
function fold(s: string): string {
  return s.toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[àèéìòù]/g, (m) => ({ 'à': 'a', 'è': 'e', 'é': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u' }[m] ?? m));
}

// ── Romanian (diacritic-folded patterns) ──
const RO = {
  // First-person-plural THERAPEUTIC/causal verbs (effect ON a condition). NOT descriptive verbs (lucram,
  // oferim, ne concentram, construim, evaluam) — those are how you describe what you do.
  therapeuticFP: /\b(tratam|vindecam|amelioram|reducem|combatem|remediem|detensionam|rezolvam|corectam|imbunatatim|eliminam|scapam|refacem|recuperam)\b/,
  // First-person OUTCOME / restoration / prevention verbs (promise about the body's future state).
  outcomeFP: /\b(redam|prevenim)\b|\bpunem\b[^.?!]{0,20}\bpe picioare\b/,
  // SECOND-person outcome constructions — the structural gap a we-verb list misses.
  outcomeSP: /\bscapi\b[^.?!]{0,30}\b(durere|dureri|durerea)\b|\brevii\b[^.?!]{0,20}\b(la|in)\b|\bte misti\b|\bte faci bine\b|\bte vindeci\b|\bte recuperezi\b|\bte intorci\b[^.?!]{0,20}\bla\b/,
  // Outcome statistics / client-results / guarantees.
  stat: /\d+\s*%|\bgarantat(e|a)?\b|\bmulti clienti\b|\bclienti\b[^.?!]{0,40}\b(revin|scapa|se recupereaza)\b/,
  // Clinical authority beyond a stated credential — "specialist" borrows the regulated "medic specialist" title.
  authority: /\bspeciali(st|sti|stii|sta)\b/,
};

// ── English (base-definition language) ──
const EN = {
  therapeuticFP: /\bwe\b[^.?!]{0,20}\b(treat|cure|heal|relieve|reduce|combat|remedy|release|resolve|solve|fix|correct|improve|eliminate|rehabilitate)\b|\bget(s)? rid of\b/,
  outcomeFP: /\bwe\b[^.?!]{0,20}\b(restore|prevent)\b|\bget(s)? you (back|moving|running)\b|\bback on your feet\b/,
  outcomeSP: /\byou(\b|'ll| will)[^.?!]{0,30}\b(get rid of|return to|move again|recover|run again|be pain[- ]free)\b/,
  stat: /\d+\s*%|\bguaranteed?\b|\bmany clients\b|\bclients\b[^.?!]{0,40}\b(return|recover|get rid)\b/,
  authority: /\bspecialists?\b/,
};

/**
 * Detect regulated claims in `text`. Returns one finding per construction class matched (empty ⇒ the
 * deterministic layer finds nothing — still subject to the Layer-3 judge upstream). Fail-closed on an
 * unenabled language: the guard cannot vouch for it, so it reports a blocking finding rather than passing.
 */
export function detectRegulatedClaims(text: string, language: GuardLanguage): RegulatedFinding[] {
  if (!isGuardLanguageEnabled(language)) {
    return [{ clause: text, blockedClass: 2, reason: `regulated-claim guard has no reviewed vocabulary for language "${language}" — fail-closed` }];
  }
  const t = fold(text);
  const P = language === 'en' ? EN : RO; // 'it' is unreachable (not enabled); ro is the default
  const findings: RegulatedFinding[] = [];
  const add = (cls: RegulatedClass, reason: string) => findings.push({ clause: text.trim(), blockedClass: cls, reason });

  if (P.therapeuticFP.test(t)) add(2, 'therapeutic-effect verb asserting an effect on a condition');
  if (P.outcomeSP.test(t)) add(1, 'second-person outcome construction (promises what will happen to the reader)');
  if (P.outcomeFP.test(t)) add(1, 'first-person outcome / restoration / prevention claim');
  if (P.stat.test(t)) add(1, 'outcome statistic, guarantee, or client-results claim');
  if (P.authority.test(t)) add(3, 'implies a clinical specialty/authority beyond a stated credential');
  return findings;
}

/** Convenience: does the text contain any regulated claim the deterministic layer can see? */
export function hasRegulatedClaim(text: string, language: GuardLanguage): boolean {
  return detectRegulatedClaims(text, language).length > 0;
}
