import { ABSOLUTES, escalationsIn, PRIMACY, primacyUnlicensed, stemOverlap, ungroundedInference } from '../bi/index';
import { predictsUnlicensedOutcome, upgradesFounderState } from '../conversation/validation';
import type { StrategyBundle, StrategyGateResult } from './contracts';

/**
 * M1 Strategy Quality — the DETERMINISTIC / STRUCTURAL gate stack (fail-closed). This enforces the
 * frozen minimum: a real load-bearing bet, an explicit trade-off, explicit "not now", named
 * assumptions + reconsider triggers, resolvable refs, hard-constraints-not-violated, resource
 * feasibility, coherence, anti-genericity/transplant, and claim discipline (outcome / superiority /
 * founder-state-upgrade). Judged dimensions (grounding/coherence nuance/fit quality) are additionally
 * assessed by the LLM judge in the service; both feed the same repair loop. Each failure carries a
 * `component` so the service can repair ONLY that part.
 */

export interface StrategyContextForGate {
  business: { ref: string; text: string }[];
  founder: { ref: string; kind: string; statement: string }[];
  observation: { ref: string; behavior: string }[];
  /** The top Understanding theses with their status and wording (2026-10-16). When present, the strategy must trace to
   *  them meaningfully (or say why it first validates a founder path instead). */
  theses?: { id: string; status: string; text?: string }[];
}

export interface StrategyGateFailure {
  readonly gate: string;
  readonly component: string; // 'coreBet' | 'notNow' | 'assumptions' | 'reconsider' | 'diagnosis' | 'branch' | 'channelPriorities' | 'audience' | 'decisions' | 'goal' | 'horizon'
  readonly detail: string;
}

export interface StrategyValidation {
  readonly pass: boolean;
  readonly failures: StrategyGateFailure[];
  readonly gateResults: StrategyGateResult[];
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'their', 'your', 'from', 'into', 'about', 'which',
  'while', 'they', 'them', 'have', 'will', 'would', 'should', 'could', 'because', 'these', 'those',
  'business', 'strategy', 'audience', 'content', 'marketing', 'current', 'currently', 'goal', 'over',
  'more', 'than', 'what', 'when', 'where', 'there', 'here', 'been', 'being', 'each', 'other', 'around',
  'through', 'using', 'within', 'before', 'after', 'still', 'first', 'main', 'something', 'anything',
]);

const PLATITUDE_TERMS = [
  'know your audience', 'be consistent', 'stay consistent', 'post consistently', 'show up consistently',
  'provide value', 'add value', 'engage with your audience', 'build trust', 'create quality content',
  'be authentic', 'tell your story', 'content is king', 'be everywhere', 'just start', 'be genuine',
  'focus on your audience', 'improve conversion', 'increase engagement',
];
const SUPERIORITY_TERMS = [
  'best channel', 'best strategy', 'best approach', 'highest leverage', 'highest-leverage',
  'most effective', 'will outperform', 'guaranteed', 'optimal channel', 'the best way', 'market leader',
  'dominate the market', 'beat the competition', 'steal market share', 'outrank competitors',
];
const NEGATION = /\b(no|not|without|avoid|instead of|rather than|minimal|none|free of|independent of|non-|isn'?t|doesn'?t|won'?t|drop|stop|de-?prioriti[sz]e)\b/;

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-zàâäéèêëïîôöùûüçăâîșț]{5,}/gi) ?? []).filter((w) => !STOPWORDS.has(w));
}

/** A field "prescribes" a mode when it names it WITHOUT a nearby negation (respecting a constraint reads as negated). */
function prescribes(field: string, mode: string): boolean {
  const f = field.toLowerCase();
  if (!f.includes(mode)) return false;
  return !NEGATION.test(f);
}

function anyPrescribes(fields: string[], modes: string[]): boolean {
  return fields.some((f) => modes.some((m) => prescribes(f, m)));
}

function hasPlatitude(text: string): boolean {
  const t = text.toLowerCase();
  return PLATITUDE_TERMS.some((p) => t.includes(p));
}
function claimsSuperiority(text: string): boolean {
  const t = text.toLowerCase();
  return SUPERIORITY_TERMS.some((p) => t.includes(p));
}

/**
 * FOUNDER EVIDENCE CANNOT CREATE BEHAVIOUR OR CAUSALITY (2026-10-16). A founder fact ("kinetotherapy brings less") does not
 * say WHY, nor what customers, patients or referrers do, know or prefer. A strategy sentence that claims a cause, or an
 * actor's behaviour / awareness / preference, must either echo a founder statement or be framed as something to validate
 * ("test whether…", "we don't know yet…"); otherwise it fails and the repair turns it into a validation.
 */
const CAUSAL = /(?<!\p{L})(explic[ăa]\p{L}*|explains?|is why|that's why|de aceea|din cauz[ăa]|because|due to|pentru c[ăa]|fiindc[ăa]|cauza|motivul|the reason|leads? to|duce la|caus\p{L}*|perch[ée]|weil|deshalb)(?!\p{L})/iu;
/** The people a strategy talks about: customers, patients, doctors, buyers, parents… (never the founder, "you"). */
const ACTOR_ALT = 'clien[țt]\\p{L}*|pacien[țt]\\p{L}*|oamen\\p{L}*|persoan\\p{L}*|medic|medici|medicii|medicul|medicilor|medicului|doctor\\p{L}*|cump[ăa]r[ăa]tor\\p{L}*|vizitator\\p{L}*|p[ăa]rin[țt]i\\p{L}*|mame\\p{L}*|mamele|gravid\\p{L}*|lumea|publicul|audien[țt]\\p{L}*|customers?|clients?|patients?|people|persons?|someone|anyone|doctors?|physicians?|buyers?|users?|visitors?|parents|mothers|audiences?|clienti|pazienti|persone|gente|kunden|patienten|menschen|leute';
const ACTOR = new RegExp(`(?<!\\p{L})(${ACTOR_ALT})(?!\\p{L})`, 'iu');
const ACTOR_WORD = new RegExp(`^(?:${ACTOR_ALT})$`, 'iu');
const ACTS = /(?<!\p{L})(caut[ăa]?|caut\p{L}*|merg|vin|aleg|prefer\p{L}*|nu [șs]tiu|[șs]tiu|search\p{L}*|go where|choose\p{L}*|(?:don't|do not) know|know|look(?:s|ing)? for|aware|unaware|trust\p{L}*|au [îi]ncredere|ignor\p{L}*|cercano|scelgono|suchen|wissen|natural\p{L}*|willing|dispu[șs]\p{L}*|ready to|gata s[ăa])(?!\p{L})/iu;
/** A role given to an actor ("doctors ARE referrers / a source / partners"): behaviour, not a fact. */
const ROLE = /(?<!\p{L})(sunt|este|e|is|are|sono|sind)\s+(?:\p{L}+\s+)?(referr\p{L}*|referen[țt]\p{L}*|recomand[ăa]tor\p{L}*|surs[ăae]\p{L}*|sources?|partener\p{L}*|partners?|ambasad\p{L}*|advocates?)(?!\p{L})/iu;
export const VALIDATING = /(?<!\p{L})(testez\p{L}*|test\p{L}*|valid\p{L}*|verific\p{L}*|afl[ăa]\p{L}*|afli|find out|check\p{L}*|de verificat|whether|dac[ăa]|if|might|ar putea|could|nu [șs]tim|nu [șs]tii|f[ăa]r[ăa] s[ăa] [șs]tii|f[ăa]r[ăa] s[ăa] [șs]tim|without knowing|we don't know|you don't know|unknown|necunoscut\p{L}*|ipotez\p{L}*|assumption|presupun\p{L}*)(?!\p{L})/iu;
const PREPOSITION = /^(de|la|cu|pentru|fa[țt][ăa]|c[ăa]tre|despre|din|prin|[îi]ntre|spre|l[âa]ng[ăa]|al|ale|ai|to|with|for|from|at|by|about|among|of|on|in|[îi]n|per|con|da|di|mit|f[üu]r|von|zu)$/iu;
/**
 * WHAT PEOPLE WANT, KNOW OR DO (2026-10-16, generic). A sentence whose subject is an actor (customers, patients, doctors…)
 * asserts what they want, know, believe, trust, prefer, look for, choose, expect, feel or habitually do, whatever the
 * verb. So does a relative clause about them ("people who already trust…"). Without evidence it is behaviour.
 */
/** A pronoun standing for the people just named ("they know exactly what they get"). */
const PRONOUN = /^(ei|ele|they|loro|sie)$/iu;
const QUANTITY = /^(mai|mul[țt]i|multe|pu[țt]ini|noi|more|many|fewer|new|nuovi|pi[ùu]|mehr|neue)$/iu;
function actorClaim(s: string): string {
  if (ACTOR.test(s) && (ACTS.test(s) || ROLE.test(s))) return s.match(ACTOR)![0];
  const rel = s.match(new RegExp(`(?<!\\p{L})(${ACTOR_ALT})\\s+(care|who|that|which|che|die|der|denen)(?!\\p{L})`, 'iu'));
  if (rel) return rel[1]!;
  for (const clause of s.split(/[,;:—–]\s*|\s(?:și|iar|dar|însă|but|and|while|whereas|ma|und|aber)\s/iu)) {
    const tokens = clause.match(/\p{L}+/gu) ?? [];
    if (tokens.length < 3) continue;
    if (PRONOUN.test(tokens[0]!) && ACTS.test(clause)) return tokens[0]!;
    for (let i = 0; i < Math.min(3, tokens.length); i++) {
      // "more clients", "new patients": a quantity the plan aims at, not people doing something
      if (ACTOR_WORD.test(tokens[i]!) && !tokens.slice(0, i).some((t) => PREPOSITION.test(t) || QUANTITY.test(t))) return tokens[i]!;
    }
  }
  return '';
}
/** Trust people already hold, stated as a fact ("recommendations come with trust already built"). */
const TRUST_HELD = /(?<!\p{L})((?:vin|vine|aduc|aduce|au|are) (?:deja )?cu [îi]ncredere|[îi]ncredere\p{L}* (?:deja|existent\p{L}*|construit\p{L}*|c[âa][șs]tigat\p{L}*)|already trust\p{L}*|existing trust|built-in trust|trust (?:already )?built|comes? with trust)(?!\p{L})/iu;

/** One failed founder-facing sentence, said so the repair knows exactly what to change. */
export interface CopyFinding { readonly sentence: string; readonly reason: string; readonly repair: string }
export const describeFinding = (f: CopyFinding): string => `OFFENDING: "${f.sentence}"\nREASON: ${f.reason}.\nREPAIR: ${f.repair}`;
const sentencesIn = (text: string): string[] => (text.match(/[^.!?]+[.!?]*/gu) ?? []).map((x) => x.trim()).filter(Boolean);
/**
 * FOUNDER WORDS (2026-10-17). A sentence repeats the founder only when a founder statement makes the same kind of claim
 * and shares its substance. Sharing topic words ("pilates, ballet, massage") does not license a new claim built on them.
 */
const echoes = (s: string, said: readonly string[], sameClaim: (f: string) => boolean): boolean => said.some((f) => sameClaim(f) && stemOverlap(s, f) >= 3);
/**
 * TEST FRAMING IS LOCAL (2026-10-17). The offending words are covered only when their own clause is the test ("test
 * whether doctors refer"); "doctors are a direct route…, and the test tells you…" is a claim followed by a test.
 */
const CLAUSE_BREAK = /[,;:—–]|\s(?:iar|dar|însă|but|while|whereas|ma|aber)\s/giu;
function framedAsTest(s: string, phrase: string): boolean {
  const at = s.toLowerCase().indexOf(phrase.toLowerCase());
  if (at < 0) return VALIDATING.test(s);
  let start = 0;
  let end = s.length;
  for (const m of s.matchAll(CLAUSE_BREAK)) {
    if (m.index! < at) start = m.index! + m[0].length;
    else { end = m.index!; break; }
  }
  return VALIDATING.test(s.slice(start, end));
}
const plain = (term: string): string => term.replace(/\$$/, '');

export function behaviourFinding(text: string, founderStatements: readonly string[], reasoning = false): CopyFinding | null {
  for (const s of sentencesIn(text)) {
    // In a choice's own reasoning (why X over Y, why not now, a decision's rationale) "because" justifies the choice; the
    // actor checks still apply there.
    const cause = reasoning ? undefined : s.match(CAUSAL)?.[0];
    if (cause && !framedAsTest(s, cause) && !echoes(s, founderStatements, (f) => CAUSAL.test(f))) return { sentence: s, reason: `"${cause}" states a cause that no founder answer or business evidence establishes`, repair: 'Keep the fact at its own strength. If the cause matters, make it something to find out ("find out whether…"), or remove the sentence.' };
    const actor = actorClaim(s);
    if (actor && !framedAsTest(s, actor) && !echoes(s, founderStatements, (f) => actorClaim(f) !== '')) return { sentence: s, reason: `it states what ${actor} want, know, believe, trust, prefer or do, and no founder answer or business evidence establishes that`, repair: `Do not describe what ${actor} want, know, trust or do. Remove the sentence, or say it as a test of the plan ("test whether ${actor} …").` };
    const trust = s.match(TRUST_HELD)?.[0];
    if (trust && !framedAsTest(s, trust) && !echoes(s, founderStatements, (f) => TRUST_HELD.test(f))) return { sentence: s, reason: `"${trust}" states a trust people already hold, and no founder answer or business evidence shows it`, repair: 'Do not say people already trust it. Remove the sentence, or make the trust something to test.' };
  }
  return null;
}
/** The behaviour sentence, or '' (kept for callers that only need the sentence). */
export function unsupportedBehaviourOrCause(text: string, founderStatements: readonly string[], reasoning = false): string {
  return behaviourFinding(text, founderStatements, reasoning)?.sentence ?? '';
}
/**
 * STRENGTH MATCHES EVIDENCE (2026-10-16, every founder-facing strategy field). A sentence may not rank, compare or
 * intensify beyond what the evidence says: unlicensed escalation words, a superlative phrase the evidence does not
 * contain ("cel mai clar traseu"), or a comparison ("mai X decât", "better than"). Allowed when the clause is framed
 * as something to test, or the founder used the same words (never for an absolute, see overstatedFinding).
 */
const COMPARATIVE = /(?<!\p{L})(mai \p{L}+ dec[âa]t|(?:more|less) \p{L}+ than|\p{L}+er than|better than|worse than|mai bun\p{L}*|mai bine|pi[ùu] \p{L}+ d[ie]|besser als|spre deosebire de|unlike|pe care (?:\p{L}+\s+){1,3}nu (?:[îi]l |o |le |i )?(?:are|au|ofer[ăa]|ofer[ăa]|d[ăa]|poate da)|(?:that|which) (?:\p{L}+\s+){1,3}(?:doesn't|don't|can't|cannot|lacks?) ?(?:have|give|offer|match)?|ceea ce (?:\p{L}+\s+){1,5}nu (?:\p{L}+\s+)?(?:poate|pot)|(?:what|something) (?:\p{L}+\s+){1,5}(?:can't|cannot|won't) (?:do|give|offer|match|replace))(?!\p{L})/iu;
const STRENGTH_REPAIR = 'State only what is known, or what the test would establish, at that strength. If the comparison matters, make it something to test.';
const ABSOLUTE = new Set(ABSOLUTES);
/**
 * A RANKED METHOD (2026-10-17): "the fastest way to test…" ranks every other way out, like an absolute, so a test in the
 * same clause does not license it.
 */
const METHOD_RANK = /(?<!\p{L})((?:cel|cea) mai \p{L}+ (?:mod|cale|metod[ăa]|drum|variant[ăa])|(?:the )?(?:best|fastest|quickest|simplest|easiest|cheapest|surest) (?:way|method|route|approach)|(?:il|la) (?:modo|via) più \p{L}+)(?!\p{L})/iu;
interface StrengthHit { readonly finding: CopyFinding; readonly phrase: string; readonly absolute: boolean; readonly comparison: boolean }
/** "Complete" is licensed by the same phrase only ("Echipa completă" in the evidence does not make an offer complete). */
const SAME_PHRASE_ONLY = new Set(['complet$', 'completă$', 'completa$', 'complete$', 'completo$']);
function phraseLicensed(s: string, term: string, context: string): boolean {
  const m = s.toLowerCase().match(new RegExp(`(\\p{L}+)\\s+${plain(term)}(?!\\p{L})`, 'u'));
  return !!m && context.toLowerCase().includes(m[0]);
}
function strengthOf(s: string, context: string, licensed: Set<string>): StrengthHit | null {
  const raw = escalationsIn(s).filter((x) => (SAME_PHRASE_ONLY.has(x) ? !phraseLicensed(s, x, context) : !licensed.has(x)));
  const e = raw.map(plain);
  if (e.length) {
    const abs = raw.filter((x) => ABSOLUTE.has(x)).map(plain);
    return { finding: { sentence: s, reason: `${e.map((x) => `"${x}"`).join(', ')} adds certainty, intensity or exclusivity the evidence does not carry`, repair: `${STRENGTH_REPAIR} Do not use ${e.map((x) => `"${x}"`).join(', ')}.` }, phrase: abs[0] ?? e[0]!, absolute: abs.length > 0, comparison: false };
  }
  const method = s.match(METHOD_RANK)?.[0];
  if (method && !context.toLowerCase().includes(method.toLowerCase())) return { finding: { sentence: s, reason: `"${method}" ranks this way of doing it above every other, and the evidence makes no such ranking`, repair: `${STRENGTH_REPAIR} Say what the step does, not that it is the best or fastest way.` }, phrase: method, absolute: true, comparison: false };
  if (primacyUnlicensed(s, context)) {
    const phrase = s.match(new RegExp(`${PRIMACY.source}(\\s+\\p{L}+)?`, 'iu'))?.[0] ?? '';
    return { finding: { sentence: s, reason: `"${phrase}" ranks it above the alternatives, and the evidence makes no such ranking`, repair: `${STRENGTH_REPAIR} Drop the ranking.` }, phrase, absolute: false, comparison: false };
  }
  const cmp = s.match(COMPARATIVE)?.[0];
  if (cmp) return { finding: { sentence: s, reason: `"${cmp}" compares it with something the evidence never compares`, repair: `${STRENGTH_REPAIR} Drop the comparison.` }, phrase: cmp, absolute: false, comparison: true };
  return null;
}
/** An absolute is never licensed by test framing (2026-10-17); rankings, intensity and comparisons are, in their own clause. */
export function overstatedFinding(text: string, context: string, founderStatements: readonly string[]): CopyFinding | null {
  const licensed = new Set(escalationsIn(context));
  for (const s of sentencesIn(text)) {
    const h = strengthOf(s, context, licensed);
    if (!h) continue;
    if (h.absolute) return h.finding;
    if (!framedAsTest(s, h.phrase) && !echoes(s, founderStatements, (f) => f.toLowerCase().includes(h.phrase.toLowerCase()))) return h.finding;
  }
  return null;
}
export function overstated(text: string, context: string, founderStatements: readonly string[]): string {
  const f = overstatedFinding(text, context, founderStatements);
  return f ? `${f.reason}: "${f.sentence}"` : '';
}
/**
 * FACT GROUNDING (2026-10-16): capacity, economics and performance are facts about the business. A strategy sentence
 * that states one ("Decebal has capacity for kinetotherapy", "the engines that already work") needs the evidence to
 * contain it; otherwise it is something to check, or it goes.
 */
export const CAPACITY = /(?<!\p{L})(capacitat\p{L}*|capacity|locuri libere|spa[țt]iu liber|sloturi libere|free slots|available slots|disponibilitat\p{L}*|grad de ocupare|ocupare|occupancy|utilization|utilisation|utiliz\p{L}* (sub|pe deplin)|neocupat\p{L}*|underbooked|not full|nu (e|este|sunt) plin\p{L}*)(?!\p{L})/iu;
const PERFORMS = /(?<!\p{L})(motor\p{L}*|motoar\p{L}*|engines?|merg\p{L}* (deja|bine)|work(?:s|ing)? (?:well|already)|func[țt]ioneaz\p{L}* (deja|bine)|de succes|successful|performant\p{L}*|rentabil\p{L}*|profitab\p{L}*|cerere (mare|ridicat[ăa]|existent[ăa])|(?:strong|high|existing) demand)(?!\p{L})/iu;
const PERFORMS_LICENSE = /(?<!\p{L})(venit\p{L}*|revenue|aduc\p{L}*|bring\p{L}*|genereaz\p{L}*|vânz\p{L}*|sales|clien[țt]i activi|active clients|plin\p{L}*|full|cerere|demand)(?!\p{L})/iu;
const FACT_REPAIR = 'Remove the claim, or make it something to check ("check whether…").';
/**
 * RESOURCES THE FOUNDER HAS (2026-10-17): "you already have the team and the space", "a multidisciplinary team". Who
 * and what the founder can put on a move is theirs to say: it needs a founder statement about that resource (a team the
 * website lists is not a team free for this move). A descriptive label ("multidisciplinary") needs the evidence to use it.
 */
const RESOURCE_HELD = /(?<!\p{L})((?:ai|ave[țt]i|are|au) (?:deja )?(?:o |un )?(?:echip\p{L}*|spa[țt]iu\p{L}*|personal\p{L}*|oameni)|(?:has|have|you've got) (?:already )?(?:the |a |your )?(?:team|space|staff|people)|multidisciplinar\p{L}*|multidisciplinary|multi-disciplinary)(?!\p{L})/iu;
const RESOURCE_NOUN = /echip|spa[țt]iu|personal|oameni|team|space|staff|people|multi-?disciplin/iu;
/**
 * ADVERTISING (2026-10-17): whether the business runs ads, and whether they work, is a fact about the business ("the
 * classes do well without ads"). Without evidence that mentions advertising it is invented; as a test it is fine.
 */
const ADS_CLAIM = /(?<!\p{L})(f[ăa]r[ăa] (?:nicio |vreo )?(?:reclam\p{L}*|publicitate|campanii pl[ăa]tite)|without (?:any )?(?:paid )?(?:ads|advertising)|no (?:paid )?(?:ads|advertising)|nu (?:faci|face|facem|fac|ai|are|au) (?:\p{L}+ )?(?:reclam\p{L}*|publicitate)|(?:reclamele|ads|advertising|campaniile pl[ăa]tite) (?:nu )?(?:merg|func[țt]ioneaz\p{L}*|work|don't work|aren't working)|senza pubblicit\p{L}*|ohne werbung)(?!\p{L})/iu;
const ADS_LICENSE = /(?<!\p{L})(reclam\p{L}*|publicit\p{L}*|advertis\p{L}*|ads|campanii pl[ăa]tite|paid social|werbung)(?!\p{L})/iu;
export function inventedFactFinding(text: string, context: string, founderStatements: readonly string[]): CopyFinding | null {
  // The founder's own words are in the context, so they license a capacity or performance term; nothing else does.
  for (const s of sentencesIn(text)) {
    const res = s.match(RESOURCE_HELD)?.[0];
    if (res && !framedAsTest(s, res)) {
      const noun = res.match(RESOURCE_NOUN)![0].toLowerCase();
      const grounded = noun.startsWith('multi') ? context.toLowerCase().includes('multidisciplin') : founderStatements.some((f) => f.toLowerCase().includes(noun));
      if (!grounded) return { sentence: s, reason: `it states a resource ("${res}") that the founder never said they have for this`, repair: 'Do not say what team, space or people the founder has. Remove the claim, or make it something to check ("check who can take this on").' };
    }
    const ads = ADS_LICENSE.test(context) ? undefined : s.match(ADS_CLAIM)?.[0];
    if (ads && !framedAsTest(s, ads)) return { sentence: s, reason: `it says something about advertising ("${ads}") that no founder answer or business evidence mentions`, repair: FACT_REPAIR };
    const cap = CAPACITY.test(context) ? undefined : s.match(CAPACITY)?.[0];
    if (cap && !framedAsTest(s, cap)) return { sentence: s, reason: `it states a capacity ("${cap}") that no founder answer or business evidence mentions`, repair: FACT_REPAIR };
    const perf = PERFORMS_LICENSE.test(context) ? undefined : s.match(PERFORMS)?.[0];
    if (perf && !framedAsTest(s, perf)) return { sentence: s, reason: `it states how well something performs ("${perf}") without evidence`, repair: FACT_REPAIR };
    if (VALIDATING.test(s)) continue;
    const inf = ungroundedInference(s, context, true);
    if (inf === 'economics' || inf === 'performance judgement') return { sentence: s, reason: `it states an ${inf === 'economics' ? 'economics' : 'performance'} judgement the evidence does not contain`, repair: FACT_REPAIR };
  }
  return null;
}
/** "Fondatoarea vrea…", "the founder named…": founder-facing copy addresses the founder as "you". */
const FOUNDER_3P = /(?<!\p{L})(fondator(?:ul|ului)?|fondatoare(?:a|i)?|founderul|(?:the )?founder(?:'s)?|il fondatore|la fondatrice|der gr[üu]nder|die gr[üu]nderin)(?!\p{L})/iu;
export function thirdPersonFinding(text: string): CopyFinding | null {
  for (const s of sentencesIn(text)) {
    const m = s.match(FOUNDER_3P)?.[0];
    if (m) return { sentence: s, reason: `it talks about the founder in the third person ("${m}") while the founder is the one reading it`, repair: 'Address the founder directly as "you" (tu / du / tu), never as "the founder".' };
  }
  return null;
}
export function inventedFact(text: string, context: string, founderStatements: readonly string[]): string {
  const f = inventedFactFinding(text, context, founderStatements);
  return f ? `${f.reason}: "${f.sentence}"` : '';
}
/** The central choice (diagnosis, bet): any unlicensed strength or economics claim, with no test exemption. */
function centralFinding(text: string, context: string): CopyFinding | null {
  const licensed = new Set(escalationsIn(context));
  for (const s of sentencesIn(text)) {
    const h = strengthOf(s, context, licensed);
    if (h && !h.comparison) return h.finding; // rankings and intensity; comparisons are the strength gate's
    const inf = ungroundedInference(s, context, true);
    if (inf === 'economics' || inf === 'performance judgement') return { sentence: s, reason: `it states an ${inf === 'economics' ? 'economics' : 'performance'} judgement the evidence does not contain`, repair: FACT_REPAIR };
  }
  return null;
}

/**
 * SECONDARY COPY FALLBACK (2026-10-16). After the repair attempts, a strategy whose central choice is valid is not lost
 * to one unsupported sentence in its secondary explanations (the bet's "why", channel reasons, not-now reasons, trade-off
 * and decision rationales): that sentence is omitted, and a required field left empty gets a minimal neutral line. The
 * diagnosis, the bet itself, the offer and the positioning are never touched: they stay blocking.
 */
const FALLBACK: Record<string, Record<'why' | 'goal' | 'resource' | 'over' | 'notNow', string>> = {
  ro: { why: 'Pornește de la obiectivul tău și verifică direcția înainte să construiești pe ea.', goal: 'Servește obiectivul pe care l-ai numit.', resource: 'Resursele de care are nevoie se văd după primele încercări.', over: 'Celelalte canale rămân disponibile; nu le închizi.', notNow: 'Nu acum: întâi testul.' },
  en: { why: 'It starts from your goal and checks the direction before you build on it.', goal: 'It serves the goal you named.', resource: 'The resources it needs show after the first tries.', over: 'The other channels stay available; you are not closing them.', notNow: 'Not now: the test comes first.' },
  it: { why: 'Parte dal tuo obiettivo e verifica la direzione prima di costruirci sopra.', goal: 'Serve l’obiettivo che hai indicato.', resource: 'Le risorse necessarie si vedono dopo i primi tentativi.', over: 'Gli altri canali restano disponibili; non li chiudi.', notNow: 'Non ora: prima il test.' },
};
export function omitUnsupportedSecondary(bundle: StrategyBundle, ctx: StrategyContextForGate, language: string): { bundle: StrategyBundle; omitted: string[] } {
  const context = [...ctx.business.map((b) => b.text), ...ctx.founder.map((f) => f.statement)].join(' ');
  const said = ctx.founder.map((f) => f.statement);
  const fb = FALLBACK[language.slice(0, 2)] ?? FALLBACK['en']!;
  const omitted: string[] = [];
  const clean = (where: string, text: string | undefined, reasoning: boolean, central = false): string => {
    const kept = sentencesIn(text ?? '').filter((s) => {
      const f = overstatedFinding(s, context, said) ?? inventedFactFinding(s, context, said) ?? behaviourFinding(s, said, reasoning) ?? thirdPersonFinding(s) ?? (central ? centralFinding(s, context) : null);
      if (f) omitted.push(`${where}: ${f.sentence}`);
      return !f;
    });
    return kept.join(' ');
  };
  const c = bundle.core;
  const bet = c.coreBet;
  const core = {
    ...c,
    coreBet: { ...bet, whyOverAlternative: clean('coreBet.whyOverAlternative', bet.whyOverAlternative, true, true) || fb.why, relationToGoal: clean('coreBet.relationToGoal', bet.relationToGoal, true), founderFit: clean('coreBet.founderFit', bet.founderFit, true), resourceFit: clean('coreBet.resourceFit', bet.resourceFit, true) },
    notNow: (c.notNow ?? []).map((n, i) => ({ ...n, reason: clean(`notNow[${i}]`, n.reason, true) || fb.notNow })),
    tradeOffs: (c.tradeOffs ?? []).map((t, i) => ({ ...t, why: clean(`tradeOffs[${i}]`, t.why, true) })),
  };
  const branch = bundle.branch ? { ...bundle.branch, channelPriorities: (bundle.branch.channelPriorities ?? []).map((x, i) => ({ ...x,
    whyGoal: clean(`channel[${i}].whyGoal`, x.whyGoal, false) || fb.goal, whyAudience: clean(`channel[${i}].whyAudience`, x.whyAudience, false),
    whyResource: clean(`channel[${i}].whyResource`, x.whyResource, true) || fb.resource, overAlternative: clean(`channel[${i}].overAlternative`, x.overAlternative, true) || fb.over })) } : bundle.branch;
  const decisions = (bundle.decisions ?? []).map((d) => ({ ...d, rationale: clean(`decision:${d.key}`, d.rationale, true) }));
  return { bundle: { ...bundle, core, branch, decisions } as StrategyBundle, omitted };
}
/** Every founder-facing strategy field, by component. */
type Field = [component: string, text: string, reasoning: boolean, assumption?: boolean];
function founderFacingFields(b: StrategyBundle): Field[] {
  const c = b.core;
  const bet = c.coreBet;
  const ch = b.branch?.channelPriorities ?? [];
  const join = (xs: (string | undefined)[]) => xs.map((x) => (x ?? '').trim()).filter(Boolean).map((x) => (/[.!?]$/.test(x) ? x : `${x}.`)).join(' ');
  return [
    ['diagnosis', c.diagnosis ?? '', false],
    ['coreBet', join([bet?.priority, bet?.deprioritized]), false],
    // the visible "why" of the bet: its own reasoning
    ['coreBet', join([bet?.whyOverAlternative, bet?.relationToGoal, bet?.founderFit, bet?.resourceFit]), true],
    ['offerDirection', c.offerDirection ?? '', false],
    ['positioningDirection', c.positioningDirection ?? '', false],
    ['channelPriorities', join(ch.flatMap((x) => [x.whyGoal, x.whyAudience])), false],
    ['channelPriorities', join(ch.flatMap((x) => [x.overAlternative, x.whyResource])), true],
    // an assumption is labelled as one: a behaviour may be stated there, never a ranking
    ['channelPriorities', join(ch.map((x) => x.assumption)), true, true],
    ['notNow', join((c.notNow ?? []).map((n) => `${n.item}: ${n.reason}`)), true],
    ['tradeOffs', join((c.tradeOffs ?? []).map((t) => t.why)), true],
    ...(b.decisions ?? []).map((d): Field => [`decision:${d.key}`, d.rationale ?? '', true]),
  ];
}
/** The wording of one strategy component (what a reliesOn entry is about). */
function componentText(b: StrategyBundle, component: string): string {
  const c = b.core;
  if (component === 'coreBet') return [c.coreBet?.priority, c.coreBet?.whyOverAlternative, c.coreBet?.deprioritized].join(' ');
  if (component === 'diagnosis') return c.diagnosis ?? '';
  if (component === 'offerDirection') return c.offerDirection ?? '';
  if (component === 'positioningDirection') return c.positioningDirection ?? '';
  if (component === 'notNow') return (c.notNow ?? []).map((n) => `${n.item} ${n.reason}`).join(' ');
  if (component.startsWith('channel')) return (b.branch?.channelPriorities ?? []).map((x) => `${x.channel} ${x.whyGoal} ${x.whyAudience ?? ''}`).join(' ');
  return JSON.stringify(c);
}

export function validateStrategy(bundle: StrategyBundle, ctx: StrategyContextForGate): StrategyValidation {
  const failures: StrategyGateFailure[] = [];
  const results: StrategyGateResult[] = [];
  const add = (ok: boolean, gate: string, component: string, detail: string) => {
    results.push({ gate, pass: ok, detail: ok ? 'ok' : detail });
    if (!ok) failures.push({ gate, component, detail });
  };

  const { core, branch, decisions } = bundle;
  const businessSet = new Set(ctx.business.map((e) => e.ref));
  const founderKinds = new Map(ctx.founder.map((e) => [e.ref, e.kind]));

  // ── structural presence ──
  add(core.goal?.trim().length > 0, 'goal_present', 'goal', 'Goal is missing.');
  add(core.horizon?.trim().length > 0, 'horizon_present', 'horizon', 'Horizon is missing.');
  add((core.diagnosis?.trim().length ?? 0) >= 30, 'diagnosis_present', 'diagnosis', 'Strategic diagnosis is missing or too thin.');
  const bet = core.coreBet;
  add(!!bet?.priority?.trim() && !!bet?.deprioritized?.trim() && !!bet?.whyOverAlternative?.trim(),
    'core_bet_present', 'coreBet', 'Core bet must name a priority, a deprioritized alternative, and why one over the other.');
  add((core.tradeOffs?.length ?? 0) >= 1 || (!!bet?.deprioritized?.trim() && bet.deprioritized.toLowerCase() !== bet.priority?.toLowerCase()),
    'trade_off_explicit', 'coreBet', 'Strategy must contain an explicit trade-off.');
  add((core.notNow ?? []).some((n) => n.item?.trim() && n.reason?.trim()), 'not_now_explicit', 'notNow', 'Strategy must say what it is deliberately NOT doing, with a reason.');
  add((core.assumptions ?? []).some((a) => a.statement?.trim()), 'assumptions_explicit', 'assumptions', 'Load-bearing assumptions must be named.');
  add((core.reconsiderTriggers ?? []).some((r) => r.condition?.trim()), 'reconsider_explicit', 'reconsider', 'Strategy must name what would make BB reconsider.');

  // ── branch presence ──
  add(!!branch?.market?.trim() && !!branch?.language?.trim() && !!branch?.ctaDirection?.trim(), 'branch_present', 'branch', 'Execution branch (market/language/CTA) is incomplete.');
  const chans = branch?.channelPriorities ?? [];
  add(chans.length >= 1 && chans.every((c) => c.channel?.trim() && c.whyGoal?.trim() && c.whyResource?.trim() && c.overAlternative?.trim()),
    'channel_prioritized', 'channelPriorities', 'At least one channel must be prioritized with why-goal / why-resource / over-alternative.');

  // ── refs resolvable ──
  const danglingBusiness = decisions.flatMap((d) => d.sourceRefs ?? []).filter((r) => !businessSet.has(r));
  const danglingFounder = decisions.flatMap((d) => d.founderRefs ?? []).filter((r) => !founderKinds.has(r));
  add(danglingBusiness.length === 0 && danglingFounder.length === 0, 'refs_resolvable', 'decisions', `Unresolvable refs: ${[...danglingBusiness, ...danglingFounder].join(', ')}`);
  const resolvableRefs = decisions.flatMap((d) => [...(d.sourceRefs ?? []).filter((r) => businessSet.has(r)), ...(d.founderRefs ?? []).filter((r) => founderKinds.has(r))]).length;
  add(decisions.length >= 1 && resolvableRefs >= 1, 'decisions_grounded', 'decisions', 'Material decisions must resolve to real evidence / founder-state refs.');
  add(decisions.every((d) => !!d.rationale?.trim() && ['evidenced', 'bounded', 'assumption'].includes(d.claimStrength)), 'decisions_wellformed', 'decisions', 'Every decision needs a rationale and a valid claim strength.');

  // ── founder-fit: hard constraints (kind constraint) must not be violated ──
  const exec = [core.coreBet?.priority ?? '', branch?.contentRole ?? '', branch?.acquisitionApproach ?? '', branch?.ctaDirection ?? '', branch?.messagingDirection ?? '', ...chans.map((c) => `${c.channel} ${c.whyGoal} ${c.overAlternative}`)];
  for (const c of ctx.founder.filter((f) => f.kind === 'constraint')) {
    const s = c.statement.toLowerCase();
    const hitsVideo = /video|camera|on camera|talking head|personal content|personal brand|daily content|founder-led|being the face|my face|daily personal/.test(s);
    const hitsPaid = /paid ad|paid ads|paid acquisition|paid media|advertising|running ads/.test(s);
    if (hitsVideo && anyPrescribes(exec, ['video', 'camera', 'talking head', 'talking-head', 'vlog', 'personal brand', 'face-to-camera', 'daily personal content'])) {
      add(false, 'hard_constraint_respected', 'coreBet', `Strategy relies on something the founder ruled out: "${c.statement}"`);
    }
    if (hitsPaid && anyPrescribes(exec, ['paid ad', 'paid ads', 'paid acquisition', 'paid media', 'run ads', 'advertising campaign'])) {
      add(false, 'hard_constraint_respected', 'channelPriorities', `Strategy relies on paid acquisition the founder ruled out: "${c.statement}"`);
    }
  }

  // ── founder-fit: resource envelope must change decisions ──
  const challengePaid = ctx.founder.some((f) => f.kind === 'challenge_permission' && /budget|paid|ad/.test(f.statement.toLowerCase()));
  for (const r of ctx.founder.filter((f) => f.kind === 'resource')) {
    const s = r.statement.toLowerCase();
    if (/hour|part-time|part time|limited time|few hours|a week|per week/.test(s)) {
      if (anyPrescribes(exec, ['daily', 'every day', 'multi-channel', 'multiple channels', 'several channels', 'across all channels', 'post daily', 'seven days'])) {
        add(false, 'resource_feasible', 'branch', `Strategy assumes more output than the founder's time allows: "${r.statement}"`);
      }
      if (chans.length > 2) add(false, 'resource_feasible', 'channelPriorities', `Too many prioritized channels for the founder's available time ("${r.statement}").`);
    }
    if (/small budget|no budget|tight budget|limited budget|low budget|little budget/.test(s) && !challengePaid) {
      if (chans.some((c) => /paid|ads|advertis/.test(c.channel.toLowerCase()))) {
        add(false, 'resource_feasible', 'channelPriorities', `Paid acquisition prioritized against a small budget with no challenge permission ("${r.statement}").`);
      }
    }
    if (/no team|solo|just me|alone|one-person|one person|by myself|myself/.test(s)) {
      if (anyPrescribes(exec, ['hire', 'specialists', 'team of', 'agency', 'delegate to'])) {
        add(false, 'resource_feasible', 'branch', `Strategy assumes staff the founder does not have ("${r.statement}").`);
      }
    }
  }

  // ── coherence ──
  const goalL = core.goal.toLowerCase();
  const goalClient = /client|customer|revenue|sales|retainer|lead|booking|sign-?up|paying|enquir/.test(goalL);
  const betText = `${bet?.priority ?? ''} ${branch?.messagingDirection ?? ''} ${chans.map((c) => c.channel).join(' ')}`.toLowerCase();
  const betFollowers = /maximi[sz]e followers|follower growth|grow followers|more followers|build a large following|vanity|follower count/.test(betText);
  add(!(goalClient && betFollowers), 'coherence_goal_bet', 'coreBet', 'Goal is client/revenue-oriented but the bet optimizes follower growth.');
  const premium = /premium|high-end|bespoke|luxury|expert|senior|enterprise-grade|specialist/.test(core.positioningDirection.toLowerCase());
  const discount = /discount|cheap|lowest price|urgency|flash sale|limited-time offer|coupon|price war/.test(`${branch?.ctaDirection ?? ''} ${branch?.messagingDirection ?? ''} ${branch?.acquisitionApproach ?? ''}`.toLowerCase());
  add(!(premium && discount), 'coherence_positioning_messaging', 'branch', 'Premium positioning contradicted by discount/urgency messaging.');
  const b2b = /b2b|enterprise|buyer|procurement|decision-maker|company|companies|organization|organisation/.test(`${core.audiencePrimaryForGoal} ${core.audienceRoles.map((r) => r.who).join(' ')}`.toLowerCase());
  const weakCta = /follow for more|follow us|like and follow|follow along|link in bio|dm me for/.test((branch?.ctaDirection ?? '').toLowerCase());
  add(!(b2b && weakCta), 'coherence_audience_cta', 'branch', 'B2B audience but a generic social-follow CTA.');

  // ── anti-genericity / transplant ──
  const betBlob = `${core.diagnosis} ${bet?.priority ?? ''} ${bet?.whyOverAlternative ?? ''} ${bet?.relationToBottleneck ?? ''}`;
  add(!hasPlatitude(betBlob), 'anti_genericity', 'coreBet', 'Diagnosis / core bet reads as a platitude, not a decision.');
  const anchorSet = new Set(ctx.business.flatMap((e) => tokens(e.text)).concat(ctx.founder.flatMap((e) => tokens(e.statement))));
  const anchorsHit = new Set(tokens(betBlob).filter((w) => anchorSet.has(w)));
  add(anchorsHit.size >= 2, 'anti_transplant', 'coreBet', `Strategy lacks business-specific anchors (found ${anchorsHit.size}); it would transplant to another business.`);
  add(!!bet?.deprioritized?.trim() && bet.deprioritized.toLowerCase() !== (bet.priority ?? '').toLowerCase() && !hasPlatitude(bet.deprioritized), 'opposite_is_advice', 'coreBet', 'The deprioritized alternative is not a real, coherent opposite.');

  // ── claim discipline ──
  const claimBlob = [...decisions.map((d) => d.rationale), branch?.ctaDirection ?? '', bet?.relationToGoal ?? '', bet?.relationToBottleneck ?? '', branch?.acquisitionApproach ?? ''].join(' \n ');
  add(!predictsUnlicensedOutcome(claimBlob), 'no_outcome_prediction', 'decisions', 'Strategy predicts an outcome (leads/clients/sales/conversion) the evidence does not license.');
  add(!claimsSuperiority(`${claimBlob} ${chans.map((c) => `${c.channel} ${c.whyGoal}`).join(' ')} ${bet?.whyOverAlternative ?? ''}`), 'no_unevidenced_superiority', 'channelPriorities', 'Strategy claims market superiority ("best" / "highest leverage" / "outperform") the evidence does not license.');
  const audienceBlob = `${core.audiencePrimaryForGoal} ${core.audienceRoles.map((r) => `${r.role} ${r.who}`).join(' ')}`;
  add(!upgradesFounderState(audienceBlob, new Set(founderKinds.values())), 'founder_state_compatible', 'audience', 'Audience upgrades a founder-state type (e.g. a channel preference into a target segment).');

  // ── continuity with Understanding (2026-10-16): the core bet traces to an active thesis and/or founder evidence; no
  //    choice relies on a reversed thesis; no invented thesis id. Only when the theses were given. ──
  if (ctx.theses?.length) {
    const status = new Map(ctx.theses.map((t) => [t.id, t.status]));
    const founderRefs = new Set(ctx.founder.map((f) => f.ref));
    const rel = core.reliesOn ?? [];
    const usable = (r: { theses: string[]; founderRefs: string[] }) => (r.theses ?? []).some((id) => status.has(id) && status.get(id) !== 'reversed') || (r.founderRefs ?? []).some((f) => founderRefs.has(f));
    const bet = rel.find((r) => r.component === 'coreBet');
    add(Boolean(bet && usable(bet)), 'thesis_trace', 'coreBet', 'The core bet must rely on at least one Understanding thesis that is not reversed (T-id) and/or explicit founder evidence (F-ref), recorded in core.reliesOn.');
    const onReversed = rel.filter((r) => (r.theses ?? []).some((id) => status.get(id) === 'reversed'));
    add(!onReversed.length, 'thesis_not_reversed', onReversed[0]?.component === 'coreBet' || !onReversed[0] ? 'coreBet' : onReversed[0].component, `A choice relies on a reversed thesis (${onReversed.flatMap((r) => r.theses).filter((id) => status.get(id) === 'reversed').join(', ')}).`);
    // SEMANTIC RELEVANCE (no traceability theater): a cited thesis must be what the choice actually relies on: the stated
    // relationshipUsed and the choice's own wording both share substance with the thesis (stem overlap).
    const text = new Map(ctx.theses.map((t) => [t.id, t.text ?? '']));
    const irrelevant = rel.flatMap((r) => (r.theses ?? []).filter((id) => text.has(id)).filter((id) => {
      const thesis = text.get(id)!;
      return stemOverlap(r.relationshipUsed ?? '', thesis) < 2 || stemOverlap(componentText(bundle, r.component), thesis) < 2;
    }).map((id) => ({ id, component: r.component })));
    add(!irrelevant.length, 'thesis_relevance', irrelevant[0]?.component === 'coreBet' || !irrelevant[0] ? 'coreBet' : irrelevant[0].component,
      irrelevant.length ? `${irrelevant.map((x) => `${x.id} (cited by ${x.component})`).join(', ')}: the choice does not use what the thesis says. Cite a thesis only where the choice relies on its relationship, decision or open question, and name that part in relationshipUsed; otherwise remove the citation.` : 'ok');
    // Strategy may not silently abandon the Understanding reasoning: it uses at least one non-reversed thesis meaningfully,
    // OR says explicitly that it first validates a founder goal / evidence path before the theses can be resolved.
    const citable = ctx.theses.filter((t) => t.status !== 'reversed');
    const meaningful = rel.some((r) => (r.theses ?? []).some((id) => status.has(id) && status.get(id) !== 'reversed' && !irrelevant.some((x) => x.id === id && x.component === r.component)));
    add(!citable.length || meaningful || (core.thesisDeferral ?? '').trim().length >= 30, 'thesis_used', 'coreBet', 'The strategy must either build meaningfully on at least one Understanding thesis (cited with relationshipUsed), or state in core.thesisDeferral why it first validates a founder goal or evidence path before the theses can be resolved.');
    const unknownIds = rel.flatMap((r) => r.theses ?? []).filter((id) => !status.has(id));
    add(!unknownIds.length, 'thesis_known', 'coreBet', `core.reliesOn names theses that do not exist: ${unknownIds.join(', ')}.`);
    // STATUS CONTROLS USE (2026-10-16): an unresolved (or never-asked) thesis may only be VALIDATED, never committed to
    // as established; a weakened thesis cannot carry the core bet. The repair turns such a choice into "validate/test X".
    const misused = rel.flatMap((r) => (r.theses ?? []).filter((id) => {
      const st = status.get(id);
      const committed = (r.use ?? 'commit') === 'commit';
      return committed && (st === 'unresolved' || st === 'open' || (st === 'weakened' && r.component === 'coreBet'));
    }).map((id) => ({ id, st: status.get(id), component: r.component })));
    add(!misused.length, 'thesis_status_use', misused[0]?.component === 'coreBet' || !misused[0] ? 'coreBet' : misused[0].component,
      misused.length ? `${misused.map((m) => `${m.id} is ${m.st}`).join(', ')}: the ${misused[0]!.component} may only VALIDATE or TEST it (an investigation, an experiment, an information-gathering move; set use "validate"), never state it as an established diagnosis, bottleneck or priority.` : 'ok');
  }

  // ── no unsupported superlatives / potential (2026-10-16): a comparison or a potential needs evidence that makes it ──
  {
    const context = [...ctx.business.map((b) => b.text), ...ctx.founder.map((f) => f.statement)].join(' ');
    const said = ctx.founder.map((f) => f.statement);
    // Economics / performance judgements on the central choice (diagnosis, bet); ranking and intensity on every field.
    for (const [component, text] of [['diagnosis', core.diagnosis ?? ''], ['coreBet', `${bet?.priority ?? ''} ${bet?.whyOverAlternative ?? ''}`]] as const) {
      const f = centralFinding(text, context);
      add(!f, 'no_unsupported_superlative', component, f ? describeFinding(f) : 'ok');
    }
    const fields = founderFacingFields(bundle);
    for (const [component, text] of fields) {
      const f = overstatedFinding(text, context, said);
      add(!f, 'no_unsupported_strength', component, f ? describeFinding(f) : 'ok');
    }
    for (const [component, text, , assumption] of fields) {
      const f = assumption ? null : inventedFactFinding(text, context, said);
      add(!f, 'no_invented_fact', component, f ? describeFinding(f) : 'ok');
    }
    // Founder evidence cannot create behaviour or causality (every founder-facing field).
    for (const [component, text, reasoning, assumption] of fields) {
      if (assumption) continue;
      const f = behaviourFinding(text, said, reasoning);
      add(!f, 'no_unsupported_behaviour', component, f ? describeFinding(f) : 'ok');
    }
    // The founder reads this: it speaks to them, never about them (2026-10-17).
    for (const [component, text] of [...fields, ['reconsider', (core.reconsiderTriggers ?? []).map((r) => r.condition).join(' '), true] as Field]) {
      const f = thirdPersonFinding(text);
      add(!f, 'founder_addressed_directly', component, f ? describeFinding(f) : 'ok');
    }
  }

  return { pass: failures.length === 0, failures, gateResults: results };
}
