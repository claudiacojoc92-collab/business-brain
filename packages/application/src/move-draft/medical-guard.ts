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

// A named condition / diagnosis / body-region lexicon (folded). Used ONLY to scope the authority rule:
// "specialist/specializat în [a condition]" is a scope claim; "specialist în kinetoterapie" (a discipline) or
// "medic specialist" (a held title) is not. Narrowed after out-of-sample run 1 (see plan status log).
const RO_CONDITION = 'coloana|coloanei|hernie|disc|discopatie|lombar|cervical|spate|genunchi|umar|sold|glezn|articula|durere|dureri|durerea|postura|posturii|scolioz|cifoz|sciatic|tendinit|entors|nevralgie|afectiun|avc|parkinson|paraliz';

// RO verb inflection endings (folded) — infinitive / finite (all persons) / subjunctive / gerund / participle.
// Deliberately NOT the noun-forming suffixes (-ament, -are, -ere): a nominalization is left for the judge.
const RO_V = '(a|e|i|ez|ezi|eaza|am|em|im|ati|eze|easca|este|at|and|ind)';

// ── Romanian (diacritic-folded patterns) ──
const RO = {
  // THERAPEUTIC/causal verbs by STEM in ANY inflected form (generalized after run 2, not a "pentru a" pattern
  // which breaks on "scopul de a trata" / "menite să trateze"). Catches the infinitive ("a trata cauza
  // durerii"), the finite first/third person ("tratăm", "masajul reduce durerea", "terapia crește mobilitatea"),
  // and the subjunctive ("să trateze"). NOT descriptive verbs (lucrăm, oferim, ne concentrăm). Nominalizations
  // (tratament, tratarea, recuperare, îmbunătățirea, creșterea) are not verb inflections → NOT matched (point 3:
  // "tratamentul afecțiunilor coloanei" is the nominal form of service-for-condition and PASSES). The reflexive
  // descriptive "se recuperează / se vindecă" (a person recovering) is excluded via lookbehind.
  therapeuticFP: new RegExp(
    '\\b(?:trat|amelior|combat|remedi|detension|rezolv|corect|imbunatat|elimin|refac|reduc|crest)' + RO_V + '\\b' +
    '|(?<!se\\s)\\b(?:vindec|recuper)' + RO_V + '\\b',
  ),
  // OUTCOME / restoration / prevention verbs, incl. the infinitive ("a-ți reda calitatea vieții", "a-ți recăpăta
  // mobilitatea", "a preveni").
  outcomeFP: /\bred(a|am|au|e)\b|\brecapat(a|am|ati|eze)\b|\bpreven(i|im|ati)\b|\bprevin(e|em)\b|\bpunem\b[^.?!]{0,20}\bpe picioare\b/,
  // SECOND-person / imperative outcome constructions — informal singular (te/tu), the IMPERATIVE ("scapă de
  // durere"), the polite plural (dumneavoastră: vă/reveniți), plus the infinitive "a reveni la …".
  outcomeSP: new RegExp(
    '\\bscap(a|i|am|ati|e)\\b[^.?!]{0,30}\\b(durere|dureri|durerea)\\b' +         // scapi/scapă/scăpăm/scăpați ... de durere
    '|\\b(revii|reveniti|reveni|te intorci|va intoarceti)\\b[^.?!]{0,25}\\b(la|in)\\b' + // (te/vă) return to · reveniți/a reveni la
    '|\\b(te recuperezi|va recuperati)\\b' +                                      // you recover (informal / polite)
    '|\\b(te misti|va miscati)\\b[^.?!]{0,25}\\b(din nou|fara durere)\\b' +       // you move again / without pain
    '|\\bte faci bine\\b|\\bte vindeci\\b|\\bva vindecati\\b',
  ),
  // Outcome STATISTIC / guarantee / client-results — a percentage counts ONLY when attached to clients/patients
  // plus an outcome. A bare % (discount, price), a duration or a session count is NOT a health statistic
  // (false positives from run 1: "20% REDUCERE", "-40% SENIORI").
  stat: new RegExp(
    '\\bgarantat(e|a)?\\b' +                                                      // guarantee
    '|\\d+\\s*%[^.?!]{0,30}\\b(clien|pacien)' +                                   // N% ... clients/patients
    '|\\b(clien|pacien)\\w*[^.?!]{0,30}\\d+\\s*%' +                               // clients/patients ... N%
    '|\\bmul(t|)i\\s+(clien|pacien)\\w*[^.?!]{0,40}\\b(revin|scapa|se recupereaza|se vindeca)\\b', // many clients return/recover
  ),
  // Clinical AUTHORITY — only "specialist/specializat în [a named condition]". Plain discipline ("specialist în
  // kinetoterapie") and held credentials ("medic specialist") PASS; the marginal case goes to the judge
  // (narrowed after run 1 blocked a real credential and a team naming its own profession).
  authority: new RegExp('\\bspeciali(st|sti|stii|sta|zat|zati|zata|zate)\\b[^.?!]{0,25}\\b(in|pe|pentru)\\b[^.?!]{0,25}\\b(' + RO_CONDITION + ')'),
};

// ── English (base-definition language) — mirrors the RO narrowing; not out-of-sample validated. ──
const EN_CONDITION = 'spine|back|disc|herniat|lumbar|cervical|knee|shoulder|hip|ankle|joint|pain|posture|sciatic|tendon|sprain|neuralgia|injur|stroke|parkinson';
const EN = {
  therapeuticFP: /\bwe\b[^.?!]{0,20}\b(treat|cure|heal|relieve|reduce|combat|remedy|release|resolve|solve|fix|correct|improve|eliminate|rehabilitate)\b|\bget(s)? rid of\b/,
  outcomeFP: /\bwe\b[^.?!]{0,20}\b(restore|prevent)\b|\bget(s)? you (back|moving|running)\b|\bback on your feet\b/,
  outcomeSP: /\byou(\b|'ll| will)[^.?!]{0,30}\b(get rid of|return to|move again|recover|run again|be pain[- ]free)\b/,
  stat: new RegExp('\\bguaranteed?\\b|\\d+\\s*%[^.?!]{0,30}\\b(client|patient)|\\b(client|patient)s?\\b[^.?!]{0,30}\\d+\\s*%|\\bmany (client|patient)s?\\b[^.?!]{0,40}\\b(return|recover|get rid)\\b'),
  authority: new RegExp('\\bspeciali(st|sts|zed|zing)\\b[^.?!]{0,25}\\b(in|for)\\b[^.?!]{0,25}\\b(' + EN_CONDITION + ')'),
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
