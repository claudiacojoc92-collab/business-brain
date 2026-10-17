import type { AhaResult, BusinessStructure, ClaimEvidence, DiagnosisCheck, RepairableField, StructureOutcome, StructureRepairRequest, EvidenceBasis, GovernedUnderstanding, ModelClaim, ModelDimension, PageObservation, QuestionTier, StrategicDecision, StructuralHypothesis, UnderstandingRead, UntrustedReason } from './contracts';
import { DIAGNOSIS_CHECKS, EVIDENCE_SURFACES, MODEL_DIMENSIONS, STRATEGIC_DECISIONS, STRUCTURE_RELATIONSHIPS } from './contracts';
import { isHousekeeping, sameInsight } from './insight-text';
import { isWebsiteHygiene, trustByRef } from './source-trust';
import { groundCounts, groundNumbers, numbersIn } from './numeric-grounding';
import { anchorClaimEvidence } from './evidence-anchor';
import { normalizeUnderstandingShapes } from './model-shapes';
import { makesUnlicensedClaim } from './validation';

/**
 * UNDERSTANDING GOVERNANCE (2026-10-15). The model proposes a business-model read; code decides what is allowed to stand,
 * BEFORE the understanding is stored (strategy, Aha 2, the mirror and the conversation all read what is stored):
 *
 *  1. Source trust: a claim that rests only on technical pages (sitemap, maintenance, shop mechanics) or on pages found
 *     only in a sitemap is "something I found but don't trust yet", never a business fact or a tension.
 *  2. Website hygiene (counters, indexing, broken pages) is never a tension or a question.
 *  3. Absence is an observation about the sources, not about the business: "I could not see X" keeps no consequence
 *     ("so all persuasion happens at reception" is unsupported), and its basis is what was observed.
 *  4. A diagnosis is EARNED: it is called the constraint only when every check passes (the condition exists, it is
 *     causally tied to the founder's goal, it blocks progress, competing explanations are weaker, the evidence is
 *     enough) — and without the founder's goal, nothing can be causally tied to it. Otherwise it is a hypothesis.
 *  5. Questions are ranked by the strategic decisions their answer could change; a question that changes none, or is
 *     about the website's hygiene, never takes one of the few slots.
 *
 * Deterministic. A snapshot without a v2 `read` (older prompt) passes through unchanged.
 */

const ABSENCE = /(?<!\p{L})(no (page|post|source|client|customer|testimonial|example|case|result|price|protocol|visible)|none of|never (shows?|mentions?|appears?)|not (visible|shown|mentioned|published)|does(n't| not) (show|mention)|there (is|are) no|ha(s|ve) no|nothing (on|in)|missing|nicio|niciun(ul|a)?|nu (există|exista|apare|apar|arată|se vede|se văd|menționează|au|are)|absen[țt]a|lips[ăa]|lipse[șs]te|lipsesc|nessun[oa]?|non (c'è|ci sono|mostra|appare|compare)|kein(e|en)?|zeigt (nicht|kein)|gibt es kein)(?!\p{L})/iu;
/**
 * A prediction of how visitors, parents or customers will BEHAVE ("parents will move on", "visitors leave", "people get
 * confused", "customers hesitate", "it can stop the decision"). No website shows behaviour: without behavioural evidence
 * such a claim is never stored as business reality (EN / RO / IT / DE).
 */
const BEHAVIOUR = /(?<!\p{L})((vizitator\p{L}*|p[ăa]rin[țt]i\p{L}*|clien[țt]i\p{L}*|client(ul)? poten[țt]ial|oamenii|cineva|segment\p{L}*|visitors?|users?|people|customers?|clients?|parents|buyers?|visitatori|utenti|clienti|genitori|besucher|nutzer|kunden|eltern)[^.!?]{0,90}(plea?c\p{L}*|renun[țt]\p{L}*|ezit\p{L}*|abandon\p{L}*|trec\p{L}* mai departe|se reg[ăa]s\p{L}*|se recunoa\p{L}*|recogni[sz]e themselves|see themselves|nu (în)?[țt]eleg\p{L}*|confuz\p{L}*|nu au încredere|nu (pot|poate) (evalua|judeca|compara)|se r[ăa]zg[âa]nd\p{L}*|leave|bounce|skip|hesitate|abandon|get confused|be confused|won'?t trust|don'?t trust|go elsewhere|move on|drop off|convert|lasciano|abbandon\p{L}*|esitano|verlassen|springen ab|z[öo]gern)|(poate|pot) opri decizia|opre[șs]te decizia|stop the decision|pierzi clien\p{L}*|lose (the )?(sale|client|customer)s?|(poate|pot|ar putea)? ?atrag\p{L}* (mai mul[țt]i )?clien\p{L}*|(can|could|may|will) attract (more )?(clients|customers)|attracts? (more )?(clients|customers))(?!\p{L})/iu;
/** How customers ARRIVE ("clients come through…"): a fact the founder can declare, never a website-only reason an Aha matters. */
const ARRIVAL = /(?<!\p{L})(canal\p{L}* de achizi[țt]ie|acquisition channels?|ajung\p{L}* (prin|pe|din)|vin (prin|din)|arrives? (via|through|from)|come (via|through)|find (you|us|the studio) (via|through))(?!\p{L})/iu;
/**
 * Why an Aha matters must be stated, not guessed: any modal ("may", "can", "could", "poate", "ar putea", "semnalează")
 * turns it into speculation. Used ONLY on `matters` (in ordinary claims "the client can book online" is a fact).
 */
const MODAL = /(?<!\p{L})(poate|pot|ar putea|semnal\p{L}*|may|might|could|can|signals?|potrebbe|pu[òo]|kann|k[öo]nnte)(?!\p{L})/iu;
/**
 * A "why it matters" that needs data BB does not have: session duration, trainer time, utilisation, occupancy, demand
 * (EN / RO / IT / DE). Without that evidence the implication is premature: the fact stays an observation.
 */
const NEEDS_UNKNOWN = /(?<!\p{L})(acela[șs]i timp|aceea[șs]i durat\p{L}*|timp\p{L}* (al |de )?(antrenor|instructor|specialist)\p{L}*|per or[ăa]|pe or[ăa]|durat[ăa]\p{L}*|ocupar\p{L}*|cerer\p{L}*|utiliz\p{L}*|same (trainer )?time|per hour|trainer[- ]?(time|hours?)|duration|occupancy|utili[sz]ation|demand|stesso tempo|all'ora|occupazione|domanda|gleiche zeit|pro stunde|auslastung|nachfrage)(?!\p{L})/iu;

/** The business's own named things (offers, packages, locations) from what the synthesis read: the vocabulary that
 *  makes a "why it matters" specific to THIS business, and that numeric grounding uses to spot a borrowed number. */
export function businessEntities(u: GovernedUnderstanding | null | undefined): string[] {
  // The NAME of each listed offer: what comes before a dash / colon / parenthesis (the rest is often its price list),
  // split on commas for a list of names. A name never contains a digit (that is a price or a package, not an entity).
  const offers = clean(u?.offer?.explicit)
    .map((x) => x.split(/\s[—–-]\s|:|\(/)[0] ?? '')
    .flatMap((x) => x.split(/[,;·•]/))
    .map((x) => x.trim())
    .filter((x) => x.length >= 3 && x.split(/\s+/).length <= 6 && !/\d/.test(x));
  return [...new Set(offers)];
}

/** Unit-economics claims a website cannot support (value per client, profitability, margin, revenue leader). */
const ECONOMICS = /(?<!\p{L})(poten[țt]ial\p{L}* de venit|venit\p{L}* (per|pe) (or[ăa]|ședin[țt][ăa]|sedinta|specialist|client)|erod\p{L}*|revenue (potential|per (hour|session|client))|earning potential|erod(e|es|ing) (the )?revenue|costuri\p{L}*|acoper\p{L}* cost\p{L}*|the costs|its costs|operating costs|cover(s|ing)? (the )?costs|sustenabil\p{L}*|sustainable|break[- ]even|valoare (mai )?mare (per|pe) client|valoare mai mare|mai profitabil\p{L}*|profitabil\p{L}*|marj[ăa]\p{L}*|rentabil\p{L}*|venit(uri)? mai mar\p{L}*|aduc\p{L}* mai mul[țt]i bani|higher[- ]value|more profitable|profitab\p{L}*|margins?|lifetime value|LTV|CAC|revenue driver|most revenue|pi[ùu] redditiz\p{L}*|margine|rentabler|marge)(?!\p{L})/iu;
/** Speculation dressed as a finding ("could be", "might", "probably"). */
const SPECULATION = /(?<!\p{L})(ar putea|ar fi|pot fi|poate fi|probabil|could|might|may be|would likely|likely|probably|potrebbe|könnte|wahrscheinlich)(?!\p{L})/iu;
/** A strategic choice attributed to the founder ("you bet on", "you chose", "your strategy"). Only the founder can declare it. */
const FOUNDER_CHOICE = /(?<!\p{L})(pariezi|mizezi|ai ales|ai decis|strategia ta|alegerea ta|you bet|you'?re betting|you are betting|you chose|you have chosen|you decided|your strategy|scommetti|hai scelto|hai deciso|la tua strategia|du setzt auf|du hast (dich )?(entschieden|gew[äa]hlt)|deine strategie)(?!\p{L})/iu;

/**
 * MIXED SOURCE VOICE: one sentence that attributes a claim to the website AND speaks as the founder ("The site declares
 * that you serve…"). Website evidence is owned by the site ("The site says the studio…"), founder statements by the
 * founder ("You told me…"), BB's reading by BB ("From what I read, it seems…"); never two owners in one claim.
 */
const SITE_OWNER = /(?<!\p{L})(site-?ul|siteul|situl|pe site|pe sit|pagin(ile|a) (citit\p{L}*|site-ului)|the (web)?site|on the site|il sito|sul sito|die website|auf der website)(?!\p{L})/iu;
const FOUNDER_VOICE = /(?<!\p{L})(serve[șs]ti|oferi|ofere[șs]ti|e[șs]ti|vinzi|adresezi|lucrezi|ai|t[ăa]u|ta|tale|t[ăa]i|you|your|you're|yours|offri|sei|tuo|tua|du|dein\p{L}*|bietest)(?!\p{L})/iu;
export function mixesSourceVoice(text: string): boolean {
  return (text ?? '').split(/(?<=[.!?])\s+/).some((sentence) => SITE_OWNER.test(sentence) && FOUNDER_VOICE.test(sentence));
}

/** Booking or buying mechanics are conversion, not acquisition (how NEW customers first find the business). */
const BOOKING = /(?<!\p{L})(programar\p{L}*|programeaz\p{L}*|rezerv\p{L}*|recep[țt]i\p{L}*|book(ing|s)?|appointment|checkout|cart|co[șs]|aplica[țt]i\p{L}*|app|prenot\p{L}*|buch(ung|en))(?!\p{L})/iu;
const SITEMAP = /sitemap/i;
/** A conclusion added to an observation ("…, which suggests…"): the claim is then inferred, not observed (EN/RO/IT/DE). */
const INFERENCE = /(?<!\p{L})(which (means|suggests|implies|indicates|shows|discourages|encourages)|suggests?|implies|indicates?|probably|likely|ceea ce|sugereaz[ăa]|indic[ăa]|implic[ăa]|probabil|descurajeaz[ăa]|încurajeaz[ăa]|il che|suggerisce|probabilmente|was bedeutet|deutet|wahrscheinlich)(?!\p{L})/iu;

const clean = (xs: unknown): string[] => (Array.isArray(xs) ? xs : []).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
const BASES: readonly EvidenceBasis[] = ['observed', 'declared', 'inferred', 'contradicted'];

/**
 * What one page does NOT show, read as a fact about how the business is built ("therapy is invisible", "not in any
 * timetable"): a timetable that lists classes says nothing about appointments. Category confusion, never structure.
 */
const VISIBILITY = /(?<!\p{L})(invizibil\p{L}*|invisible|nu (se )?(vede|v[ăa]d|apare|apar)|nu (este|e|sunt) (listat|afi[șs]at|vizibil)\p{L}*|not (visible|shown|listed|displayed)|does(n't| not) (appear|show)|absent from|missing from|lipse[șs]te din|lipsesc din|în niciun(ul)? (orar|program)|in no (timetable|schedule)|not in any|nicio pagin\p{L}*|no page|non (appare|compare)|nicht (sichtbar|aufgef[üu]hrt)|nu (con[țt]in\p{L}*|includ\p{L}*|listeaz[ăa]|men[țt]ioneaz[ăa]|cuprind\p{L}*)|nici(o|un)(?!\p{L})|does(n'?t| not) (include|contain|list|mention)|contains? no|includes? no|lists? no|no other|non (include|contiene)|enth[äa]lt kein)(?!\p{L})/iu;
/** A trait of the customers (when they are free, what they prefer) read from a schedule or a service list: unsupported. */
const CUSTOMER_TRAIT = /(?<!\p{L})(segment\p{L}*|clien[țt]\p{L}*|mame|mamele|mothers|parents|p[ăa]rin[țt]i\p{L}*|people|oamenii|customers?|clients?)[^.!?;]{0,50}(disponibil\p{L}*|available|free in the|preferin[țt]\p{L}*|prefer\p{L}*|program fix|fixed schedule|lucreaz\p{L}*|working hours)(?!\p{L})/iu;
/** Demand, volume, occupancy or success read from footprint (a timetable, a team, a service list): never structure. */
const FOOTPRINT_INFERENCE = /(?<!\p{L})(cerere\p{L}*|cereri|demand|volum\p{L}*|volume|ocupa(re|t)\p{L}*|occupancy|plin\p{L}*|full|popular\p{L}*|succes\p{L}*|successful|aglomerat\p{L}*|busy|domanda|richiesta|nachfrage|ausgelastet)(?!\p{L})/iu;
/** A synthesis that overstates the structure ("three businesses under one name", "is really…"). */
const OVERCLAIM = /(?<!\p{L})((dou[ăa]|trei|patru|cinci|two|three|four|five|due|tre|quattro|zwei|drei|vier|\d+) (afaceri|business(es)?|business-uri|companii|firme|aziende|imprese|unternehmen|gesch[äa]fte)|de fapt|în realitate|in realitate|is really|are really|is actually|are actually|in realt[àa]|in wirklichkeit)(?!\p{L})/iu;
/** Strategy truths that fit thousands of businesses: never a structural reading unless tied to this business's own things. */
const GENERIC = /(?<!\p{L})(different (audiences|segments|customers) have different needs|segmente\p{L}* diferite (au|cu) nevoi diferite|pricing matters|pre[țt]ul conteaz[ăa]|retention (is|matters)|reten[țt]ia (este|e|conteaz)\p{L}*|focus (is|matters)|focusul (este|e|conteaz)\p{L}*|social proof|dovad[ăa] social[ăa]|multiple locations (add|create)|mai multe loca[țt]ii (adaug|creeaz|complic)\p{L}*|recurring revenue|venit\p{L}* recurent\p{L}*)(?!\p{L})/iu;
/**
 * A predicted state of the business, or a recommendation, from a hypothetical answer ("if most pay per session, revenue
 * is unpredictable and pricing deserves reconsideration"): a question's "why" says which decision the answer informs,
 * never what the answer would mean.
 */
const CONSEQUENCE = /(?<!\p{L})((venit\p{L}*|cash-?flow|revenue|income|fatturato|umsatz)[^.!?]{0,40}(impredictibil\p{L}*|unpredictable|instabil\p{L}*|unstable|volatil\p{L}*)|devin\p{L}* (principala )?prioritat\p{L}*|becomes? the (main |top )?priority|diventa la priorit\p{L}*|merit[ăa] (reconsiderat\p{L}*|regândit\p{L}*|schimbat\p{L}*)|deserves? (reconsideration|rethinking)|should be (reconsidered|changed|rethought)|se schimb[ăa] complet|change(s)? completely|ar trebui|you should|trebuie s[ăa] (schimbi|reconsideri|regânde[șs]ti)|dovresti|solltest)(?!\p{L})/iu;
/**
 * Kinds of explanation a structural alternative or a discriminating question can name (generic, EN / RO / IT / DE). Used
 * to keep an alternative from collapsing a multi-cause uncertainty into one cause, and to check that a question offers the
 * fork it is meant to settle. Negated mentions ("…, not a deliberate decision") do not count.
 */
const EXPLANATION_KINDS: [string, RegExp][] = [
  ['space', /(?<!\p{L})(spa[țt]i\p{L}*|sal[ăa]|s[ăa]li\p{L}*|camer\p{L}*|rooms?|space|premises|amenaj\p{L}*|configura\p{L}*|r[äa]um\p{L}*)(?!\p{L})/iu],
  ['equipment', /(?<!\p{L})(echipament\p{L}*|dot[ăa]r\p{L}*|aparat\p{L}*|equipment|tools?|devices?|attrezzatur\p{L}*|ausstattung|ger[äa]te?)(?!\p{L})/iu],
  ['staffing', /(?<!\p{L})(personal(ul|ului)?|echip(?!ament)\p{L}*|membr\p{L}*|specialist\p{L}*|terapeu\p{L}*|kinetoterapeu\p{L}*|instructor\p{L}*|antrenor\p{L}*|angaja\p{L}*|disponibilitat\p{L}*|staff\p{L}*|team|people|personnel|availability|hir(e|ing)|therapists?|trainers?|coach\p{L}*|personale|mitarbeiter\p{L}*)(?!\p{L})/iu],
  ['deliberate', /(?<!\p{L})(deliberat\p{L}*|inten[țt]ionat\p{L}*|alegere|alegeri|ales\p{L}*|decizi\p{L}*|pozi[țt]ion\p{L}*|strategi\p{L}*|specializ\p{L}*|specialis\p{L}*|choices?|chosen|chose|deliberate\p{L}*|intentional\p{L}*|positioning|decisions?|by design|scelta|entscheid\p{L}*|bewusst)(?!\p{L})/iu],
  ['timing', /(?<!\p{L})(temporar\p{L}*|istoric\p{L}*|recent\p{L}*|nou[ăa]?|test\p{L}*|pilot\p{L}*|lansa\p{L}*|temporary|historical|history|legacy|newly|trial|launch\p{L}*)(?!\p{L})/iu],
  ['representation', /(?<!\p{L})(nelistat\p{L}*|neafi[șs]at\p{L}*|programare individual\p{L}*|la cerere|by appointment|on request|unlisted|incomplet\p{L}*|nepublicat\p{L}*|not (yet )?published)(?!\p{L})/iu],
  ['demand', /(?<!\p{L})(cerer\p{L}*|demand|interes\p{L}*|segment\p{L}*|nevoi\p{L}*|needs|domanda|nachfrage)(?!\p{L})/iu],
];
const NEGATED = /(?<!\p{L})(nu|not|non|rather than|instead of|mai degrab[ăa] dec[âa]t|în loc de|statt)(?!\p{L})[^.,;:!?]*/giu;
/** The explanation kinds a text names, ignoring negated mentions and the business's own named things. */
function kindsOf(text: string, names: readonly string[] = []): Set<string> {
  let t = ` ${text ?? ''} `.replace(NEGATED, ' ');
  for (const n of names) if (n.trim().length >= 3) t = t.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), ' ');
  return new Set(EXPLANATION_KINDS.filter(([, re]) => re.test(t)).map(([k]) => k));
}
/**
 * A question that presupposes a future the founder never asked for (expanding, adding, fixing, improving, removing,
 * introducing, "what would have to change"): it steers instead of telling two readings apart.
 */
const PRESUPPOSES = /(?<!\p{L})(ce ar trebui|ce trebuie s[ăa] se schimbe|what would (it take|have to change)|what needs to change|extinde\p{L}*|extinz\p{L}*|extinder\p{L}*|extins\p{L}*|extended|expand\p{L}*|expansion|ad[ăa]ug\p{L}*|\badd(ing)?\b|introduc\p{L}*|îmbun[ăa]t[ăa][țt]\p{L}*|imbunatat\p{L}*|improv\p{L}*|repar\p{L}*|\bfix(ing)?\b|elimin\p{L}*|remov\p{L}*|planuri (s[ăa]|de)|plans? to|(poate|pot|ar putea) fi (schimbat|mutat|modificat)\p{L}*|can be (changed|moved)|could be (changed|moved)|inten[țt]ia de a|ar trebui|should|ampliar\p{L}*|aggiung\p{L}*|erweiter\p{L}*)(?!\p{L})/iu;
/**
 * A reversal condition about what the PAGES show ("if X appeared in the timetable / on the team page"). BB has already
 * read those pages: such a condition is either already true (then it contradicts the reading) or a change to the website,
 * not new evidence about the business. A reversal must be something the founder can answer or the business can show.
 */
/** An appearance verb: the condition is that something APPEARS (or would) in a source. */
const APPEARS = /(?<!\p{L})(apare|apar|ap[ăa]rea|ar ap[ăa]rea|appear\p{L}*|shows? up)(?!\p{L})/iu;
/** A passive listing: something IS / WOULD BE listed, displayed, published, mentioned or included (an auxiliary first).
 *  "the published timetable" (a participle used as an adjective) is not a condition. */
const LISTED = /(?<!\p{L})(este|e|ar fi|a fost|au fost|sunt|fi|is|are|was|were|be|been|being|gets?|got)\s+(\p{L}+\s+)?(listat\p{L}*|listed|afi[șs]at\p{L}*|displayed|publicat\p{L}*|published|men[țt]ionat\p{L}*|mentioned|inclus\p{L}*|included|shown)(?!\p{L})/iu;
/** The words a page condition is made of (stripped before judging whether the condition is already true). */
const SOURCE_CONDITION = /(?<!\p{L})(apare|apar|ap[ăa]rea|ar ap[ăa]rea|appear\p{L}*|listat\p{L}*|listed|afi[șs]at\p{L}*|publicat\p{L}*|published|displayed|shown on|men[țt]ionat\p{L}*|mentioned on|inclus\p{L}* (în|pe)|included (in|on))(?!\p{L})/iu;
/** A page condition DEPENDS on something appearing / being listed in a source; merely mentioning a page does not. */
const isPageCondition = (clause: string): boolean => { const c = clause.replace(NEGATED_APPEARANCE, ' '); return APPEARS.test(c) || LISTED.test(c); };
/** An arbitrary threshold ("most clients", "over 30%") the evidence does not give. */
const THRESHOLD = /(\d+\s*%|(?<!\p{L})(percent|procent\p{L}*|per ?cent|majoritat\p{L}*|majority|most of (the )?(clients|customers)|cei mai mul[țt]i clien\p{L}*)(?!\p{L}))/iu;
/** A presence condition: something exists / works / is available somewhere. */
const PRESENCE = /(?<!\p{L})(exist\p{L}*|exists?|there (is|are)|lucreaz\p{L}* (la|și la|si la)|works? at|is (also )?at|este (și )?la|e la|disponibil\p{L}* (și )?la|available at|are (un|o|și)|has an?|includ\p{L}*|includes?)(?!\p{L})/iu;
const NEGATED_APPEARANCE = /(?<!\p{L})(nu|not|n't|never|niciodat[ăa]|nicht)\s+(\p{L}+\s+)?(apar\p{L}*|ap[ăa]rea|appear\p{L}*|listat\p{L}*|listed|afi[șs]at\p{L}*|publicat\p{L}*|published|displayed|men[țt]ionat\p{L}*|inclus\p{L}*|included)(?!\p{L})/giu;
/**
 * An evaluative judgement about how the business performs (under-utilised, below potential, strong / weak demand, higher
 * value, better economics). Unsupported without performance evidence: it may not live in ANY stored field, shown or not.
 */
const JUDGEMENT = /(?<!\p{L})(sub-?utiliz\p{L}*|subutiliz\p{L}*|under-?utili[sz]\p{L}*|underused|supra-?utiliz\p{L}*|over-?utili[sz]\p{L}*|over-?perform\p{L}*|under-?perform\p{L}*|supra-?perform\p{L}*|sub-?perform\p{L}*|poten[țt]ial\p{L}*|potential|below potential|untapped|neexploatat\p{L}*|nevalorificat\p{L}*|cerere (mare|mic[ăa]|slab[ăa]|puternic[ăa]|ridicat[ăa]|sc[ăa]zut[ăa]|nesatisf[ăa]cut[ăa])|(strong|weak|high|low|unmet) demand|valoare (mai )?(mare|mic[ăa]|ridicat[ăa])|higher[- ]value|lower[- ]value|(better|worse|stronger|weaker) economics|economie (mai )?(bun[ăa]|slab[ăa])|mai profitabil\p{L}*|less profitable|mai rentabil\p{L}*|performeaz[ăa] (mai )?(bine|slab|prost)|performs? (better|worse|poorly|well))(?!\p{L})/iu;
/** A catch-all option ("or something else", "another operational decision"): it names no explanation. */
const CATCH_ALL = /(?<!\p{L})(alt\p{L}* (decizi\p{L}*|motiv\p{L}*|constr[âa]ng\p{L}*|factor\p{L}*|cauz\p{L}*|limit\p{L}*)( operațional\p{L}*| operational\p{L}*)?|altceva|alt ceva|something else|another (\p{L}+ )?(reason|decision|factor|constraint)|other (\p{L}+ )?(reasons?|factors?|constraints?)|qualcos'altro|altro motivo|etwas anderes|anderer grund)(?!\p{L})/giu;
/** Mechanism attributes a synthesis may attach to a group of offers; each needs evidence for EVERY member it covers. */
const ATTRIBUTES: { name: string; claim: RegExp; evidence: RegExp; inline?: boolean }[] = [
  { name: 'evaluation first', claim: /(?<!\p{L})(evaluar\p{L}*|evaluation|assessment|consulta[țt]i\p{L}*|consultation|valutazion\p{L}*|bewertung|erstgespr[äa]ch)(?!\p{L})/iu, evidence: /(?<!\p{L})(evaluar\p{L}*|evaluation|assessment|consulta[țt]i\p{L}*|consultation|valutazion\p{L}*|bewertung|erstgespr[äa]ch)(?!\p{L})/iu },
  { name: 'packages', claim: /(?<!\p{L})(abonament\p{L}*|pachet\p{L}*|packages?|subscriptions?|memberships?|abbonament\p{L}*|pacchett\p{L}*|abo\p{L}*)(?!\p{L})/iu, evidence: /(?<!\p{L})(abon\.|abonament\p{L}*|pachet\p{L}*|packages?|subscriptions?|memberships?|abbonament\p{L}*|pacchett\p{L}*|abo\p{L}*)/iu },
  { name: 'single sessions', claim: /(?<!\p{L})(per ședin[țt][ăa]|ședin[țt][ăa] unic[ăa]|single sessions?|per session|drop-?in|singola sessione|einzelstunde)(?!\p{L})/iu, evidence: /(1 ședin[țt][ăa]|single session|per session|drop-?in|singola|einzel)/iu },
  { name: 'direct purchase', inline: true, claim: /(?<!\p{L})(direct\p{L}*|walk-?in|drop-?in|on the spot|fără programare|f[ăa]r[ăa] evaluare|without (an )?(appointment|assessment|evaluation))(?!\p{L})/iu, evidence: /(?<!\p{L})(direct\p{L}*|walk-?in|drop-?in|fără programare|without (an )?appointment|cump[ăa]r[ăa] online|buy online|add to cart|adaug[ăa] în co[șs])(?!\p{L})/iu },
  { name: 'timetable', claim: /(?<!\p{L})(orar\p{L}*|timetable|schedule\p{L}*|calendario|stundenplan)(?!\p{L})/iu, evidence: /(?<!\p{L})(orar\p{L}*|timetable|schedule\p{L}*|calendario|stundenplan)(?!\p{L})/iu },
];
/** Delivery / purchase mechanisms the fallback may name: only when a trusted page shows them. */
export type MechanismKind = 'group_timetable' | 'one_to_one' | 'paid_first_step' | 'packages';
const MECHANISMS: { kind: MechanismKind; test: (text: string) => boolean }[] = [
  { kind: 'group_timetable', test: (t) => (t.match(CLOCK) ?? []).length >= 3 && /(?<!\p{L})(grup\p{L}*|group|clas[ăae]\p{L}*|class\p{L}*|gruppo|gruppe|kurs\p{L}*)(?!\p{L})/iu.test(t) },
  { kind: 'one_to_one', test: (t) => /(?<!\p{L})(individual\p{L}*|one-to-one|1:1|unu-la-unu|personal training|private sessions?|privat\p{L}*|einzel\p{L}*)(?!\p{L})/iu.test(t) },
  { kind: 'paid_first_step', test: (t) => /(evaluar\p{L}*|evaluation|assessment|consulta[țt]i\p{L}*|consultation|valutazion\p{L}*|erstgespr[äa]ch)[\s\S]{0,250}?\d+\s*(lei|ron|eur|euro|€|\$|£|chf)/iu.test(t) },
  { kind: 'packages', test: (t) => /(?<!\p{L})(abon\.|abonament\p{L}*|pachet\p{L}*|packages?|memberships?|abbonament\p{L}*|pacchett\p{L}*)/iu.test(t) },
];
/** Function words and condition words that say nothing about the business (never evidence of "already true"). */
const REVERSAL_STOP = new Set(['dacă', 'daca', 'atunci', 'acest', 'aceasta', 'această', 'acolo', 'pentru', 'dintre', 'fiecare', 'ambele', 'locatie', 'locația', 'locatia', 'locatii', 'locațiile', 'locatiile', 'ipoteza', 'ipoteza', 'would', 'there', 'their', 'these', 'those', 'which', 'where', 'about', 'other', 'every', 'location', 'locations', 'reading', 'again', 'still', 'servicii', 'serviciu', 'services', 'service']);
/** An "operating model" named by audience or life stage, not by how it is sold, delivered, booked or priced. */
const AUDIENCE_MODEL = /(?<!\p{L})((programe|activit[ăa][țt]i|servicii|clase|linii?)\s+(specializate\s+|dedicate\s+)?(pentru|dedicate)\s+(mame|mamele|copii|copiilor|femei|gravide|seniori|adolescen\p{L}*|familii|v[âa]rstnici)|etape de via[țt][ăa]|life[- ]stages?|(programs?|activities|services|classes)\s+(dedicated\s+)?for\s+(mothers|children|kids|women|seniors|teens|families)|children'?s activities|activit[ăa][țt]i pentru copii|(program\p{L}*|linie|linia|segment\p{L}*)\s+(perinatal\p{L}*|prenatal\p{L}*|postnatal\p{L}*|postpartum|de maternitate|matern\p{L}*)|(perinatal|prenatal|postnatal|postpartum|maternity)\s+(programs?|lines?|segments?)|per (mamme|bambini)|f[üu]r (m[üu]tter|kinder))(?!\p{L})/iu;

/** How many items a sentence lists ("A, B, C and D" → 4). Six or more is a transcription of a page, not a relationship. */
const listItems = (t: string): number => (t ?? '').split(/,|·|•|\s(?:și|si|and|e|ed|und)\s/u).filter((x) => x.trim()).length;
/** Kept sentences back into text: a piece that ended a clause (";") now ends a sentence, and each one starts upper case. */
const joinSentences = (parts: string[]): string => parts.map((x) => x.trim().replace(/[;,:]$/, '.')).filter(Boolean).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');
const sentencesOf = (t: string): string[] => (t ?? '').split(/(?<=[.!?;])\s+/).map((x) => x.trim()).filter(Boolean);
const wordsOf = (s: string): string[] => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/**
 * Does a text mention a name? Word by word, allowing an inflected ending ("Kinetoterapie" is mentioned by "Kinetoterapia",
 * "kinetoterapiei"): each word of the name starts a word of the text, its last letter or two free.
 */
function mentions(text: string, name: string): boolean {
  const ws = wordsOf(text);
  return wordsOf(name).every((w) => {
    const stem = w.length > 6 ? w.slice(0, -2) : w.length > 4 ? w.slice(0, -1) : w;
    return ws.some((x) => x.startsWith(stem) && x.length <= w.length + 3);
  });
}
/** A sentence that states what BB does not know yet (an unknown, not a claim). */
const NOT_KNOWING = /(?<!\p{L})(nu [șs]tiu|nu [șs]tim|înc[ăa] nu ([șs]tiu|[șs]tim)|i do(n'?t| not) (yet )?know|we do(n'?t| not) (yet )?know|not yet clear|non (lo )?so|non sappiamo|wei[ßs] (ich )?(noch )?nicht)(?!\p{L})/iu;
/**
 * Count words are numbers too ("four slots" claims a count exactly like "4 slots"). Two to twelve in RO / EN / IT / DE;
 * never "one"/"un"/"una" (articles), "nouă" (also "new"), "sei" or "due" (an Italian verb, an English word).
 */
const NUMBER_WORDS: Record<string, number> = {
  doi: 2, două: 2, doua: 2, trei: 3, patru: 4, cinci: 5, șase: 6, sase: 6, șapte: 7, sapte: 7, opt: 8, zece: 10, unsprezece: 11, doisprezece: 12, douăsprezece: 12,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  tre: 3, quattro: 4, cinque: 5, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12,
  zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
};
const NUMBER_WORD = new RegExp(`(?<!\\p{L})(${Object.keys(NUMBER_WORDS).join('|')})(?!\\p{L})`, 'giu');
/** Count words become digits, except a count written exactly as a trusted page writes it ("două locații" when a page
 *  says "Două locații."): that is the page's own count, not BB's. */
const ABSTRACTION = /^\s*(etape|etapei|pa[șs]i|steps?|stages?|faze|phases?|modele|models?|linii|lines?|motoare|engines?|niveluri|levels?|moduri|ways?|c[ăa]i|paths?|logici|logics?|direc[țt]ii|directions?)$/iu;
const withNumberWords = (t: string, pages: string[]): string => t.replace(new RegExp(`${NUMBER_WORD.source}(\\s+\\p{L}+)?`, 'giu'), (m, w: string, next?: string) => {
  // "a two-step sale", "two operating models": BB's own structure words, not a count of things on a page.
  if (next && ABSTRACTION.test(next)) return m;
  const phrase = fold(m).replace(/\s+/g, ' ').trim();
  const stem = next ? phrase.slice(0, Math.max(phrase.indexOf(' ') + 4, phrase.length - 2)) : '';
  if (next && pages.some((p) => p.replace(/\s+/g, ' ').includes(stem))) return m;
  return `${String(NUMBER_WORDS[w.toLowerCase()] ?? w)}${next ?? ''}`;
});
/** A clock time ("09:00") written on a trusted page is a label, not a quantity. */
const CLOCK = /(?<!\d)([01]?\d|2[0-3])[:.][0-5]\d(?!\d)/g;
const withoutPageTimes = (t: string, pages: string[]): string => t.replace(CLOCK, (m) => (pages.some((p) => p.includes(m)) ? ' ' : m));
const CURRENCY = /^(lei|ron|eur|euro|usd|gbp|chf|lire|€|\$|£)$/i;
const tokens = (s: string): string[] => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/**
 * A number that is part of a NAME written on a trusted page ("Kinetoterapie posturală (copii 10–15 ani)"): grounded when
 * a window of four words around it, with at least two words, appears verbatim on that page. Never a price.
 */
function partOfQuotedName(text: string, n: number, quotes: string[]): boolean {
  const t = tokens(text);
  const qs = quotes.map((q) => ` ${tokens(q).join(' ')} `);
  for (let i = 0; i < t.length; i++) {
    if (Number(t[i]!.replace(',', '.')) !== n) continue;
    for (let s = Math.max(0, i - 3); s <= i; s++) {
      const w = t.slice(s, s + 4);
      if (w.length < 4 || w.some((x) => CURRENCY.test(x)) || w.filter((x) => /\p{L}/u.test(x)).length < 2) continue;
      if (qs.some((q) => q.includes(` ${w.join(' ')} `))) return true;
    }
  }
  return false;
}

/**
 * STRUCTURAL SYNTHESIS governance (2026-10-15). The model proposes what the business is and 0–3 structural hypotheses;
 * code keeps a hypothesis only when it is SYNTHESIS (≥ 2 anchored quotes from distinct facts, ≥ 2 business-model
 * dimensions, ≥ 2 of the business's own named things that the sources contain), SPECIFIC (not a generic strategy truth),
 * REVERSIBLE (an alternative explanation that is not a paraphrase, the unknown and question that would tell them apart,
 * and what would weaken or reverse it), DECISION-RELEVANT (a decision it informs, never a predicted outcome), and
 * EPISTEMICALLY CLEAN: hedging is allowed (it is a hypothesis), but no behaviour prediction, no unsupported economics, no
 * founder choice read from the website, no argument from what a page does not show, no comparison of two surfaces with
 * different purposes without a stated basis, and every number grounded (a counted list, an entity-tied number, or part
 * of a quoted name). Everything rejected is kept in the audit with its reason, never shown. Deterministic, generic.
 */
export function governStructure(
  raw: BusinessStructure | undefined,
  observations: readonly PageObservation[],
  ctx: { hasDeclared: boolean; trusted: (ref: string) => boolean; entities: string[] },
): BusinessStructure | undefined {
  if (!raw) return undefined;
  const audit: NonNullable<BusinessStructure['audit']>[number][] = [];
  const outcomes: StructureOutcome[] = [];
  const repairs: StructureRepairRequest[] = [];
  const pages = observations.filter((o) => ctx.trusted(o.ref)).map((o) => fold(o.text));
  const unsupportedClaim = (t: string): boolean => BEHAVIOUR.test(t) || ECONOMICS.test(t) || JUDGEMENT.test(t) || mixesSourceVoice(t) || makesUnlicensedClaim(t)
    || (!ctx.hasDeclared && FOUNDER_CHOICE.test(t));
  // The same discipline for every STORED reasoning field, shown or not (alternative, reversal, unknown, rationale): no
  // behaviour, economics, performance judgement, customer trait, founder choice or arbitrary threshold. Hedged mentions of
  // a possible cause ("local demand may explain it") stay; an evaluative claim ("strong demand", "under-utilised") does not.
  const storedFault = (t: string): string => BEHAVIOUR.test(t) || ECONOMICS.test(t) ? 'claims behaviour or economics'
    : JUDGEMENT.test(t) ? 'a performance judgement (under-utilised, potential, demand level, value) the evidence does not earn'
      : CUSTOMER_TRAIT.test(t) ? 'a customer trait read from footprint'
        : THRESHOLD.test(t) ? 'an arbitrary threshold the evidence does not give'
          : !ctx.hasDeclared && FOUNDER_CHOICE.test(t) ? 'a founder choice read from the website' : '';
  const brand = brandWords(observations, ctx.trusted);

  // ── The synthesis, SALVAGED before it is rejected. A list-shaped synthesis ("…combines: A, B and C") is governed item by
  // item: an item that names a model by audience, overstates, argues from absence, claims behaviour / economics or shows
  // an ungrounded number is dropped; the synthesis stands while at least two structural items remain. A sentence that
  // says what BB does not know yet is an unknown, not a claim. Only when no structural statement survives does it fall.
  const proposedSynthesis = (raw.synthesis ?? '').trim();
  let synthesis = proposedSynthesis;
  const synthesisFault = (part: string): string => isWebsiteHygiene(part) || isHousekeeping(part) ? 'about the website, not the business'
    : unsupportedClaim(part) ? 'claims behaviour, economics or a founder choice the sources cannot support'
      : OVERCLAIM.test(part) ? 'overstates the structure (more than the evidence earns)'
        : VISIBILITY.test(part) ? 'argues from what a page does not show'
          : AUDIENCE_MODEL.test(part) ? 'names an operating model by audience or life stage, not by how it is sold, delivered, booked or priced'
            : numbersIn(part).length && !groundNumbers([part], raw.synthesisNumbers, [], observations, ctx.entities, ctx.trusted).ok ? 'a number that is not grounded'
              : '';
  if (synthesis) {
    const salvage = salvageSynthesis(synthesis, synthesisFault);
    synthesis = salvage.text;
    if (!synthesis) audit.push({ item: proposedSynthesis, verdict: 'rejected', reason: `synthesis: ${salvage.removed.map((r) => `${r.reason}: "${r.part}"`).join(' | ') || 'no structural statement'}` });
    else if (salvage.removed.length) audit.push({ item: proposedSynthesis, verdict: 'kept', reason: `synthesis salvaged: ${salvage.removed.map((r) => `${r.reason}: "${r.part}"`).join(' | ')}` });
    outcomes.push({ candidate: 'synthesis', verdict: !synthesis ? 'rejected' : salvage.removed.length ? 'salvaged' : 'kept', removed: salvage.removed.map((r) => r.part), reasons: salvage.removed.map((r) => r.reason) });
  }
  // An attribute attached to a group of offers must hold for EACH member: unsupported members are removed from the group;
  // if none would remain, the attribute (not the synthesis) goes; only an unresolvable claim with nothing left fails it.
  if (synthesis) {
    const prop = checkAttributePropagation(synthesis, observations, ctx.trusted, brand);
    if (prop.failed.length) { audit.push({ item: synthesis, verdict: 'rejected', reason: `synthesis: "${prop.failed.join(', ')}" applied to a group none of whose members the evidence shows it for` }); synthesis = ''; }
    else if (prop.narrowed.length || prop.removed.length) {
      audit.push({ item: synthesis, verdict: 'kept', reason: `synthesis narrowed: ${[
        ...prop.narrowed.map((n) => `"${n.attribute}" is not grounded for ${n.member}`),
        ...prop.removed.map((r) => `"${r.attribute}" removed from "${r.subject}": ${r.reason}`),
      ].join('; ')}` });
      synthesis = prop.text;
    }
  }

  // ── Hypotheses, SALVAGED before they are rejected. Only the CORE rejects: no interpretation, fewer than two anchored
  // facts, fewer than two dimensions or named things, generic language, an unjustified cross-surface comparison. A pattern
  // sentence, a consequence clause, a reversal clause or an unverifiable count is removed and the rest re-evaluated; the
  // evidence carries the facts when the pattern empties. A REQUIRED field that empties (alternative, discriminating
  // unknown, reversal) gets ONE bounded repair request (the orchestrator calls the model for that field only, then
  // governs again); a field that was already repaired and still fails rejects the hypothesis.
  const kept: StructuralHypothesis[] = [];
  const trustedTexts = observations.filter((o) => ctx.trusted(o.ref)).map((o) => o.text);
  (raw.hypotheses ?? []).forEach((h, index) => {
    const proposedPattern = (h.pattern ?? '').trim();
    const proposedInterpretation = (h.interpretation ?? '').trim();
    const removed: string[] = [];
    const reasons: string[] = [];
    const repaired = new Set(h.repairedFields ?? []);
    const reject = (reason: string): void => {
      audit.push({ item: proposedInterpretation || proposedPattern, verdict: 'rejected', reason });
      outcomes.push({ candidate: index, verdict: 'rejected', removed, reasons: [...reasons, reason], ...(repaired.size ? { repairedFields: [...repaired] } : {}) });
    };
    if (!proposedInterpretation) { reject('no interpretation'); return; }
    if (isWebsiteHygiene(`${proposedPattern} ${proposedInterpretation}`) || isHousekeeping(`${proposedPattern} ${proposedInterpretation}`) || SITEMAP.test(`${proposedPattern} ${proposedInterpretation}`)) { reject('about the website, not the business'); return; }
    // Synthesis, not restatement: two distinct anchored facts, two dimensions, two of the business's own things.
    // Each named thing must be on a page and in the claim. Words every page title shares (a brand prefix such as
    // "<Brand> Studio") are not what distinguishes them: the claim may use the distinctive part alone.
    const named = [...new Set((h.between ?? []).map((x) => x.trim()).filter((x) => x.length >= 3))];
    const distinctive = (x: string): string => wordsOf(x).filter((w) => !brand.has(w)).join(' ');
    // A quote must be a verbatim span of a trusted page. Cited on the wrong page, it is re-attributed to the page that
    // really contains it (the quote is real; only the citation was wrong). A section heading that says WHICH location or
    // offer a line belongs to goes in `context` (or before " – "): kept only when it is on the same page, shortly before
    // the line, with no other named thing in between. Stitched or paraphrased quotes are dropped.
    const evidence = (h.evidence ?? []).flatMap((e) => {
      const a = anchorEvidence(e, observations, ctx.trusted, named.flatMap((n) => [fold(n), distinctive(n)]).filter((x) => x.length >= 3));
      return a ? [{ ...a, ...(e.surface && EVIDENCE_SURFACES.includes(e.surface) ? { surface: e.surface } : {}) }] : [];
    }).filter((e, i, all) => !all.some((x, j) => j < i && (fold(x.quote).includes(fold(e.quote)) || fold(e.quote).includes(fold(x.quote)))));
    if (evidence.length < 2) { reject('fewer than two distinct anchored facts: a restatement, not synthesis'); return; }
    const dimensions = [...new Set(h.dimensions ?? [])].filter((d) => MODEL_DIMENSIONS.includes(d));
    if (dimensions.length < 2) { reject('it connects fewer than two business-model dimensions'); return; }
    const compares = [...new Set(h.compares ?? [])].filter((s) => EVIDENCE_SURFACES.includes(s));
    if (compares.length >= 2 && !(h.comparisonBasis ?? '').trim()) { reject(`category confusion: it compares a ${compares[0]} with a ${compares[1]} without saying why they are comparable`); return; }
    // A count that does not recount is not shown: its sentences are judged like any other ungrounded number below.
    const proposedCounts = groundCounts(h.counts, observations, ctx.trusted);
    const counts = proposedCounts.ok ? proposedCounts : { ok: true, problems: [], values: [] as number[] };
    if (!proposedCounts.ok) { removed.push('counts'); reasons.push(`count not grounded: ${proposedCounts.problems.join('; ')}`); }
    // Sentence by sentence (as stage lines are): a sentence that argues from what a page does not show, transcribes a
    // schedule or a list, reads demand from footprint, claims behaviour / economics / a founder choice, or shows an
    // ungrounded number is DROPPED, and the rest is re-evaluated.
    const quotes = [...evidence.map((e) => e.quote), ...trustedTexts];
    const numbersOk = (sentence: string): boolean => {
      const numeric = withNumberWords(withoutPageTimes(sentence, trustedTexts), pages);
      const rest = numbersIn(numeric).filter((n) => !counts.values.includes(n) && !partOfQuotedName(numeric, n, quotes));
      return !rest.length || groundNumbers([numeric.replace(/\d+(?:[.,]\d+)?/g, (m) => (rest.includes(Number(m.replace(',', '.'))) ? m : ''))], h.numbers, h.calculations, observations, ctx.entities, ctx.trusted).ok;
    };
    const faultOf = (sentence: string): string => VISIBILITY.test(sentence) ? 'category confusion: it argues from what a page does not show'
      : (sentence.match(CLOCK) ?? []).length >= 3 ? 'a transcription of a schedule, not a relationship (the evidence carries the lines)'
        : listItems(sentence) >= 6 ? 'a transcription of a list, not a relationship (the evidence carries the items)'
        : FOOTPRINT_INFERENCE.test(sentence) ? 'reads demand, volume or occupancy from footprint'
          : CUSTOMER_TRAIT.test(sentence) ? 'reads a customer trait (availability, preference) from footprint'
        : unsupportedClaim(sentence) ? 'claims behaviour, economics or a founder choice the sources cannot support'
          : !numbersOk(sentence) ? 'a number that is not grounded' : '';
    const trimmed: string[] = [];
    const drop = (label: string, reason: string, part: string): void => { trimmed.push(`${label}: ${reason}: "${part}"`); removed.push(part); reasons.push(`${label}: ${reason}`); };
    const keep = (text: string, label: string): string => joinSentences(sentencesOf(text).filter((x) => { const r = faultOf(x); if (r) drop(label, r, x); return !r; }));
    // The pattern may empty: the anchored evidence then carries the facts. The interpretation is the core.
    const pattern = keep(proposedPattern, 'pattern');
    const interpretation = keep(proposedInterpretation, 'interpretation');
    if (!interpretation) { reject('the interpretation itself is unsupported'); return; }
    const claim = `${pattern} ${interpretation}`;
    const between = named.filter((x) => {
      const d = distinctive(x);
      return d.length >= 3 && pages.some((p) => mentions(p, d)) && mentions(fold(`${claim} ${evidence.map((e) => `${e.context ?? ''} ${e.quote}`).join(' ')}`), d);
    });
    if (between.length < 2) { reject('it names fewer than two of this business\'s own things (generic)'); return; }
    if (GENERIC.test(claim) && !between.some((x) => mentions(fold(interpretation), distinctive(x)))) { reject('generic strategy language'); return; }
    const storedTrim = (text: string, label: string): string => joinSentences(sentencesOf(text).filter((x) => { const r = storedFault(x); if (r) drop(label, r, x); return !r; }));
    // Required fields: a field that empties is REPAIRED once (not a reason to lose the hypothesis); a field already repaired
    // that still fails rejects it.
    const missing: { field: RepairableField; reason: string }[] = [];
    const require = (field: RepairableField, ok: boolean, reason: string): void => { if (!ok) missing.push({ field, reason }); };
    // Reversible: an alternative that is not a paraphrase and keeps the meaningful set of explanations open.
    const alternative = storedTrim((h.alternative ?? '').trim(), 'alternative');
    const altKinds = kindsOf(alternative, [...named, ...ctx.entities]);
    require('alternative', Boolean(alternative) && !sameInsight(alternative, interpretation, 0.6) && altKinds.size !== 1,
      !alternative ? 'no alternative explanation remains' : altKinds.size === 1 ? `the alternative collapses the uncertainty into one explanation (${[...altKinds][0]}) while others remain plausible` : 'the alternative restates the reading');
    const unknown = storedTrim((h.discriminator?.unknown ?? '').trim(), 'discriminating unknown');
    require('unknown', Boolean(unknown), 'no discriminating unknown remains');
    // A reversal is checked against the same trusted evidence, clause by clause: a clause that DEPENDS on something
    // appearing on a page, or that the pages already make true, is dropped; the rest stands.
    const reversalCheck = checkReversal((h.reversal ?? '').trim(), pages, brand);
    for (const d of reversalCheck.dropped) { removed.push(d.clause); reasons.push(`reversal: ${d.reason}`); }
    const reversal = storedTrim(reversalCheck.kept, 'reversal');
    require('reversal', Boolean(reversal), `no valid reversal remains${reversalCheck.dropped.length ? `: ${reversalCheck.dropped.map((d) => `${d.reason}: "${d.clause}"`).join(' | ')}` : ''}`);
    const needRepair = missing.filter((m) => !repaired.has(m.field));
    if (needRepair.length) {
      for (const m of needRepair) repairs.push({ index, field: m.field, reason: m.reason, surviving: { pattern, interpretation, alternative, unknown, reversal }, evidence: evidence.map((e) => ({ page: [e.page ?? e.ref, e.context].filter(Boolean).join(' · '), quote: e.quote })) });
      audit.push({ item: interpretation, verdict: 'rejected', reason: `awaiting repair of ${needRepair.map((m) => `${m.field} (${m.reason})`).join('; ')}` });
      outcomes.push({ candidate: index, verdict: 'awaiting repair', removed, reasons: [...reasons, ...needRepair.map((m) => `${m.field}: ${m.reason}`)] });
      return;
    }
    if (missing.length) { reject(`still invalid after repair: ${missing.map((m) => `${m.field} (${m.reason})`).join('; ')}`); return; }
    // Decision-relevant: the decision line, fork by fork ("decides whether A, or whether B"); a branch that predicts an
    // outcome, advises, judges performance or brings unlicensed framing is dropped. An empty line is not fatal: the
    // reading still stands, it simply names no decision of its own.
    const proposedWhy = (h.whyItMatters ?? '').trim();
    const branches = proposedWhy.split(/,?\s(?=(?:sau dac[ăa]|or whether|or if|o se|oder ob)\s)/iu);
    const licensedBy = `${pattern} ${interpretation} ${alternative}`;
    const whyFault = (t: string): boolean => BEHAVIOUR.test(t) || ECONOMICS.test(t) || CONSEQUENCE.test(t) || JUDGEMENT.test(t) || makesUnlicensedClaim(t)
      || FRAMING.some((f) => f.claim.test(t) && !f.license.test(licensedBy));
    const whyItMatters = !proposedWhy || whyFault(branches[0] ?? '') ? '' : branches.filter((b) => { const bad = whyFault(b); if (bad) drop('why it matters', 'an outcome, advice, performance judgement or unlicensed framing', b); return !bad; }).join(' ').replace(/\s*[,;]?\s*$/, '').trim().replace(/([^.!?])$/, '$1.');
    if (proposedWhy && !whyItMatters) { removed.push(proposedWhy); reasons.push('why it matters: an outcome, advice, performance judgement or unlicensed framing'); }
    const changes = [...new Set(h.changes ?? [])].filter((x) => STRATEGIC_DECISIONS.includes(x));
    if (kept.some((k) => sameInsight(k.interpretation, interpretation, 0.5))) { reject('the same reading as one already kept'); return; }
    if (kept.length >= 3) { reject('more than three: lower impact'); return; }
    const question = (h.discriminator?.question ?? '').trim();
    const why = question ? governRationale((h.discriminator.why ?? '').trim(), [question, interpretation, alternative]) : '';
    const comparisonBasis = storedTrim((h.comparisonBasis ?? '').trim(), 'comparison basis');
    kept.push({
      pattern, interpretation, alternative, reversal, whyItMatters, changes, dimensions, between, evidence,
      relationship: STRUCTURE_RELATIONSHIPS.includes(h.relationship) ? h.relationship : 'asymmetry',
      // A reading may stand without a question of its own (it then simply does not compete for a slot).
      discriminator: { unknown, question: question && !isWebsiteHygiene(question) ? question : '', ...(why ? { why } : {}) },
      ...(compares.length ? { compares } : {}), ...(comparisonBasis ? { comparisonBasis } : {}),
      ...(proposedCounts.ok && h.counts?.length ? { counts: h.counts } : {}), ...(h.numbers?.length ? { numbers: h.numbers } : {}), ...(h.calculations?.length ? { calculations: h.calculations } : {}),
      // Only the verdicts are stored with the hypothesis; the dropped clauses themselves live in the audit.
      reversalCheck: { checked: true, dropped: reversalCheck.dropped.map((d) => ({ reason: d.reason })) },
      ...(repaired.size ? { repairedFields: [...repaired] } : {}),
    });
    audit.push({ item: interpretation, verdict: 'kept', reason: `synthesis across facts, specific, reversible, decision-relevant${trimmed.length ? `; dropped sentences: ${trimmed.join(' | ')}` : ''}${reversalCheck.dropped.length ? `; dropped reversal clauses: ${reversalCheck.dropped.map((d) => `${d.reason}: "${d.clause}"`).join(' | ')}` : ''}` });
    outcomes.push({ candidate: index, verdict: repaired.size ? 'repaired' : removed.length ? 'salvaged' : 'kept', removed, reasons, ...(repaired.size ? { repairedFields: [...repaired] } : {}) });
  });
  return { synthesis, hypotheses: kept, mechanisms: verifiedMechanisms(observations, ctx.trusted), audit, outcomes, ...(repairs.length ? { repairs } : {}) };
}

/**
 * Salvage a synthesis part by part. A sentence with a list after a colon ("…combines several models: A, B and C") is
 * governed item by item: failing items are dropped and the list rejoined; the sentence stands while at least two items
 * remain (fewer is no longer a structure). A sentence without a list stands or falls whole. Sentences that say what BB
 * does not know yet are kept as they are. Nothing structural left → empty (the card's fallback takes over).
 */
export function salvageSynthesis(text: string, fault: (part: string) => string): { text: string; removed: { part: string; reason: string }[] } {
  const removed: { part: string; reason: string }[] = [];
  const out: string[] = [];
  for (const sentence of sentencesOf(text)) {
    if (NOT_KNOWING.test(sentence)) { out.push(sentence); continue; }
    const colon = depth0Index(sentence, ':');
    if (colon === -1) {
      const r = fault(sentence);
      if (r) removed.push({ part: sentence, reason: r }); else out.push(sentence);
      continue;
    }
    const lead = sentence.slice(0, colon + 1);
    const leadFault = fault(lead);
    if (leadFault) { removed.push({ part: sentence, reason: leadFault }); continue; }
    const body = sentence.slice(colon + 1).replace(/[.!?]\s*$/, '');
    const end = /[.!?]\s*$/.exec(sentence)?.[0]?.trim() ?? '.';
    const { items, conjunction } = splitListItems(body);
    // An item failing only on a number keeps its words without the number ("packages of 4–12 sessions" → "packages").
    const salvaged = items.map((item) => {
      const r = fault(item);
      if (!r) return item;
      if (/\d/.test(item)) { const bare = item.replace(NUMBER_PHRASE, '').replace(/\s{2,}/g, ' ').trim(); if (bare && !fault(bare)) { removed.push({ part: item, reason: `${r} (the number removed, the item kept)` }); return bare; } }
      removed.push({ part: item, reason: r });
      return '';
    });
    const keptItems = salvaged.filter(Boolean);
    if (keptItems.length === items.length && salvaged.every((x, i) => x === items[i])) { out.push(sentence); continue; }
    if (keptItems.length === items.length) { out.push(`${lead} ${rejoin(keptItems, conjunction)}${end}`); continue; }
    if (keptItems.length < 2) { if (items.length >= 2) removed.push({ part: sentence, reason: 'fewer than two structural items remain' }); else if (!fault(sentence)) out.push(sentence); continue; }
    out.push(`${lead} ${rejoin(keptItems, conjunction)}${end}`);
  }
  const structural = out.filter((x) => !NOT_KNOWING.test(x));
  return { text: structural.length ? out.join(' ') : '', removed };
}

/** Items back into a list: "A, B and C" (a contrast item keeps its own comma inside). */
const rejoin = (items: string[], conjunction: string): string => (items.length === 1 ? items[0]! : `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`);
const CONTRAST = /^\s*(în timp ce|in timp ce|iar|dar|însă|insa|while|whereas|but|mentre|ma|während|aber)(?!\p{L})/iu;
/** A number phrase ("de 4–12 ședințe", "of 3 sessions"): salvage removes it from an item before dropping the item. */
const NUMBER_PHRASE = /\s*(?:(?:de|of|cu|with|din|from|da|von)\s+)?\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(?:%|\p{L}+)?/gu;
/** Index of a character outside parentheses, or -1. */
function depth0Index(text: string, ch: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1); else if (c === ch && depth === 0) return i;
  }
  return -1;
}
/**
 * The items of a list: split on commas outside parentheses; the last segment also on its final " and / și / e / und "
 * when what follows is an item of its own (two words or more), as lists are written ("A, B and C").
 */
function splitListItems(body: string): { items: string[]; conjunction: string } {
  const parts: string[] = [];
  let depth = 0; let from = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1); else if ((c === ',' || c === ';') && depth === 0) { parts.push(body.slice(from, i)); from = i + 1; }
  }
  parts.push(body.slice(from));
  let conjunction = 'și';
  const last = parts.pop() ?? '';
  const depthAt = (t: string, at: number): number => [...t.slice(0, at)].reduce((d, c) => (c === '(' ? d + 1 : c === ')' ? Math.max(0, d - 1) : d), 0);
  const conj = [...last.matchAll(/\s(și|si|and|e|und)\s/giu)].filter((m) => depthAt(last, m.index!) === 0).pop();
  if (conj && last.slice(conj.index! + conj[0].length).trim().split(/\s+/).length >= 2 && last.slice(0, conj.index!).trim()) {
    conjunction = conj[1]!;
    parts.push(last.slice(0, conj.index!), last.slice(conj.index! + conj[0].length));
  } else parts.push(last);
  // "A, while B" is ONE contrast, not two items: a segment opening with a contrast connector stays with the one before.
  const merged: string[] = [];
  for (const part of parts) {
    if (merged.length && CONTRAST.test(part)) merged[merged.length - 1] = `${merged[merged.length - 1]},${part}`;
    else merged.push(part);
  }
  return { items: merged.map((x) => x.replace(/^\s*(și|si|and|e|und)\s+/iu, '').trim()).filter(Boolean), conjunction };
}

/**
 * One piece of structural evidence, anchored: the quote verbatim on its cited page, else on another trusted page; or a
 * "<heading> – <line>" / {context: heading} pair where the line is verbatim, the heading is verbatim on the SAME page within
 * 400 characters before it, and no other named thing of the hypothesis stands between them (else the heading would not be
 * the line's section).
 */
function anchorEvidence(
  e: { ref?: string; quote?: string; context?: string },
  observations: readonly PageObservation[],
  trusted: (ref: string) => boolean,
  names: string[],
): (ClaimEvidence & { context?: string }) | undefined {
  const pages = observations.filter((o) => trusted(o.ref));
  const direct = (quote: string): ClaimEvidence | undefined => {
    const cited = trusted(e.ref ?? '') ? anchorClaimEvidence([{ ref: e.ref, quote }], observations)[0] : undefined;
    return cited ?? pages.map((o) => anchorClaimEvidence([{ ref: o.ref, quote }], observations)[0]).find(Boolean);
  };
  const quote = (e.quote ?? '').trim();
  const split = /^(.{3,80}?)\s+[–—-]\s+(.+)$/su.exec(quote);
  const label = (e.context ?? '').trim() || (split ? split[1]!.trim() : '');
  const plain = direct(quote);
  if (plain && !label) return plain;
  const line = (e.context ?? '').trim() ? plain : split ? direct(split[2]!.trim()) : undefined;
  if (!line) return plain;
  if (!label) return line;
  const page = observations.find((o) => o.ref === line.ref);
  const text = fold(page?.text ?? '').replace(/\s+/g, ' ');
  const at = text.indexOf(fold(line.quote).replace(/\s+/g, ' '));
  const fl = fold(label).replace(/\s+/g, ' ');
  const from = at === -1 ? -1 : text.lastIndexOf(fl, at);
  if (from === -1 || at - (from + fl.length) > 400) return plain;
  const between = text.slice(from + fl.length, at);
  if (names.some((n) => !fl.includes(n) && between.includes(n))) return plain;
  return { ...line, context: label };
}

/**
 * Fact-check a reversal condition clause by clause against the pages BB read. A clause about what the pages show
 * ("if X appeared in the timetable / team") is dropped: when every business word it names already appears together on one
 * trusted page it is ALREADY TRUE (and contradicts the reading); otherwise it is a website change, not new evidence.
 * What remains must be something the founder can answer or the business can show.
 */
export function checkReversal(reversal: string, pages: readonly string[], brand: ReadonlySet<string> = new Set()): { kept: string; dropped: { clause: string; reason: string }[] } {
  const dropped: { clause: string; reason: string }[] = [];
  // Business words, inflection-tolerant ("kinetoterapia" ~ "Kinetoterapeut"): stems of 5+ letter words found on a page.
  const stem = (w: string): string => (w.length > 7 ? w.slice(0, -3) : w.length > 5 ? w.slice(0, -2) : w);
  const PRESENCE_WORDS = new Set(['exista', 'exist', 'exists', 'there', 'lucreaza', 'works', 'work', 'include', 'includes', 'listeaza', 'lists', 'este', 'sunt', 'have', 'altul', 'alta', 'another', 'other', 'inca', 'still', 'fapt', 'fact', 'daca',
    // surfaces, not business things: "…who is not in the timetable" is about the page
    'orar', 'orarul', 'orarului', 'timetable', 'schedule', 'pagina', 'page', 'site', 'siteul', 'website', 'lista', 'list', 'publicat', 'published', 'afara', 'outside',
    // function words that also appear on every page
    'care', 'unde', 'cand', 'prin', 'intr', 'dupa', 'fara', 'pentru', 'acolo', 'aici', 'doar', 'chiar', 'which', 'that', 'with', 'from', 'into', 'also', 'only', 'even', 'then', 'than', 'this', 'these', 'those', 'more', 'most', 'they', 'them', 'their', 'here', 'when', 'where', 'what', 'who']);
  const vocabulary = (w: string): boolean => w.length >= 5 && !brand.has(w) && !REVERSAL_STOP.has(w) && pages.some((p) => p.includes(stem(w)));
  // A new condition starts at every "or if" and at every further "if" ("If A, if B." is two conditions).
  const clauses = sentencesOf(reversal).flatMap((x) => x.split(/;\s*|,?\s(?:sau|or|ori|oppure|oder)\s(?=(?:dac[ăa]|if|se|wenn)\s)|(?<=\S),?\s+(?=(?:dac[ăa]|if|wenn)\s)/iu)).map((x) => x.trim()).filter(Boolean);
  // Presence claims ("if there is another X at Y", "if X works at Y") are checked like page conditions: when the pages
  // already show X at Y (the business words co-occur on one page), the condition is already true. Short proper names
  // (four letters) count here: a location is often named in two short words.
  const presenceWords = (clause: string): string[] => [...new Set(wordsOf(clause).filter((w) => w.length >= 4 && !brand.has(w) && !REVERSAL_STOP.has(w) && !PRESENCE_WORDS.has(w) && pages.some((p) => p.includes(stem(w)))).map(stem))];
  // Together = within one section of a page (300 characters either side), never merely somewhere on the same page: two
  // locations' timetables share a page without the people of one working at the other.
  const together = (words: string[]): boolean => pages.some((p) => {
    for (let at = p.indexOf(words[0]!); at !== -1; at = p.indexOf(words[0]!, at + 1)) {
      const section = p.slice(Math.max(0, at - 300), at + 300);
      if (words.every((w) => section.includes(w))) return true;
    }
    return false;
  });
  const kept = clauses.filter((clause) => {
    if (PRESENCE.test(clause) && !isPageCondition(clause)) {
      const words = presenceWords(clause.replace(NEGATED_APPEARANCE, ' '));
      if (words.length >= 2 && together(words)) { dropped.push({ clause, reason: 'already true in the pages BB read (its business words appear together on one page)' }); return false; }
      return true;
    }
    // "…appointments that do not appear in the timetable" DESCRIBES the page (the fact itself is about the business);
    // only a condition that something WOULD appear / be listed is a page condition.
    if (!isPageCondition(clause)) return true;
    const words = [...new Set(wordsOf(clause.replace(new RegExp(SOURCE_CONDITION.source, 'giu'), ' ')).filter(vocabulary).map(stem))];
    const alreadyTrue = words.length >= 2 && together(words);
    dropped.push({ clause, reason: alreadyTrue ? 'already true in the pages BB read (its business words appear together on one page)' : 'about what the pages show, not new evidence about the business' });
    return false;
  });
  // Nothing dropped: the reversal stands exactly as written (its own "or" kept). Otherwise the surviving conditions.
  if (!dropped.length) return { kept: reversal.trim(), dropped };
  const text = kept.map((x) => x.replace(/[.;,]\s*$/, '')).join('; ').trim();
  return { kept: text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : '', dropped };
}

/** Words most page titles share ("<Brand> Studio"): never what distinguishes one named thing from another. */
export function brandWords(observations: readonly PageObservation[], trusted: (ref: string) => boolean): Set<string> {
  const titles = observations.filter((o) => trusted(o.ref)).map((o) => new Set(wordsOf(`${o.title ?? ''} ${o.ref}`)));
  return new Set([...new Set(titles.flatMap((t) => [...t]))].filter((w) => titles.length >= 3 && titles.filter((t) => t.has(w)).length >= titles.length * 0.6));
}

/**
 * ATTRIBUTE PROPAGATION: a synthesis groups several offers ("one-to-one services (A, B, C), which start with a paid
 * evaluation") and attaches a mechanism to the group. The attribute must be grounded for EACH member: on the member's own
 * page when it has one (a page titled with its name), else within the section around its mention. Members it is not
 * grounded for are removed from the group (the subject narrows); if none would remain, the attribute fails.
 */
export function checkAttributePropagation(synthesis: string, observations: readonly PageObservation[], trusted: (ref: string) => boolean, brand: ReadonlySet<string>): { text: string; narrowed: { member: string; attribute: string }[]; failed: string[]; removed: { subject: string; attribute: string; reason: string }[] } {
  const narrowed: { member: string; attribute: string }[] = [];
  const failed: string[] = [];
  const removed: { subject: string; attribute: string; reason: string }[] = [];
  const pages = observations.filter((o) => trusted(o.ref));
  const families = offerFamilies(observations, trusted, brand);
  // The words the business's own offer pages use: an entry of a parenthesised list is a MEMBER only when every one of its
  // significant words is offer vocabulary ("Kinetoterapie", "planșeu pelvin"); a description ("delivered as a group")
  // is not a member.
  const vocabulary = families.map((f) => fold(f.page.text)).join(' ');
  const isMember = (entry: string): boolean => { const ws = significant(entry, brand); return ws.length > 0 && ws.every((w) => vocabulary.includes(stemOf(w))); };
  const grounded = (member: string, evidence: RegExp): boolean => {
    const words = wordsOf(member).filter((w) => w.length >= 5 && !brand.has(w));
    if (!words.length) return true; // nothing to check it against: not a named offer
    const stems = words.map((w) => (w.length > 6 ? w.slice(0, -2) : w.slice(0, -1)));
    const own = pages.filter((o) => stems.some((st) => fold(`${o.title ?? ''} ${o.ref}`).includes(st)));
    if (own.length) return own.some((o) => evidence.test(o.text));
    return pages.some((o) => {
      const t = fold(o.text);
      for (let at = t.indexOf(stems[0]!); at !== -1; at = t.indexOf(stems[0]!, at + 1)) if (evidence.test(o.text.slice(Math.max(0, at - 250), at + 250))) return true;
      return false;
    });
  };
  // Each parenthesised group: its members, and the attribute text around it (the list item it sits in plus any relative
  // clause inside the parentheses).
  const text = synthesis.replace(/\(([^()]+)\)/g, (whole, inner: string, offset: number) => {
    const before = synthesis.slice(0, offset);
    // The list item the group sits in starts after the last separator (":", ";", ",", " and " / " și " / " e " / " und ").
    const seps = [...before.matchAll(/[:;,]|\s(?:și|si|and|e|und)\s/gu)];
    const lastSep = seps.length ? seps[seps.length - 1]! : null;
    const itemStart = lastSep ? lastSep.index! + lastSep[0].length : 0;
    const afterRaw = synthesis.slice(offset + whole.length);
    const itemEnd = afterRaw.search(/,|;|\.(\s|$)|\s(și|si|and|e|und)\s/u);
    // Members come before the first relative clause ("…, which start with …"); the clause is kept whole, as written.
    const rel = /,\s*(care|ce|which|that|who|che|die|der|das)\s/iu.exec(inner);
    const relativeText = rel ? inner.slice(rel.index + 1).trim() : '';
    const members = (rel ? inner.slice(0, rel.index) : inner).split(/,|\s(?:și|si|and|e|und)\s/u).map((x) => x.trim()).filter(Boolean).filter(isMember);
    const relative = relativeText ? [relativeText] : [];
    if (!members.length) return whole;
    const attributeText = `${before.slice(itemStart)} ${relative.join(' ')} ${itemEnd === -1 ? afterRaw : afterRaw.slice(0, itemEnd)}`;
    let keep = members;
    for (const a of ATTRIBUTES) {
      if (!a.claim.test(attributeText)) continue;
      const ok = keep.filter((m) => grounded(m, a.evidence));
      for (const m of keep) if (!ok.includes(m)) narrowed.push({ member: m, attribute: a.name });
      if (!ok.length) failed.push(a.name);
      keep = ok;
    }
    if (keep.length === members.length) return whole;
    return keep.length ? `(${keep.join(', ')}${relativeText ? `, ${relativeText}` : ''})` : whole;
  });

  // ABSTRACT GROUPS ("individual clinical services, which start with a paid evaluation"): the protection must not depend
  // on the model listing members. Each list item without a member list that attaches an attribute is resolved to the
  // business's offer families: the families it NAMES, else the families whose own page carries every descriptor word of
  // the category. The attribute must hold on each covered family's page. All hold → kept. Some → the category is narrowed
  // by naming those families. None, or the category cannot be resolved → the shared attribute is removed.
  // Without priced offer pages there is nothing to resolve a category against: the explicit check above is all there is.
  if (!families.length) return { text, narrowed, failed, removed };
  const out = sentencesOf(text).map((sentence) => {
    if (NOT_KNOWING.test(sentence)) return sentence;
    const items = sentence.split(/(?<=[:;])|,(?![^()]*\))/u);
    return items.map((item) => {
      if (/\(/.test(item)) return item;
      // A continuation ("which works as a first step…", "while…") belongs to the item before it: not a category.
      if (/^\s*(care|ce|which|that|who|che|die|der|das|iar|dar|însă|while|whereas|but|în timp ce|ceea ce)(?!\p{L})/iu.test(item)) return item;
      const claimed = ATTRIBUTES.filter((a) => a.claim.test(item));
      if (!claimed.length) return item;
      const cut = Math.min(...[
        item.search(/\s(care|ce|which|that|who|che|die|der|das)\s/iu),
        item.search(/\s(cu|with|con|mit|prin|through|via)\s/iu),
        ...claimed.map((a) => item.search(a.claim)),
      ].filter((i) => i > 0));
      if (!Number.isFinite(cut)) return item;
      const subject = item.slice(0, cut);
      // The attribute IS the category's own name ("scheduled classes"): nothing is attached to a group.
      if (!significant(subject, brand).length) return item;
      const named = families.filter((f) => significant(f.name, brand).some((w) => mentions(fold(subject), w)));
      const descriptors = significant(subject, brand).filter((w) => !GENERIC_CATEGORY.has(w));
      const covered = named.length ? named
        : descriptors.length ? families.filter((f) => descriptors.every((d) => fold(f.page.text).includes(stemOf(d)))) : [];
      // An inline attribute word ("booked DIRECTLY from the timetable") goes alone; a clause attribute ("which start with a
      // paid evaluation") goes with its tail.
      // Only the attributes that actually fail are removed. An inline attribute word ("booked DIRECTLY from the timetable")
      // goes alone; a clause attribute ("which start with a paid evaluation") goes with its tail.
      const failing = (fams: typeof families): typeof claimed => claimed.filter((x) => !fams.length || !fams.every((f) => x.evidence.test(f.page.text)));
      const drop = (reason: string, fams: typeof families = covered): string => {
        const bad = failing(fams);
        for (const a of bad) removed.push({ subject: subject.trim(), attribute: a.name, reason });
        return bad.length && bad.every((x) => x.inline)
          ? bad.reduce((t, x) => t.replace(new RegExp(x.claim.source, 'iu'), ''), item).replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1')
          : subject.replace(/\s+$/, '');
      };
      if (!covered.length) return drop('the category cannot be resolved to the business\'s offers, so no shared attribute can be verified');
      let keep = covered;
      for (const a of claimed) keep = keep.filter((f) => a.evidence.test(f.page.text));
      if (keep.length === covered.length) return item;
      if (!keep.length) return drop(`no offer the category covers shows ${claimed.map((a) => a.name).join(', ')}`);
      if (named.length) return drop(`${covered.filter((f) => !keep.includes(f)).map((f) => f.name).join(', ')} does not show ${claimed.map((a) => a.name).join(', ')}`);
      for (const f of covered) if (!keep.includes(f)) for (const a of claimed) narrowed.push({ member: f.name, attribute: a.name });
      return `${subject.replace(/\s+$/, '')} (${keep.map((f) => f.name).join(', ')})${item.slice(cut)}`;
    }).join(',').replace(/:,/g, ':').replace(/;,/g, ';');
  }).join(' ');
  return { text: out, narrowed, failed, removed };
}

/** Words that name a kind of thing, not which offers ("services", "programmes", "sessions"): never a category descriptor. */
const GENERIC_CATEGORY = new Set(['servicii', 'serviciile', 'serviciu', 'services', 'service', 'programe', 'programele', 'programs', 'programmes', 'oferte', 'oferta', 'offers', 'linii', 'lines', 'modele', 'models', 'sesiuni', 'sessions', 'sedinte', 'sedintele', 'activitati', 'activities', 'servizi', 'programmi', 'leistungen', 'angebote', 'rezervate', 'rezervat', 'booked', 'vandute', 'sold', 'livrate', 'delivered', 'distincte', 'distinct', 'separate', 'principal', 'principale']);
const stemOf = (w: string): string => w.slice(0, Math.max(4, w.length - 3));
const significant = (text: string, brand: ReadonlySet<string>): string[] => wordsOf(text).filter((w) => w.length >= 5 && !brand.has(w));
/** The business's offer families: trusted pages that carry prices, named by their title (without the site name). */
export function offerFamilies(observations: readonly PageObservation[], trusted: (ref: string) => boolean, brand: ReadonlySet<string>): { name: string; page: PageObservation }[] {
  return observations
    .filter((o) => trusted(o.ref) && /\d+\s*(lei|ron|eur|euro|€|\$|£|chf)(?!\p{L})/iu.test(o.text))
    .map((o) => ({ name: ((o.title ?? '').trim() || o.ref).split(/\s+[-–|·]\s+/)[0]!.trim(), page: o }))
    .filter((f) => significant(f.name, brand).length > 0);
}

/** The fallback's verified mechanisms: delivery or purchase mechanisms a trusted page actually shows. */
export function verifiedMechanisms(observations: readonly PageObservation[], trusted: (ref: string) => boolean): { kind: MechanismKind; ref: string }[] {
  const out: { kind: MechanismKind; ref: string }[] = [];
  for (const m of MECHANISMS) {
    const page = observations.find((o) => trusted(o.ref) && !SITEMAP.test(o.url ?? '') && m.test(o.text));
    if (page) out.push({ kind: m.kind, ref: page.ref });
  }
  return out;
}

/**
 * Does a question settle a hypothesis's fork? It must name one of the things the hypothesis is about and offer at least
 * two explanations, at least one of them from the alternative ("deliberate, or caused by rooms, equipment or
 * availability?"). "Demand, or because one person works there?" offers neither side of the actual fork.
 */
function settlesFork(question: string, h: StructuralHypothesis, names: readonly string[], brand: ReadonlySet<string> = new Set()): { ok: boolean; offers: string[] } {
  const q = fold(question);
  const named = h.between.some((b) => { const d = wordsOf(b).filter((w) => !brand.has(w)).join(' '); return d.length >= 3 && mentions(q, d); });
  // A catch-all ("or another operational decision", "or something else") names no explanation: it does not count.
  const offers = [...kindsOf(question.replace(CATCH_ALL, ' '), names)];
  const alt = kindsOf(h.alternative, names);
  const fromAlternative = [...alt].some((k) => offers.includes(k));
  // The reading's side of the fork: a deliberate choice, or a kind the reading names that the alternative does not.
  const reading = [...kindsOf(h.interpretation, names)].filter((k) => !alt.has(k));
  const fromReading = offers.includes('deliberate') || reading.some((k) => offers.includes(k));
  return { ok: named && offers.length >= 2 && fromAlternative && fromReading, offers };
}

/**
 * Business framing a rationale may only use when the question it explains (or its hypothesis) licenses it: "or whether
 * one location is simply smaller" invents a size reading nobody asked about. Each family: the framing words, and the words
 * in the question / hypothesis that license them.
 */
const FRAMING: { name: string; claim: RegExp; license: RegExp }[] = [
  { name: 'size', claim: /(?<!\p{L})(mai mic\p{L}*|mai mari?|smaller|bigger|larger|m[ăa]rime|dimensiun\p{L}*|size|scal[ăae]\p{L}*|scale|pi[ùu] piccol\p{L}*|kleiner|gr[öo][ßs]er)(?!\p{L})/iu, license: /(?<!\p{L})(mai mic\p{L}*|mai mari?|smaller|bigger|larger|m[ăa]rime|dimensiun\p{L}*|size|scal[ăae]\p{L}*|scale|c[âa][țt]i|c[âa]te|how many|num[ăa]r\p{L}*)(?!\p{L})/iu },
  { name: 'utilisation', claim: /(?<!\p{L})(utiliz\p{L}*|neutiliz\p{L}*|nefolosit\p{L}*|unused|idle|ocupa\p{L}*|occupan\p{L}*|pline|full|locuri libere|spare capacity|capacitate liber\p{L}*|auslast\p{L}*)(?!\p{L})/iu, license: /(?<!\p{L})(utiliz\p{L}*|ocupa\p{L}*|occupan\p{L}*|pline|full|locuri|spots?|places?|capacit\p{L}*)(?!\p{L})/iu },
  { name: 'maturity', claim: /(?<!\p{L})(matur\p{L}*|consacrat\p{L}*|established|în cre[șs]tere|growing|în declin|declining|stagn\p{L}*)(?!\p{L})/iu, license: /(?<!\p{L})(matur\p{L}*|cre[șs]t\p{L}*|grow\p{L}*|declin\p{L}*|stagn\p{L}*|ultimele|last \d+|over time)(?!\p{L})/iu },
  { name: 'demand', claim: /(?<!\p{L})(cerer\p{L}*|demand|domanda|nachfrage)(?!\p{L})/iu, license: /(?<!\p{L})(cerer\p{L}*|demand|domanda|nachfrage)(?!\p{L})/iu },
  { name: 'performance', claim: /(?<!\p{L})(motor\p{L}*|driver\p{L}*|miz[ăa]\p{L}*|performan\p{L}*|importan\p{L}*|principal\p{L}*|main|key|cheie)(?!\p{L})/iu, license: /(?<!\p{L})(venit\p{L}*|revenue|volum\p{L}*|num[ăa]r\p{L}*|clien[țt]i activi|ședin[țt]e|sedinte|sessions?|bookings?|rezerv\p{L}*|program[ăa]ri|aduc\p{L}*|bring\p{L}*|drive\p{L}*|genereaz\p{L}*)(?!\p{L})/iu },
  { name: 'profitability', claim: /(?<!\p{L})(profit\p{L}*|rentab\p{L}*|marj\p{L}*|margin\p{L}*)(?!\p{L})/iu, license: /(?<!\p{L})(profit\p{L}*|rentab\p{L}*|marj\p{L}*|margin\p{L}*|cost\p{L}*)(?!\p{L})/iu },
  { name: 'strategic role', claim: /(?<!\p{L})(strategic\p{L}*|rol(ul|uri)?|roles?)(?!\p{L})/iu, license: /(?<!\p{L})(deliberat\p{L}*|specializ\p{L}*|pozi[țt]ion\p{L}*|alegere|ales\p{L}*|decizi\p{L}*|choice|chos\p{L}*|deliberate|positioning|strategic\p{L}*|rol\p{L}*|roles?)(?!\p{L})/iu },
];
/**
 * A question rationale (shown "why I ask", or a stored fork explanation) says which reading or decision the answer
 * resolves. Clause by clause ("…whether A, or whether B"), a clause that brings in business framing the question or its
 * hypothesis does not license is trimmed; if the first clause does, the rationale is blanked.
 */
export function governRationale(why: string, context: readonly string[]): string {
  const w = governWhy(why);
  if (!w) return '';
  const licensed = context.join(' ');
  // Unlicensed framing, or a future the founder never stated ("whether the line can be extended to X").
  const fault = (clause: string): boolean => FRAMING.some((f) => f.claim.test(clause) && !f.license.test(licensed)) || PRESUPPOSES.test(clause);
  // Clauses: "…, or whether …" forks, and trailing asides ("…, without assuming …", "…, which …").
  const clauses = w.split(/(?=,?\s(?:sau dac[ăa]|or whether|or if|o se|oder ob)\s)|(?=,\s(?:f[ăa]r[ăa]|without|senza|ohne|ceea ce|which|il che)\s)/iu);
  if (!clauses.some(fault)) return w;
  if (fault(clauses[0] ?? '')) return '';
  return clauses.filter((c) => !fault(c)).join('').trim().replace(/\s*[,;:.]?\s*$/, '.');
}

/**
 * STRATEGIC THESES (2026-10-16): the inference families a website read never licenses on its own, for text BB writes
 * ABOUT the business (theses, the first read). '' when clean, else the family. Economics and performance judgement
 * (margin, scalability, demand, potential, utilisation…) need the governed context to contain them; customer behaviour
 * and predicted consequences are allowed only as a hedged INTERPRETATION ("may", "if"), never as a fact; unlicensed
 * business framing is never allowed.
 */
const HEDGED = /(?<!\p{L})(may|might|could|if|whether|poate|pot|ar putea|dac[ăa]|potrebbe|potrebbero|se|kann|k[öo]nnte|wenn|ob)(?!\p{L})/iu;
export function ungroundedInference(text: string, context: string, interpretive: boolean): string {
  if (ECONOMICS.test(text) && !ECONOMICS.test(context)) return 'economics';
  if (JUDGEMENT.test(text) && !JUDGEMENT.test(context)) return 'performance judgement';
  if (BEHAVIOUR.test(text) && !BEHAVIOUR.test(context) && !(interpretive && HEDGED.test(text))) return 'customer behaviour';
  if (CONSEQUENCE.test(text) && !(interpretive && HEDGED.test(text))) return 'predicted consequence';
  const f = FRAMING.find((x) => x.claim.test(text) && !x.license.test(context));
  return f ? `framing (${f.name})` : '';
}
/** A question that presupposes a future the founder has not stated (adding, expanding, fixing…). */
export const presupposesFuture = (question: string): boolean => PRESUPPOSES.test(question);

/** A question's "why": the decision the answer informs. A predicted outcome, behaviour or economics claim is blanked. */
function governWhy(why: string): string {
  const w = (why ?? '').trim();
  return !w || CONSEQUENCE.test(w) || BEHAVIOUR.test(w) || ECONOMICS.test(w) || JUDGEMENT.test(w) ? '' : w;
}

export function governUnderstanding(raw: GovernedUnderstanding, observations: readonly PageObservation[]): GovernedUnderstanding {
  if (!raw?.read) return raw;
  // Every model list in its proper shape first (a lone string is a one-item list): nothing downstream assumes otherwise.
  const u = normalizeUnderstandingShapes(raw) as GovernedUnderstanding & { read: UnderstandingRead }; // read survives normalisation
  const trust = trustByRef(observations);
  const hasDeclared = observations.some((o) => o.provenance === 'declared');
  const untrusted: UnderstandingRead['untrusted'][number][] = [];
  const notConcludingExtra: UnderstandingRead['notConcluding'][number][] = [];
  const entities = businessEntities(u);
  const websiteNotes: string[] = [...clean(u.read.websiteNotes)];
  const trustedRefs = (refs: string[]): string[] => refs.filter((r) => trust(r).trusted);
  // Code-written reasons are codes (the card words them in the business's language); `why` stays for the model's own.
  const reasonOf = (refs: string[]): UntrustedReason => refs.map((r) => trust(r).reason).find(Boolean) ?? 'unread';

  // 1–3. Tensions.
  const contradictions: GovernedUnderstanding['contradictions'] = [];
  for (const c of u.contradictions ?? []) {
    const text = [c.tension, c.statementA, c.statementB, c.soWhat].filter(Boolean).join(' ');
    const refs = [...clean(c.sourceRefs), ...(c.evidence ?? []).map((e) => e.ref)];
    if (SITEMAP.test(text)) { untrusted.push({ finding: c.tension || c.statementB, refs, why: '', reason: 'sitemap' }); continue; }
    if (isWebsiteHygiene(text)) { websiteNotes.push(c.tension || c.statementB); continue; }
    if (!trustedRefs(refs).length) { untrusted.push({ finding: c.tension || c.statementB, refs, why: '', reason: reasonOf(refs) }); continue; }
    const absence = Boolean(c.absence) || ABSENCE.test(c.tension ?? '');
    // A tension that IS a behaviour prediction or an unsupported economics claim is not business reality.
    if (BEHAVIOUR.test(c.tension ?? '') || ECONOMICS.test(c.tension ?? '')) { notConcludingExtra.push({ claim: c.tension, why: '', reason: 'unsupported' }); continue; }
    // An absence becomes a strategic tension only when it connects to what the founder is trying to do. Without the
    // founder's goal, "X is not visible" stays a website note: no invented consequence, no strategic weight.
    if (absence && !hasDeclared) { websiteNotes.push(c.tension || c.statementB); continue; }
    // A tension whose own sentence mixes the website's voice with the founder's is not stored as written.
    if (mixesSourceVoice(c.tension ?? '')) { notConcludingExtra.push({ claim: c.tension, why: '', reason: 'unsupported' }); continue; }
    // A number in a tension must be in the source sentences quoted for it.
    const quoted = numbersIn((c.evidence ?? []).filter((e) => trust(e.ref).trusted).map((e) => e.quote).join(' '));
    if (numbersIn(c.tension ?? '').some((n) => !quoted.includes(n))) { notConcludingExtra.push({ claim: c.tension, why: '', reason: 'unsupported' }); continue; }
    // A "consequence" that is just source text copied over is no consequence.
    const soWhatOk = !BEHAVIOUR.test(c.soWhat ?? '') && !ECONOMICS.test(c.soWhat ?? '') && !SPECULATION.test(c.soWhat ?? '') && !mixesSourceVoice(c.soWhat ?? '')
      && !isLiftedText(c.soWhat ?? '', observations);
    contradictions.push({
      ...c,
      sourceRefs: trustedRefs(clean(c.sourceRefs)),
      evidence: (c.evidence ?? []).filter((e) => trust(e.ref).trusted),
      basis: BASES.includes(c.basis as EvidenceBasis) ? c.basis : 'observed',
      absence,
      // The consequence of something not being visible is not a fact about the business; nor is a predicted behaviour.
      ...(absence || !soWhatOk ? { soWhat: '' } : {}),
    });
  }

  // The capability check is an absence by definition: it keeps the observation, never a consequence.
  const cc = u.capabilityCheck;
  const capabilityCheck = !cc ? undefined
    : !hasDeclared || isWebsiteHygiene(`${cc.insight} ${cc.soWhat}`) || !trustedRefs(clean(cc.sourceRefs)).length ? undefined
      : { ...cc, soWhat: cc.shown === false ? '' : cc.soWhat, evidence: (cc.evidence ?? []).filter((e) => trust(e.ref).trusted) };

  // How the site presents the business is not a choice the founder declared: "you bet on X" from website copy alone goes.
  const positioning = {
    ...u.positioning,
    summary: !hasDeclared && FOUNDER_CHOICE.test(u.positioning?.summary ?? '') ? '' : (u.positioning?.summary ?? ''),
    implied: clean(u.positioning?.implied).filter((x) => !BEHAVIOUR.test(x) && !ECONOMICS.test(x) && (hasDeclared || !FOUNDER_CHOICE.test(x))),
  };
  // Website detail is not an open business question.
  const offer = { ...u.offer, unclear: clean(u.offer?.unclear).filter((x) => { if (isWebsiteHygiene(x)) { websiteNotes.push(x); return false; } return true; }) };
  const audience = { ...u.audience, unknown: clean(u.audience?.unknown).filter((x) => !isWebsiteHygiene(x)) };

  // The business model: each known claim rests on a trusted source; "declared" needs the founder to have said it.
  // A booking-mechanics line the model filed under acquisition belongs to conversion.
  const proposedModel = (u.read.model ?? []).map((d) => ({ ...d, known: [...(d?.known ?? [])] }));
  const acq = proposedModel.find((d) => d.dimension === 'acquisition');
  if (acq) {
    const moved = acq.known.filter((k) => BOOKING.test(k?.text ?? ''));
    if (moved.length) {
      acq.known = acq.known.filter((k) => !moved.includes(k));
      const conv = proposedModel.find((d) => d.dimension === 'conversion');
      if (conv) conv.known.push(...moved); else proposedModel.push({ dimension: 'conversion', known: moved, unknown: [] });
    }
  }
  const model = MODEL_DIMENSIONS.map((dimension) => {
    const d = proposedModel.find((x) => x?.dimension === dimension);
    const known: ModelClaim[] = [];
    for (const k of d?.known ?? []) {
      const text = (k?.text ?? '').trim();
      if (!text) continue;
      const refs = clean(k.sourceRefs);
      if (SITEMAP.test(text)) { untrusted.push({ finding: text, refs, why: '', reason: 'sitemap' }); continue; }
      if (isWebsiteHygiene(text)) { websiteNotes.push(text); continue; }
      // No behaviour prediction, unsupported unit economics or website-only founder choice is a known fact.
      if (BEHAVIOUR.test(text) || ECONOMICS.test(text) || mixesSourceVoice(text) || (!hasDeclared && FOUNDER_CHOICE.test(text))) { notConcludingExtra.push({ claim: text, why: '', reason: 'unsupported' }); continue; }
      // Every number shown must be grounded: tied to its entity and package in a quote, or an explicit calculation.
      if (numbersIn(text).length && !groundNumbers([text], k.numbers, k.calculations, observations, entities, (r) => trust(r).trusted).ok) {
        notConcludingExtra.push({ claim: text, why: '', reason: 'unsupported' }); continue;
      }
      // "declared" needs the founder to have said it; an "observed" line that adds a conclusion is an inference.
      const proposed: EvidenceBasis = BASES.includes(k.basis) ? k.basis : 'inferred';
      const basis: EvidenceBasis = (proposed === 'declared' && !hasDeclared) || (proposed === 'observed' && (INFERENCE.test(text) || SPECULATION.test(text))) ? 'inferred' : proposed;
      if (basis !== 'inferred' && !trustedRefs(refs).length) { untrusted.push({ finding: text, refs, why: '', reason: reasonOf(refs) }); continue; }
      known.push({ text, basis, sourceRefs: trustedRefs(refs) });
    }
    return { dimension, known, unknown: clean(d?.unknown).filter((x) => !isWebsiteHygiene(x)) };
  });

  // Stage evidence from the sitemap or hygiene is not evidence of the business's stage; nor is FOOTPRINT (locations,
  // team size, service breadth, a busy timetable): a stage is earned only from performance evidence (volume, trend,
  // capacity use). Without it the stage is undetermined, never shown; the proposed one stays for the audit.
  const governedStage = u.stage ? governStage(u.stage, trustedRefs, (line, numbers, calcs) => !numbersIn(line).length
    || groundNumbers([line], numbers, calcs, observations, entities, (r) => trust(r).trusted).ok) : u.stage;
  const stage = governedStage && governedStage.stage !== 'undetermined' && !performanceEvidence(model)
    ? { stage: 'undetermined' as const, evidence: governedStage.evidence, sourceRefs: governedStage.sourceRefs, secondary: null, proposed: governedStage.stage }
    : governedStage;

  // Structural synthesis: what the business is, read from the relationships between facts.
  // The governed structure is what every surface may consume; the rejected or trimmed material is quarantined in a
  // separate audit record that no surface reads (the card, the conversation and Strategy never see it).
  const governedStructure = governStructure(u.read.structure, observations, { hasDeclared, trusted: (r) => trust(r).trusted, entities });
  const structureAudit = governedStructure?.audit;
  const structure: BusinessStructure | undefined = governedStructure ? (({ audit: _audit, outcomes: _outcomes, repairs: _repairs, ...rest }) => rest)(governedStructure) : undefined;

  // 4. The diagnosis, earned.
  const diagnosis = earnDiagnosis(u.read.diagnosis, { hasDeclared, trustedRefs });

  // 5. Questions, ranked by what their answer could change.
  const shownTensions = contradictions.map((c) => c.tension).filter(Boolean);
  const unknownDims = new Set(model.filter((d) => d.known.length === 0).map((d) => d.dimension));
  const candidates = (u.read.questions ?? [])
    .map((q, i) => ({
      question: (q?.question ?? '').trim(),
      dimension: (MODEL_DIMENSIONS.includes(q?.dimension) ? q.dimension : 'intent') as ModelDimension,
      changes: [...new Set((q?.changes ?? []).filter((x) => STRATEGIC_DECISIONS.includes(x)))] as StrategicDecision[],
      why: (q?.why ?? '').trim(),
      // Metrics that can diverge (clients vs revenue) stay separate answers, even inside one question.
      parts: clean(q?.parts).map((x) => x.replace(/^\(?[a-d1-4][).:]\s*/i, '').trim()).filter(Boolean).slice(0, 4),
      fills: [...new Set((Array.isArray(q?.fills) ? q.fills : []).filter((d): d is ModelDimension => MODEL_DIMENSIONS.includes(d)))],
      order: i,
    }))
    .filter((q) => {
      if (!q.question) return false;
      if (isWebsiteHygiene(q.question)) { websiteNotes.push(q.question); return false; }
      return q.changes.length > 0 && !isHousekeeping(q.question) && !shownTensions.some((t) => sameInsight(q.question, t, 0.4));
    });
  // More strategic decisions it could change first; then a question about a dimension BB knows nothing about; then the
  // model's own order.
  const score = (q: { changes: StrategicDecision[]; dimension: ModelDimension }): number => q.changes.length * 2 + (unknownDims.has(q.dimension) ? 1 : 0);
  const ranked: typeof candidates = [];
  for (const q of [...candidates].sort((a, b) => score(b) - score(a) || a.order - b.order)) {
    if (ranked.some((r) => sameInsight(r.question, q.question, 0.6))) continue;
    ranked.push(q);
  }
  type Question = UnderstandingRead['questions'][number];
  // A "why" says which decision the answer informs, never what the answer would mean for the business.
  // A question that presupposes a future the founder never asked for (expand, add, fix, improve, remove…) is not
  // asked: it steers. Only the founder's own words can license it.
  const excludedQuestions: { question: string; reason: string }[] = [];
  const leading = (q: string): boolean => !hasDeclared && PRESUPPOSES.test(q);
  const questions: Question[] = ranked
    .filter((q) => { if (q.dimension !== 'intent' && leading(q.question)) { excludedQuestions.push({ question: q.question, reason: 'presupposes a future the founder has not stated (expanding, adding, fixing, improving)' }); return false; } return true; })
    .map(({ question, dimension, changes, why, parts, fills }) => ({ question, dimension, changes, why: governRationale(why, [question, ...parts]), ...(parts.length >= 2 ? { parts } : {}), ...(fills.length ? { fills } : {}) }));

  // STRATEGIC SUFFICIENCY: for an operating business, the variables that could reverse the next strategic decision —
  // the current driver (performance) and how new customers arrive (acquisition) — must be learned before a bet is
  // chosen. Each one still unknown reserves the best-ranked question that would fill it, so a lower-value question can
  // never crowd it out. The founder's goal (intent) is also critical; it has its own step after the conversation.
  const operating = model.some((d) => (d.dimension === 'offer' || d.dimension === 'capacity') && d.known.some((k) => k.basis !== 'inferred'));
  const missing = strategyCriticalUnknowns(model, operating);
  const covers = (q: { dimension: ModelDimension; fills?: ModelDimension[] }, d: ModelDimension): boolean => q.dimension === d || (q.fills ?? []).includes(d);
  const reserved: typeof questions = [];
  for (const d of missing) {
    if (d === 'intent') continue; // the goal step asks it
    const q = questions.find((x) => covers(x, d) && !reserved.includes(x));
    if (q) reserved.push(q);
  }
  // QUESTION SELECTION IS NOT HYPOTHESIS SELECTION: the few slots go to what the NEXT strategic decision needs.
  //   A. strategy-critical unknowns for readiness (reserved above);
  //   B. the discriminating question of each kept structural hypothesis, highest impact first (a hypothesis whose
  //      question an A question already asks is resolved there, not asked twice);
  //   C. the remaining questions by information value.
  // The founder sees the first three (agendaUnknowns); the rest wait for the conversation.
  const tiers = new Map<Question, { tier: QuestionTier; reason: string; resolves?: number }>();
  for (const q of reserved) tiers.set(q, { tier: 'A', reason: `strategy-critical for readiness: ${missing.find((d) => covers(q, d)) ?? q.dimension} is unknown` });
  const discriminating: Question[] = [];
  const questionRepairs: StructureRepairRequest[] = [];
  // A B question must settle THE fork (the hypothesis's reading vs its alternative), without steering. The hypothesis's
  // own question is used when it does; otherwise a candidate question that does; otherwise no slot is spent on it.
  const names = [...entities, ...(structure?.hypotheses ?? []).flatMap((h) => h.between)];
  const brand = brandWords(observations, (r) => trust(r).trusted);
  (structure?.hypotheses ?? []).forEach((h, i) => {
    const own = h.discriminator.question;
    const fork = `"${h.interpretation}" vs "${h.alternative}"`;
    const ownCheck = settlesFork(own, h, names, brand);
    const ownOk = Boolean(own) && ownCheck.ok && !leading(own);
    if (own && !ownOk) excludedQuestions.push({ question: own, reason: leading(own) ? 'presupposes a future the founder has not stated' : `does not settle the fork of hypothesis ${i + 1} (offers: ${ownCheck.offers.join(', ') || 'no explanation'})` });
    const candidate = ownOk ? own : questions.find((q) => !reserved.includes(q) && !discriminating.includes(q) && settlesFork(q.question, h, names, brand).ok)?.question;
    if (!candidate) {
      // Salvage: the reading stands, but its question does not settle its fork. ONE bounded repair of the question is
      // requested (never twice); until then the reading simply has no slot.
      if (!(h.repairedFields ?? []).includes('question')) {
        questionRepairs.push({ index: i, field: 'question', reason: own ? (leading(own) ? 'the question presupposes a future the founder has not stated' : `the question does not offer both sides of the fork (offers: ${ownCheck.offers.join(', ') || 'no explanation'})`) : 'no question',
          surviving: { pattern: h.pattern, interpretation: h.interpretation, alternative: h.alternative, unknown: h.discriminator.unknown, reversal: h.reversal },
          evidence: h.evidence.map((e) => ({ page: [e.page ?? e.ref, e.context].filter(Boolean).join(' · '), quote: e.quote })) });
      }
      return;
    }
    const viaA = reserved.find((q) => sameInsight(q.question, candidate, 0.5));
    if (viaA) { tiers.set(viaA, { ...tiers.get(viaA)!, resolves: i }); return; }
    // The candidate itself, or a near-identical question that ALSO settles the fork (never a weaker look-alike).
    const free = (q: Question): boolean => !reserved.includes(q) && !discriminating.includes(q);
    const existing = questions.find((q) => free(q) && q.question === candidate)
      ?? questions.find((q) => free(q) && sameInsight(q.question, candidate, 0.5) && settlesFork(q.question, h, names, brand).ok);
    const q: Question = existing ?? {
      question: candidate, dimension: h.dimensions[0] ?? 'offer', changes: h.changes, fills: h.dimensions,
      why: governRationale(h.discriminator.why ?? '', [candidate, h.interpretation, h.alternative]) || governRationale(h.whyItMatters, [candidate, h.interpretation, h.alternative]),
    };
    if (!existing) questions.push(q);
    discriminating.push(q);
    tiers.set(q, { tier: 'B', reason: `settles hypothesis ${i + 1}: ${fork}; the answer chooses between ${settlesFork(q.question, h, names, brand).offers.join(' / ')}`, resolves: i });
  });
  const remaining = questions.filter((q) => !reserved.includes(q) && !discriminating.includes(q) && q.dimension !== 'intent');
  for (const q of remaining) tiers.set(q, { tier: 'C', reason: 'remaining information value' });
  const agenda = [...reserved, ...discriminating, ...remaining];
  const questionTiers = agenda.map((q) => ({ question: q.question, ...tiers.get(q)! }));
  const strategyReadiness: NonNullable<UnderstandingRead['strategyReadiness']> = { state: missing.length ? 'not_ready' : 'ready_enough_for_strategy', missing };

  const notConcluding: UnderstandingRead['notConcluding'][number][] = (u.read.notConcluding ?? [])
    .map((n) => ({ claim: (n?.claim ?? '').trim(), why: (n?.why ?? '').trim() }))
    .filter((n) => n.claim && !isWebsiteHygiene(n.claim));
  if (diagnosis.demotion && diagnosis.statement) notConcluding.unshift({ claim: diagnosis.statement, why: '', reason: diagnosis.demotion });
  notConcluding.push(...notConcludingExtra.filter((n) => n.claim));

  for (const x of u.read.untrusted ?? []) {
    const finding = (x?.finding ?? '').trim();
    if (finding && isWebsiteHygiene(finding)) { websiteNotes.push(finding); continue; }
    if (finding) untrusted.push({ finding, refs: clean(x.refs), why: (x.why ?? '').trim(), ...((x.why ?? '').trim() ? {} : { reason: reasonOf(clean(x.refs)) }) });
  }

  const allRepairs = [...(governedStructure?.repairs ?? []), ...questionRepairs];
  const structureCandidates: UnderstandingRead['structureCandidates'] = u.read.structure ? {
    synthesis: (u.read.structure.synthesis ?? '').trim(), hypotheses: u.read.structure.hypotheses ?? [], outcomes: governedStructure?.outcomes ?? [],
    ...(allRepairs.length ? { repairs: allRepairs } : {}),
  } : undefined;
  const read: UnderstandingRead = {
    model, notConcluding, questions, diagnosis, strategyReadiness, questionTiers,
    ...(excludedQuestions.length ? { excludedQuestions } : {}),
    ...(structure ? { structure } : {}),
    ...(structureAudit?.length ? { structureAudit } : {}),
    ...(structureCandidates ? { structureCandidates } : {}),
    ...(u.read.observations?.length ? { observations: u.read.observations } : {}),
    untrusted: dedupeBy(untrusted, (x) => x.finding),
    websiteNotes: [...new Set(websiteNotes)],
  };
  return {
    ...u,
    offer, audience, positioning, contradictions, stage, read,
    ...(capabilityCheck ? { capabilityCheck } : { capabilityCheck: undefined }),
    // The stored "unknowns" ARE the ranked questions (what the conversation asks, what the strategy treats as open).
    // The founder's goal has its own step after the conversation (the goal confirm), so a goal question never takes
    // one of the few agenda slots; it stays in read.questions.
    // Strategy-critical unknowns lead (reserved above); then the rest by information value.
    unknowns: agenda.map((q) => q.question).slice(0, 5),
    // The legacy constraint field follows the earned diagnosis: decided only when it really is the constraint.
    constraint: diagnosis.state === 'constraint'
      ? { decided: true, statement: diagnosis.statement, why: diagnosis.checks.causal?.note ?? '', sourceRefs: diagnosis.sourceRefs }
      : { decided: false, statement: '', why: '', sourceRefs: [] },
  };
}

/**
 * SALVAGE-FIRST governance with ONE bounded repair round: govern; for every required hypothesis field governance emptied
 * (alternative, discriminating unknown, reversal) ask the model to rewrite THAT field only (surviving hypothesis, exact
 * reason, trusted evidence); put the answer in place, mark the field repaired, and govern again. A repaired field that
 * still fails rejects the hypothesis; there is no second round and no open-ended regeneration.
 */
export async function governUnderstandingWithRepair(
  raw: GovernedUnderstanding,
  observations: readonly PageObservation[],
  repair?: (request: StructureRepairRequest) => Promise<string>,
  maxRepairs = 6,
): Promise<GovernedUnderstanding> {
  const first = governUnderstanding(raw, observations);
  // Question repairs name the KEPT hypothesis; map them back to the candidate the model proposed.
  const kept = first.read?.structure?.hypotheses ?? [];
  const rawHyps = raw.read?.structure?.hypotheses ?? [];
  const requests = (first.read?.structureCandidates?.repairs ?? []).slice(0, maxRepairs).map((r) => (r.field !== 'question' ? r
    : { ...r, index: rawHyps.findIndex((h) => sameInsight(h.interpretation ?? '', kept[r.index]?.interpretation ?? '', 0.6) || (h.interpretation ?? '').includes(kept[r.index]?.interpretation ?? '\u0000')) })).filter((r) => r.index >= 0);
  if (!requests.length || !repair || !raw.read?.structure) return first;
  const hypotheses = [...(raw.read.structure.hypotheses ?? [])].map((h) => ({ ...h, discriminator: { ...(h.discriminator ?? { unknown: '', question: '' }) } })) as (StructuralHypothesis & { repairedFields?: RepairableField[] })[];
  for (const r of requests) {
    const value = (await repair(r).catch(() => '')).trim();
    const h = hypotheses[r.index];
    if (!h) continue;
    const marked = { ...h, repairedFields: [...new Set([...(h.repairedFields ?? []), r.field])] };
    hypotheses[r.index] = r.field === 'unknown' ? { ...marked, discriminator: { ...marked.discriminator, unknown: value } }
      : r.field === 'question' ? { ...marked, discriminator: { ...marked.discriminator, question: value } }
        : { ...marked, [r.field]: value };
  }
  // Fields already valid on the first pass are carried over as they are (the second pass re-checks everything).
  return governUnderstanding({ ...raw, read: { ...raw.read, structure: { ...raw.read.structure, hypotheses } } }, observations);
}

/**
 * The dimensions still unknown that could reverse the next strategic decision. For an operating business: what it
 * wants (intent), what currently drives it (performance) and how new customers arrive (acquisition). Exported so the
 * strategy step can re-check sufficiency against what the founder has since said.
 */
export function strategyCriticalUnknowns(model: UnderstandingRead['model'], operating: boolean): ModelDimension[] {
  const critical: ModelDimension[] = operating ? ['intent', 'performance', 'acquisition'] : ['intent'];
  return critical.filter((d) => !(model.find((x) => x.dimension === d)?.known.length));
}

/** Performance evidence: something BB knows (not merely infers) about what is working, growing or declining. The only
 *  thing that can earn a business stage. */
export function performanceEvidence(model: UnderstandingRead['model'] | undefined): boolean {
  return (model ?? []).some((d) => d.dimension === 'performance' && d.known.some((k) => k.basis !== 'inferred' && (k.text ?? '').trim()));
}

const squash = (x: string): string => x.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Text copied from a source (at least six words, verbatim up to punctuation). */
function isLiftedText(text: string, observations: readonly PageObservation[]): boolean {
  const t = squash(text);
  return t.split(' ').length >= 6 && observations.some((o) => squash(o.text).includes(t));
}

/**
 * Stage evidence from the sitemap or hygiene is not evidence of the business's stage, and a stage line with a number
 * stays only when that number is grounded (tied to its entity in the source, or an explicit calculation): "over 25
 * services" or "8 named specialists" with no grounding is dropped. Fewer than two lines left → undetermined.
 */
function governStage(
  s: NonNullable<GovernedUnderstanding['stage']>,
  trustedRefs: (r: string[]) => string[],
  grounded: (line: string, numbers: NonNullable<GovernedUnderstanding['stage']>['numbers'], calcs: NonNullable<GovernedUnderstanding['stage']>['calculations']) => boolean,
): NonNullable<GovernedUnderstanding['stage']> {
  const evidence = clean(s.evidence).filter((e) => !SITEMAP.test(e) && !isWebsiteHygiene(e) && grounded(e, s.numbers, s.calculations));
  const refs = trustedRefs(clean(s.sourceRefs));
  const sec = s.secondary;
  const secEvidence = sec ? clean(sec.evidence).filter((e) => grounded(e, sec.numbers ?? s.numbers, sec.calculations ?? s.calculations)) : [];
  const secOk = sec && secEvidence.length > 0 && !SITEMAP.test(`${sec.area} ${secEvidence.join(' ')}`) && !isWebsiteHygiene(`${sec.area} ${secEvidence.join(' ')}`);
  if (!refs.length || evidence.length < 2) return { stage: 'undetermined', evidence, sourceRefs: refs, secondary: null };
  return { ...s, evidence, sourceRefs: refs, secondary: secOk ? { ...sec, evidence: secEvidence } : null };
}

/**
 * The diagnosis the model proposed, lowered in code to what the evidence earns. A constraint needs every check passed
 * with a note, a trusted source, a licensed statement, AND the founder's goal (the "causal" check is about the goal:
 * from the website alone nothing can be causally tied to a goal nobody has stated).
 */
export function earnDiagnosis(
  raw: UnderstandingRead['diagnosis'] | undefined,
  ctx: { hasDeclared: boolean; trustedRefs: (r: string[]) => string[] },
): UnderstandingRead['diagnosis'] {
  const statement = (raw?.statement ?? '').trim();
  const checks: UnderstandingRead['diagnosis']['checks'] = {};
  for (const k of DIAGNOSIS_CHECKS) {
    const c = raw?.checks?.[k];
    if (c) checks[k] = { pass: c.pass === true && Boolean((c.note ?? '').trim()), note: (c.note ?? '').trim() };
  }
  const refs = ctx.trustedRefs(clean(raw?.sourceRefs));
  if (!statement || isWebsiteHygiene(statement) || isHousekeeping(statement) || makesUnlicensedClaim(statement)) {
    return { state: 'not_ready', statement: '', checks, sourceRefs: [], ...(statement ? { demotedBecause: 'it is about the website, or makes a claim the sources cannot support' } : {}) };
  }
  if (!refs.length) return { state: 'not_ready', statement, checks, sourceRefs: [], demotedBecause: 'nothing BB trusts in the sources supports it yet' };
  const proposed = raw?.state === 'constraint' ? 'constraint' : 'hypothesis';
  if (proposed === 'hypothesis') return { state: 'hypothesis', statement, checks, sourceRefs: refs };
  const failing = DIAGNOSIS_CHECKS.filter((k) => !checks[k]?.pass);
  if (!ctx.hasDeclared) {
    return { state: 'hypothesis', statement, checks: { ...checks, causal: { pass: false, note: checks.causal?.note ?? '' } }, sourceRefs: refs,
      demotedBecause: 'the founder\'s goal is not known yet, so nothing can be called the constraint on it', demotion: 'no_goal' };
  }
  if (failing.length) return { state: 'hypothesis', statement, checks, sourceRefs: refs, demotedBecause: `not established yet: ${failing.join(', ')}`, demotion: 'not_established' };
  return { state: 'constraint', statement, checks, sourceRefs: refs };
}

/**
 * Aha findings under the SAME discipline as the understanding (they feed strategy later): nothing resting only on
 * untrusted sources, no website hygiene, no behaviour prediction, no unsupported unit economics, no speculation, no
 * website-only founder choice, and no absence elevated to an insight before the founder's goal is known. An implication
 * that predicts behaviour, speculates or claims economics is cleared; the finding stays only if it holds on its own.
 */
export function governFindings(aha: AhaResult, observations: readonly PageObservation[], opts: AhaGovernanceOptions = {}): AhaResult {
  return governFindingsDetailed(aha, observations, opts).aha;
}

export interface AhaGovernanceOptions {
  /** v2 syntheses must name why a finding matters and the decision it could change (older outputs could not). */
  readonly requireDecision?: boolean;
  /** The business's named entities (offers, packages, locations): specificity + numeric grounding. */
  readonly entities?: string[];
}
/** One Aha candidate's verdict, for the audit trail: kept as an insight, demoted to an observation, or dropped. */
export interface AhaAuditEntry {
  readonly finding: string;
  readonly matters: string;
  readonly changes: string[];
  readonly verdict: 'kept' | 'demoted' | 'dropped';
  readonly reason: string;
  readonly grounding: { readonly numbers: { value: number; entity: string; qualifier: string | null; ref: string }[]; readonly calculations: { operation: string; operands: number[]; result: number; ok: boolean }[] };
}

/**
 * The same, plus what was DEMOTED or DROPPED and why. A fact is not an insight:
 *  - DROPPED (not stored at all): resting on untrusted sources, website hygiene, behaviour / economics / speculation /
 *    founder-choice / mixed voice in the finding, an absence before the founder's goal, or a number that is not grounded
 *    (tied to its entity and package in a quote, or an explicit calculation);
 *  - DEMOTED to an observation (true, but not an insight): no decision it could change, no reason it matters, a reason
 *    that speculates, needs data BB does not have (duration, utilisation, demand), claims how customers arrive, or is
 *    generic (it names nothing specific to this business).
 * No quota: zero findings is better than filler.
 */
export function governFindingsDetailed(aha: AhaResult, observations: readonly PageObservation[], opts: AhaGovernanceOptions = {}): { aha: AhaResult; demoted: { text: string; sourceRefs: string[]; reason: string }[]; audit: AhaAuditEntry[] } {
  // The decision requirement applies to v2 syntheses (the prompt asks for "matters" + "changes"); an older output that
  // could not carry them keeps the epistemic rules only.
  const requireDecision = opts.requireDecision ?? true;
  const entities = opts.entities ?? [];
  const trust = trustByRef(observations);
  const hasDeclared = observations.some((o) => o.provenance === 'declared');
  const unsupported = (t: string): boolean => BEHAVIOUR.test(t) || ECONOMICS.test(t) || SPECULATION.test(t) || mixesSourceVoice(t) || (!hasDeclared && FOUNDER_CHOICE.test(t));
  const demoted: { text: string; sourceRefs: string[]; reason: string }[] = [];
  const audit: AhaAuditEntry[] = [];
  const kept: AhaResult['findings'][number][] = [];
  for (const raw of aha?.findings ?? []) {
    const finding = (raw.finding ?? '').trim();
    const matters = (raw.matters ?? '').trim();
    const changes = (raw.changes ?? []).filter((x) => STRATEGIC_DECISIONS.includes(x));
    const refs = clean(raw.sourceRefs);
    const g = groundNumbers([finding, matters], raw.numbers, raw.calculations, observations, entities, (r) => trust(r).trusted);
    const entry = (verdict: AhaAuditEntry['verdict'], reason: string): void => {
      audit.push({ finding, matters, changes, verdict, reason, grounding: { numbers: g.grounded, calculations: g.calculations } });
      if (verdict === 'demoted') demoted.push({ text: finding, sourceRefs: refs, reason });
    };
    // Dropped: not credible as stored text.
    if (!finding) continue;
    if (SITEMAP.test(finding) || isWebsiteHygiene(finding)) { entry('dropped', 'website hygiene or sitemap'); continue; }
    if (!refs.some((r) => trust(r).trusted)) { entry('dropped', 'no trusted source'); continue; }
    if (unsupported(finding)) { entry('dropped', 'the finding predicts behaviour, claims economics, speculates or mixes voices'); continue; }
    if (ABSENCE.test(finding) && !hasDeclared) { entry('dropped', 'an absence, before the founder\'s goal is known'); continue; }
    if (requireDecision && !g.ok) { entry('dropped', `number not grounded: ${g.problems.join('; ')}`); continue; }
    if (requireDecision && raw.evidence?.length && !anchorClaimEvidence(raw.evidence, observations).length && !g.grounded.length) { entry('dropped', 'its evidence is not on the cited page'); continue; }
    // Implication: cleared when it speculates, claims economics or shows an ungrounded number.
    const impl = (raw.implication ?? '').trim();
    const implOk = !impl || (!unsupported(impl) && !INFERENCE.test(impl) && (!requireDecision || groundNumbers([impl], raw.numbers, raw.calculations, observations, entities, (r) => trust(r).trusted).ok));
    const f = implOk ? raw : { ...raw, implication: '' };
    if (!requireDecision) { kept.push(f); entry('kept', 'older synthesis: epistemic rules only'); continue; }
    // Demoted: true, but not an insight.
    if (!changes.length || !matters) { entry('demoted', 'it names no decision it could change, or no reason it matters'); continue; }
    if (unsupported(matters) || INFERENCE.test(matters) || MODAL.test(matters)) { entry('demoted', 'why it matters speculates or claims behaviour / economics'); continue; }
    if (NEEDS_UNKNOWN.test(matters)) { entry('demoted', 'why it matters needs data BB does not have (duration, utilisation, demand)'); continue; }
    if (!hasDeclared && ARRIVAL.test(matters)) { entry('demoted', 'why it matters claims how customers arrive, which is unknown'); continue; }
    const specific = entities.some((e) => fold(matters).includes(fold(e))) || numbersIn(matters).length > 0;
    if (!specific) { entry('demoted', 'why it matters is generic: it names nothing specific to this business'); continue; }
    kept.push(f);
    entry('kept', 'grounded, specific, and it names the decision it could change');
  }
  return { aha: { ...aha, findings: kept }, demoted, audit };
}

const fold = (x: string): string => (x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function dedupeBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = key(x).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

export type { DiagnosisCheck };
