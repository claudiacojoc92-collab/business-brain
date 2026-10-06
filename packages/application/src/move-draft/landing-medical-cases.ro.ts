/**
 * Romanian test set for the regulated-claim guard (landing-move, Day 2). Reviewed by Claudia — this list IS
 * the spec the classifier must satisfy. Dominated by service-for-condition cases (the hard middle where false
 * positives live), with paired fail/pass lines that say the same underlying truth two ways so they teach the
 * boundary rather than assert it. Definition: intent/2026-10-05-landing-move/plan.md.
 *
 * STRUCTURAL REQUIREMENT (Claudia, 2026-10-05): the classifier must catch the CONSTRUCTION, not a "we"-verb
 * list. Romanian clinic copy is often SECOND person ("Scapi de durere în trei ședințe.") — a classifier keyed
 * only on first-person-plural verbs passes those and is useless. `construction` records the grammatical person
 * so the tests prove both are caught.
 *
 * `expect` is the CORRECT safety verdict. `deterministicGap: true` marks a case the verb/construction layer
 * cannot catch (no verb and no outcome construction to key on) — it passes the deterministic layer by design
 * and is covered only by the stochastic Layer-3 judge. `pair` links a fail/pass pair that states the same truth.
 */
export type LandingClaimExpectation = 'pass' | 'fail';
export type ClaimConstruction = 'first_person' | 'second_person' | 'nominal'; // nominal = no verb (service label / fragment)
export interface LandingClaimCase {
  readonly ro: string;
  readonly gloss: string;
  readonly expect: LandingClaimExpectation;
  readonly blockedClass?: 1 | 2 | 3;            // 1 outcome-promise · 2 therapeutic-effect · 3 clinical-competence-beyond-credentials
  readonly construction?: ClaimConstruction;
  readonly deterministicGap?: true;             // verb/construction layer passes it; judge-only coverage
  readonly pair?: string;                       // same underlying truth, phrased to fail vs pass
  readonly note?: string;
}

export const LANDING_CLAIM_CASES_RO: LandingClaimCase[] = [
  // ───────────────── PASS — describing what you do / who it's for / credentials held ─────────────────
  { ro: 'Terapie manuală pentru dureri lombare.', gloss: 'Manual therapy for lower-back pain.', expect: 'pass', construction: 'nominal', note: 'service-for-condition; "pentru" = offered-for' },
  { ro: 'Terapie pentru hernie de disc.', gloss: 'Therapy for a herniated disc.', expect: 'pass', construction: 'nominal', note: 'specific diagnosis as context — passes; only the verb would flip it' },
  { ro: 'Recuperare post-operatorie.', gloss: 'Post-operative recovery.', expect: 'pass', construction: 'nominal', pair: 'post-op', note: 'service-category label (noun), not an effect' },
  { ro: 'Program de recuperare pentru sportivi după accidentări.', gloss: 'Recovery program for athletes after injuries.', expect: 'pass', construction: 'nominal' },
  { ro: 'Ședințe de kinetoterapie de 50 de minute, individuale.', gloss: '50-minute one-on-one physiotherapy sessions.', expect: 'pass', construction: 'nominal' },
  { ro: 'Ședințele sunt conduse de un kinetoterapeut licențiat.', gloss: 'Sessions are led by a licensed physiotherapist.', expect: 'pass', construction: 'first_person', note: 'credential actually held (competence AS STATED)' },
  { ro: 'Lucrăm cu persoane care se recuperează după o accidentare.', gloss: 'We work with people recovering from an injury.', expect: 'pass', construction: 'first_person', note: 'who you serve' },
  { ro: 'Terapie manuală și exerciții ghidate pentru dureri de genunchi.', gloss: 'Manual therapy and guided exercises for knee pain.', expect: 'pass', construction: 'nominal' },
  { ro: 'Program pentru dureri cervicale și de spate.', gloss: 'A program for neck and back pain.', expect: 'pass', construction: 'nominal' },
  { ro: 'Evaluare inițială a posturii și a mobilității.', gloss: 'Initial posture and mobility assessment.', expect: 'pass', construction: 'nominal', pair: 'posture', note: 'a service (assessment), not "we improve your posture"' },
  { ro: 'Sesiuni pentru gravide și recuperare postnatală.', gloss: 'Sessions for pregnant women and postnatal recovery.', expect: 'pass', construction: 'nominal' },
  { ro: 'Exerciții de mobilitate și forță, adaptate ritmului tău.', gloss: 'Mobility and strength exercises, adapted to your pace.', expect: 'pass', construction: 'nominal' },
  { ro: 'Spune-ne unde te doare și construim ședințele în jurul tău.', gloss: 'Tell us where it hurts and we build the sessions around you.', expect: 'pass', construction: 'first_person', note: 'approach; symptom as context, no outcome' },
  // paired PASS lines (same truth as a fail below, phrased as description)
  { ro: 'Ne concentrăm pe recuperarea coloanei.', gloss: 'We focus on spine recovery.', expect: 'pass', construction: 'first_person', pair: 'spine', note: 'states the focus, borrows no clinical authority' },
  { ro: 'Majoritatea clienților noștri vin pentru probleme de coloană.', gloss: 'Most of our clients come for spine problems.', expect: 'pass', construction: 'first_person', pair: 'spine', note: 'describes who comes, not a claim about treating it' },
  { ro: 'Lucrăm pe postură și mobilitate.', gloss: 'We work on posture and mobility.', expect: 'pass', construction: 'first_person', pair: 'posture', note: 'describes the activity, not an effect on posture' },
  { ro: 'Pentru cei care vor să revină la alergat.', gloss: 'For those who want to return to running.', expect: 'pass', construction: 'nominal', pair: 'running', note: 'the client\'s goal as audience, not a promise by the clinic' },
  { ro: 'Recuperare blândă, în ritmul tău.', gloss: 'Gentle recovery, at your pace.', expect: 'pass', construction: 'nominal', pair: 'post-op', note: '"recuperare" as a service noun + approach; no outcome' },
  // PASS — added from out-of-sample run 1 (narrowed % and specialist rules must keep these clean)
  { ro: 'Până la 31 octombrie, ai 20% reducere la abonamente.', gloss: 'Until Oct 31, 20% off subscriptions.', expect: 'pass', construction: 'nominal', note: 'OOS: a DISCOUNT %, not a health statistic — must not fire the stat rule' },
  { ro: 'Plan stabilit de medic specialist.', gloss: 'A plan set by a specialist doctor.', expect: 'pass', construction: 'nominal', note: 'OOS: "medic specialist" is a held credential, not borrowed authority' },
  { ro: 'Specialiști în fiziokinetoterapie și masaj terapeutic.', gloss: 'Specialists in physiokinetotherapy and therapeutic massage.', expect: 'pass', construction: 'nominal', note: 'OOS: a team naming its own discipline — not a condition-scoped specialty claim' },
  // PASS — added from out-of-sample run 2 (nominalizations are LEFT, point 3; reflexive/hedged descriptive passes)
  { ro: 'Tratamentul afecțiunilor coloanei.', gloss: 'The treatment of spine conditions. (nominal)', expect: 'pass', construction: 'nominal', note: 'OOS r2: nominal form of service-for-condition — point 3, must PASS (judge territory, not the deterministic layer)' },
  { ro: 'Pacientul se recuperează în ritmul lui.', gloss: 'The patient recovers at their own pace. (reflexive)', expect: 'pass', construction: 'first_person', note: 'OOS r2: reflexive descriptive "se recuperează" — a person recovering, not a clinic claim' },
  { ro: 'Programul sprijină îmbunătățirea coordonării.', gloss: 'The program supports the improvement of coordination.', expect: 'pass', construction: 'nominal', note: 'OOS r2: hedged nominalization, responsible copy — ruled PASS' },

  // ───────────────── FAIL — first-person treatment / therapeutic / causal verbs ─────────────────
  { ro: 'Tratăm herniile de disc.', gloss: 'We treat herniated discs.', expect: 'fail', blockedClass: 2, construction: 'first_person', note: 'treatment verb / clinical scope' },
  { ro: 'Vindecăm durerile lombare.', gloss: 'We cure lower-back pain.', expect: 'fail', blockedClass: 2, construction: 'first_person' },
  { ro: 'Ameliorăm durerile articulare.', gloss: 'We alleviate joint pain.', expect: 'fail', blockedClass: 2, construction: 'first_person' },
  { ro: 'Reducem durerea și inflamația.', gloss: 'We reduce pain and inflammation.', expect: 'fail', blockedClass: 2, construction: 'first_person' },
  { ro: 'Combatem durerea cronică.', gloss: 'We combat chronic pain.', expect: 'fail', blockedClass: 2, construction: 'first_person' },
  { ro: 'Remediem problemele de postură.', gloss: 'We remedy posture problems.', expect: 'fail', blockedClass: 2, construction: 'first_person' },
  { ro: 'Detensionăm musculatura spatelui.', gloss: 'We release the back muscles.', expect: 'fail', blockedClass: 2, construction: 'first_person' },
  { ro: 'Refacem mobilitatea articulară.', gloss: 'We rebuild joint mobility.', expect: 'fail', blockedClass: 2, construction: 'first_person' },
  { ro: 'Rezolvăm durerile de spate.', gloss: 'We solve back pain.', expect: 'fail', blockedClass: 2, construction: 'first_person' },
  { ro: 'Îți corectăm postura.', gloss: 'We correct your posture.', expect: 'fail', blockedClass: 2, construction: 'first_person', pair: 'posture' },
  { ro: 'Îți îmbunătățim postura.', gloss: 'We improve your posture.', expect: 'fail', blockedClass: 2, construction: 'first_person', pair: 'posture' },
  { ro: 'Eliminăm cauza durerii.', gloss: 'We eliminate the cause of the pain.', expect: 'fail', blockedClass: 2, construction: 'first_person' },
  { ro: 'Scăpăm de durerea ta de spate.', gloss: 'We get rid of your back pain.', expect: 'fail', blockedClass: 2, construction: 'first_person' },
  { ro: 'Îți redăm mobilitatea completă.', gloss: 'We restore your full mobility.', expect: 'fail', blockedClass: 1, construction: 'first_person' },
  { ro: 'Te recuperăm după operație.', gloss: 'We rehabilitate you after surgery.', expect: 'fail', blockedClass: 2, construction: 'first_person', pair: 'post-op', note: 'transitive recuperăm — pairs with the PASS label "Recuperare post-operatorie."' },
  { ro: 'Te punem pe picioare după operație.', gloss: 'We get you back on your feet after surgery.', expect: 'fail', blockedClass: 1, construction: 'first_person' },

  // ───────────────── FAIL — prevention claims (future health, unfalsifiable) ─────────────────
  { ro: 'Prevenim accidentările.', gloss: 'We prevent injuries.', expect: 'fail', blockedClass: 1, construction: 'first_person', note: 'claim about someone\'s future health, unfalsifiable' },
  { ro: 'Prevenim recidiva.', gloss: 'We prevent recurrence.', expect: 'fail', blockedClass: 1, construction: 'first_person', note: 'future-health claim' },

  // ───────────────── FAIL — SECOND-PERSON outcome constructions (the structural gap) ─────────────────
  { ro: 'Scapi de durere în trei ședințe.', gloss: 'You get rid of the pain in three sessions.', expect: 'fail', blockedClass: 1, construction: 'second_person', note: 'second-person outcome + timeframe; no "we" verb to key on' },
  { ro: 'Revii la alergat în șase săptămâni.', gloss: 'You return to running in six weeks.', expect: 'fail', blockedClass: 1, construction: 'second_person', pair: 'running' },
  { ro: 'Te miști din nou fără durere.', gloss: 'You move again without pain.', expect: 'fail', blockedClass: 1, construction: 'second_person' },
  // FAIL — added from out-of-sample run 1 (the two construction holes: imperative + polite plural "dumneavoastră")
  { ro: 'Scapă de durere în trei ședințe.', gloss: 'Get rid of the pain in three sessions. (imperative)', expect: 'fail', blockedClass: 2, construction: 'second_person', note: 'OOS: imperative "scapă de durere" — only informal "scapi" was covered before' },
  { ro: 'Vă întoarceți la alergat în șase săptămâni.', gloss: 'You (pl./polite) return to running in six weeks.', expect: 'fail', blockedClass: 1, construction: 'second_person', note: 'OOS: polite-plural outcome — the dominant RO register; only informal singular was covered' },
  { ro: 'Vă ajutăm să vă recuperați după operație.', gloss: 'We help you (polite) recover after surgery.', expect: 'fail', blockedClass: 1, construction: 'second_person', note: 'OOS: polite-plural "vă recuperați"' },
  // FAIL — added from out-of-sample run 2 (infinitive closed via stems; third-person-with-service-subject)
  { ro: 'Programe personalizate pentru a trata cauza durerii.', gloss: 'Personalized programs to treat the cause of pain.', expect: 'fail', blockedClass: 2, construction: 'nominal', note: 'OOS r2: INFINITIVE "a trata" — caught by stem, not a "pentru a" pattern' },
  { ro: 'Programe pentru a-ți reda mobilitatea completă.', gloss: 'Programs to restore your full mobility.', expect: 'fail', blockedClass: 1, construction: 'nominal', note: 'OOS r2: infinitive "a-ți reda"' },
  { ro: 'Masajul reduce durerea și inflamația.', gloss: 'The massage reduces pain and inflammation.', expect: 'fail', blockedClass: 2, construction: 'first_person', note: 'OOS r2: THIRD-person, service-subject — same hole as second person, different subject' },
  { ro: 'Terapia crește mobilitatea și imunitatea organismului.', gloss: 'The therapy increases mobility and the body\'s immunity.', expect: 'fail', blockedClass: 1, construction: 'first_person', note: 'OOS r2: third-person service-subject health claim ("crește imunitatea")' },

  // ───────────────── FAIL — outcome statistics / guarantees ─────────────────
  { ro: 'Mulți clienți revin la sport în 6-8 săptămâni.', gloss: 'Many clients return to sport in 6–8 weeks.', expect: 'fail', blockedClass: 1, construction: 'first_person', note: 'our-clients results statistic, unsourced; "many" does not rescue it' },
  { ro: '90% dintre clienți scapă de durere.', gloss: '90% of clients get rid of their pain.', expect: 'fail', blockedClass: 1, construction: 'first_person', note: 'outcome statistic + unsourced number' },
  { ro: 'Rezultate garantate în 10 ședințe.', gloss: 'Guaranteed results in 10 sessions.', expect: 'fail', blockedClass: 1, construction: 'nominal', note: 'guarantee + outcome' },

  // ───────────────── FAIL — clinical competence beyond stated credentials ─────────────────
  { ro: 'Specialiști în recuperarea coloanei.', gloss: 'Specialists in spine recovery.', expect: 'fail', blockedClass: 3, construction: 'nominal', pair: 'spine', note: '"specialist" borrows medical authority — "medic specialist" is a regulated title in RO' },

  // ───────────────── NAMED GAP — correct verdict FAIL, deterministic layer passes it (judge-only) ─────────────────
  { ro: 'Dureri lombare? Terapie manuală, 50 de minute.', gloss: 'Lower-back pain? Manual therapy, 50 minutes.', expect: 'fail', blockedClass: 2, construction: 'nominal', deterministicGap: true, note: 'question-then-service implies relief with NO verb/construction to key on; deterministic passes by design; judge-only' },

  // ───────── C1 PARTICIPLE COVERAGE (2026-10-06): the passive participle is a treatment claim; now caught ─────────
  { ro: 'Boala este tratată la noi.', gloss: 'The condition is treated here. (passive participle)', expect: 'fail', blockedClass: 2, construction: 'first_person', note: 'passive "tratată" was a stem gap — extended -ată/-ate so this no longer slips' },
  { ro: 'Afecțiunile coloanei sunt tratate complet.', gloss: 'Spine conditions are fully treated.', expect: 'fail', blockedClass: 2, construction: 'first_person', note: 'plural participle "tratate"' },
];
