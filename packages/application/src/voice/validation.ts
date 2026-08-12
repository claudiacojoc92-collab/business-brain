import { predictsUnlicensedOutcome } from '../conversation/validation';
import type { SampleContent, SampleChannel } from './contracts';

/**
 * Voice quality gates — DETERMINISTIC / STRUCTURAL (fail-closed). Judged resemblance runs in the LLM
 * layer; the founder reaction is the strongest real-world loop. These gates guarantee the frozen
 * invariants: correct language, explicit boundary + negative-space not violated, no unsupported claim
 * smuggled in via voice, the strategy's required action (CTA) preserved, and no parroting of stored
 * examples. Voice determines HOW an allowable claim reads — never WHAT may be claimed.
 */

export type VoiceRejection =
  | 'wrong_language' | 'negative_space_violated' | 'boundary_violated'
  | 'unsupported_claim' | 'fabricated_claim' | 'cta_missing' | 'parroting';

export interface VoiceSampleContext {
  language: string;
  ctaRequired: boolean;
  negativeSpace: string[];      // concrete banned values (words / clichés / hooks)
  boundaryTerms: string[];      // quoted terms from active voice/legal boundaries
  claimBoundaryTerms: string[]; // quoted terms the Evidence/legal layer forbids (e.g. "guaranteed")
  acceptedExamples: string[];   // to detect parroting / near-duplication
  factualFacts: string;         // governed business + founder-OWNED material (NOT strategy/examples) — the only authority for a stated fact
}

export interface VoiceGateFailure { readonly gate: VoiceRejection; readonly detail: string }
export interface VoiceValidation { readonly pass: boolean; readonly failures: VoiceGateFailure[] }

export function sampleText(content: SampleContent): string {
  return [content.hook ?? '', ...(content.beats ?? []), content.caption ?? '', content.cta ?? '']
    .filter((s) => s && s.trim()).join(' \n ').trim();
}

const EN_STOPWORDS = ['the', 'and', 'your', 'with', 'this', 'that', 'you', 'for', 'here', 'what', 'when', 'from', 'about', 'know', 'never'];
const RO_MARKERS = ['ă', 'â', 'ș', 'ț', 'î', ' și ', ' să ', ' care ', ' pentru ', ' este ', ' nu ', ' te '];
const IT_MARKERS = ['perché', 'perche', ' che ', ' non ', ' per ', ' con ', ' della ', ' sono ', ' più ', ' tuo ', ' cosa '];

/** Conservative wrong-language check: only fires on a CLEAR mismatch (avoids false positives). */
export function wrongLanguage(text: string, language: string): boolean {
  if (language === 'en') return false;
  const t = ` ${text.toLowerCase()} `;
  const markers = language === 'ro' ? RO_MARKERS : language === 'it' ? IT_MARKERS : [];
  if (markers.length === 0) return false;
  const hasMarker = markers.some((m) => t.includes(m));
  if (hasMarker) return false;
  const englishHits = EN_STOPWORDS.filter((w) => t.includes(` ${w} `)).length;
  return englishHits >= 3; // reads clearly English while target is ro/it, with no target markers
}

function toks(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9àâäéèêëïîôöùûüçăâîșț ]/gi, ' ').split(/\s+/).filter(Boolean);
}
// Common functional words — a shared span made only of these is ordinary language, not a distinctive quirk.
const COMMON_SPAN = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'with', 'your', 'you', 'we', 'our', 'us', 'is', 'are', 'be',
  'this', 'that', 'it', 'in', 'on', 'at', 'as', 'if', 'so', 'but', 'not', 'no', 'i', 'me', 'my', 'they', 'them',
  'book', 'a', 'short', 'intro', 'call', 'learn', 'more', 'get', 'started', 'link', 'bio', 'reach', 'out', 'contact',
  'work', 'with', 'about', 'here', 'now', 'next', 'step', 'want', 'need', 'know', 'see', 'come', 'talk',
]);
/** Longest contiguous shared token run between two token arrays. */
function longestSharedRun(a: string[], b: string[]): string[] {
  let best: string[] = [];
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
        if (dp[i]![j]! > best.length) best = a.slice(i - dp[i]![j]!, i);
      }
    }
  }
  return best;
}
/**
 * Parroting guard: catches distinctive near-verbatim reuse of a stored example (punctuation-insensitive
 * contiguous spans, or high trigram overlap) while allowing ordinary functional language. Examples are
 * behavior evidence, not a copy bank.
 */
export function parrotsExample(text: string, examples: string[]): boolean {
  const a = toks(text);
  for (const ex of examples) {
    const run = longestSharedRun(a, toks(ex));
    const distinctive = run.filter((w) => !COMMON_SPAN.has(w) && w.length > 3).length >= 2;
    if (run.length >= 4 && distinctive) return true; // near-verbatim distinctive contiguous span
  }
  return false;
}

const SUPERLATIVE = ['#1', 'number one', 'best in the world', 'world-class', 'the best', 'unrivaled', 'unrivalled', 'guaranteed results', 'convert best', 'converts best', 'works best', 'work best', 'perform best', 'performs best', 'convert better', 'converts better', 'work better than', 'better than', 'more effective than', 'outperform'];

const NUMWORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', fifteen: '15', twenty: '20', thirty: '30', forty: '40', 'forty-five': '45', fifty: '50', sixty: '60', ninety: '90',
};
const normNums = (s: string): string => s.toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-five|forty|fifty|sixty|ninety)\b/g, (m) => NUMWORDS[m] ?? m);

export type ClaimType = 'proof' | 'operational' | 'duration' | 'market' | 'behavior' | 'customer' | 'causal' | 'business_fact' | 'value' | 'quality' | 'capability' | 'outcome';
export interface AssertionAudit { clause: string; type: ClaimType; licensed: boolean }

function overlap(s: string, allowed: string): number {
  const words = s.match(/[a-zàâäéèêëïîôöùûüçăâîșț]{4,}/gi) ?? [];
  if (!words.length) return 0;
  return words.filter((w) => allowed.includes(w.toLowerCase())).length / words.length;
}

const GROUP = 'founders?|teams?|businesses|companies|buyers?|clients?|customers?|people|marketers?|startups?|leaders?|owners?|brands?|partners?|agenc(?:y|ies)|providers?|vendors?|competitors?|audiences?|prospects?|clien(?:ti|ți|tii)|fondator(?:i|ii|ilor)|utenti|aziende|oameni';
const GROUP_RE = new RegExp(`\\b(${GROUP})\\b`);
// Strong quantifiers that assert a population by themselves (EN/RO/IT), no group noun required.
const STRONG_POP = /\b(most|the majority of|nearly all|almost every|majoritatea|cei mai mulți|cei mai multi|la maggior parte)\b/;
const MARKET = new RegExp(`\\b(most|many|the majority of|nearly all|almost every|the average|plenty of|few|some of the)\\s+(${GROUP})\\b`);
const POP_BEHAVIOR = new RegExp(`\\b(${GROUP})\\s+(usually|tend to|tends to|often|always|rarely|struggle|want|need|expect|prefer|know|can'?t|cannot|don'?t)\\b`);
// A population/frequency adverb ABOUT a third-party group is a behavior claim even with no number.
const POP_ADVERB = /\b(usually|typically|generally|often|frequently|tends? to|more often than not|by default|as a rule|nine times out of ten|de obicei|de regulă|de regula|adesea|majoritatea|di solito|spesso|tendono a|la maggior parte|in genere)\b/;
// Claims about the ACTUAL customer set — need real customer/business evidence, never voice/intuition.
const CUSTOMER_SET = new RegExp(`\\b(the )?(${GROUP})\\s+(who|that)\\s+(call|contact|come to|work with|hire|reach out to|choose|find)\\s+us\\b|\\bour (clients?|customers?)\\b|\\b(${GROUP})\\s+come to us\\b|\\bwho (?:call|contact|hire|choose|find) us\\b`);
// A specific customer ANECDOTE / testimonial ("a founder once told us…", "clients tell us…") — needs real evidence.
const CUSTOMER_ANECDOTE = new RegExp(`\\b(a|one|the|another)\\s+(${GROUP})\\b[^.?!]{0,40}\\b(told us|tell us|said|says|asked us|reached out|came to us|mentioned|admitted|wrote|explained|shared)\\b|\\b(${GROUP})\\s+(tell|told|say|said|ask|asked)\\s+us\\b|\\bsomeone (?:once )?(?:told|said to) us\\b`);
// Empirical causal / decision-mechanism claims (distinct from an adopted strategic decision).
const CAUSAL = /\b(makes?|make it|enables?|enabling|drives?|causes?|prevents?|reduces?|increases?|leads to|is what makes|allows? (?:you )?to|helps? (?:you )?)\b[^.?!]{0,40}\b(possible|convert|conversion|decision|evaluation|evaluate|hesitation|hesitate|trust|act|buy|choose|commit|decide|results?)\b/;
const SECOND_PERSON = /\byou(?:'re| are|'ve| have)\s+(not|really|probably|already|still)\b|\byou\s+(can'?t|cannot|can not|won'?t|don'?t|do not|probably|usually|already|really|struggle|tend to|keep|always|never|need to (?:see|know|know that)|have (?:probably|already)|already know)\b|\byou'?ve\s+(probably|already|tried|been)\b/;
const DURATION = /\b\d+[- ]?(minute|minutes|min|hour|hours)\b/g;
const OPERATIONAL = /\bwe\s+(only\s+|never\s+|always\s+|exclusively\s+)?(take on|work with only|accept|onboard|limit|cap|stay|remain|guarantee|include|cover)\b/;
const CAPACITY = /\b(a\s+)?(small number|handful|only (?:a )?few|just (?:a )?few)\s+(of\s+)?(projects?|clients?|customers?|founders?|engagements?|accounts?)\b|\bonly\s+\d+\s+(projects?|clients?|customers?|at a time)\b/;
const NAMED_SERVE = /\bwe\s+(work with|serve|specialize in|help)\s+[a-z][a-z\s-]{2,40}(companies|teams|founders|businesses|startups|brands|industries|clients|organizations)\b/;
// OWNED VALUE / STANCE (expressive when owned): first-person belief/preference.
const VALUE = /\b(we|i)\s+(care about|believe|value|prefer|like to|would rather|are committed to|stand for)\b|\bour (preference|belief|value|philosophy|stance) is\b/;
// QUALITY assertion (delivery quality — needs authority).
const QUALITY = /\b(made well|well[- ]made|high[- ]quality|top[- ]quality|carefully crafted|craftsmanship|crafted|polished|rigorous|meticulous|done (?:properly|right)|quality work|premium quality|best[- ]in[- ]class)\b/;
// CAPABILITY / PROCESS assertion (what we do / how we deliver — needs authority).
const CAPABILITY = /\bwe\s+(build|design|develop|deliver|engineer|produce|create|craft|tailor|customi[sz]e)\b|\bbuilt (?:around|for)\b|\b(?:every|each)\s+(?:project|engagement|client|build|system)\b|\b(?:no|not|don'?t use|without)\s+templates?\b|\bour (?:process|approach|method)\b/;
// OUTCOME / RESULT assertion (non-numeric — needs result evidence). High precision: only a SELF-attributed
// result counts (avoids flagging evaluative framing like "the decisions that moved the number"). The
// judged layer governs the nuanced cases.
const OUTCOME_SELF = /\b(we|our|i|my)\b[^.?!]{0,30}\b(moved (?:a|the) number|change[sd]? outcomes?|drove (?:growth|results|revenue)|delivered results?|solved (?:a|the|their|your)|held (?:it )?together|proven (?:outcomes?|results?)|track record)\b/;
const OUTCOME_HEAD = /\b(what (?:we|i) (?:built|had built|have built|'?ve built|made|delivered|shipped)|what it solved|we get results|we produce results)\b/;
const isOutcome = (s: string): boolean => OUTCOME_SELF.test(s) || OUTCOME_HEAD.test(s);

/**
 * Material-assertion audit. Classifies each generated clause and checks its authority against the
 * SOURCE-TYPED allowed material. Rhetorical/expressive language carries no external assertion and is
 * ignored. Market/population and reader-behavior claims can NEVER be licensed by business/founder/voice
 * evidence (no market-behavior corpus), so they are unlicensed by construction. Proof/operational/
 * duration/business facts must resolve against `factual` (governed business + founder-owned only —
 * NOT strategy decisions, which are future directions, and NOT voice examples).
 */
export function auditAssertions(text: string, factual: string): AssertionAudit[] {
  const f = normNums(factual);
  const out: AssertionAudit[] = [];
  const sentences = text.split(/(?<=[.!?])\s+|\n+|\s—\s/).map((s) => s.trim()).filter(Boolean);
  for (const raw of sentences) {
    const s = normNums(raw);
    const percents = s.match(/\d[\d.,]*\s?%/g) ?? [];
    const money = s.match(/[$€£]\s?\d[\d.,]*/g) ?? [];
    const counts = s.match(/\b\d+\s+(founders?|clients?|customers?|companies|teams|startups|users|businesses|projects?|people|conversations?|leads?|deals?)\b/g) ?? [];
    const timeframes = s.match(/\b(last (?:quarter|month|year|week)|(?:in|within|over)(?: the)?(?: first| last| past)? \d+ (?:days?|weeks?|months?|quarters?|years?))\b/g) ?? [];
    const customerEvent = /\b(came to us|came in with|reached out to us|a founder (?:came|reached|asked|approached)|founders? came|we (?:helped|worked with|built (?:for|it for)|shipped (?:for|to)|grew|scaled|delivered (?:for|to)|increased|reduced|doubled|tripled)|our (?:client|customer)s?|one (?:client|customer|founder)|for (?:a|an|one) [a-z-]+ (?:company|startup|team|founder|business|brand))\b/.test(s);
    const testimonial = /["“][^"”]{15,}["”]/.test(raw);
    const hard = [...percents, ...money, ...counts, ...timeframes];

    if (hard.length || customerEvent || testimonial) {
      const hardOk = hard.every((tok) => f.includes(tok.toLowerCase().replace(/\s+/g, ' ').trim()));
      const storyOk = (customerEvent || testimonial) ? overlap(s, f) >= 0.5 : true;
      out.push({ clause: raw, type: 'proof', licensed: hardOk && storyOk });
      continue;
    }
    if (MARKET.test(s) || POP_BEHAVIOR.test(s) || STRONG_POP.test(s) || (POP_ADVERB.test(s) && GROUP_RE.test(s))) { out.push({ clause: raw, type: 'market', licensed: false }); continue; }
    if (CUSTOMER_SET.test(s) || CUSTOMER_ANECDOTE.test(s)) { out.push({ clause: raw, type: 'customer', licensed: false }); continue; } // actual-customer claim / anecdote
    if (CAUSAL.test(s)) { out.push({ clause: raw, type: 'causal', licensed: false }); continue; }         // empirical mechanism claim
    if (SECOND_PERSON.test(s)) { out.push({ clause: raw, type: 'behavior', licensed: false }); continue; }
    const durs = s.match(DURATION);
    if (durs) { out.push({ clause: raw, type: 'duration', licensed: durs.every((d) => f.includes(d.replace(/[- ]/g, ' '))) }); continue; }
    if (OPERATIONAL.test(s) || CAPACITY.test(s)) { out.push({ clause: raw, type: 'operational', licensed: overlap(s, f) >= 0.5 }); continue; }
    // OWNED VALUE is expressive IF the stance is actually owned (present in founder/brand material); else it is an unlicensed claim.
    if (VALUE.test(s)) { out.push({ clause: raw, type: 'value', licensed: overlap(s, f) >= 0.4 }); continue; }
    if (isOutcome(s)) { out.push({ clause: raw, type: 'outcome', licensed: overlap(s, f) >= 0.55 }); continue; }
    if (QUALITY.test(s)) { out.push({ clause: raw, type: 'quality', licensed: overlap(s, f) >= 0.5 }); continue; }
    if (CAPABILITY.test(s)) { out.push({ clause: raw, type: 'capability', licensed: overlap(s, f) >= 0.5 }); continue; }
    if (NAMED_SERVE.test(s)) { out.push({ clause: raw, type: 'business_fact', licensed: overlap(s, f) >= 0.45 }); continue; }
  }
  return out;
}

/**
 * Fabrication gate: every MATERIAL factual assertion must resolve to a licensed source; unresolved
 * claims (invented proof, unlicensed operational/duration/business facts, market-population claims,
 * reader-behavior rhetoric) are returned for repair. Plausibility ≠ evidence. Rhetorical language passes.
 */
export function detectUnsupportedClaims(text: string, factual: string): string[] {
  return auditAssertions(text, factual).filter((a) => !a.licensed).map((a) => a.clause);
}

export function classifyVoiceSample(content: SampleContent, channel: SampleChannel, ctx: VoiceSampleContext): VoiceValidation {
  const failures: VoiceGateFailure[] = [];
  const text = sampleText(content);
  const t = text.toLowerCase();

  if (wrongLanguage(text, ctx.language)) failures.push({ gate: 'wrong_language', detail: `Sample is not in ${ctx.language}.` });

  for (const n of ctx.negativeSpace) {
    if (n && t.includes(n.toLowerCase())) { failures.push({ gate: 'negative_space_violated', detail: `Uses a rejected element: "${n}"` }); break; }
  }
  for (const b of ctx.boundaryTerms) {
    if (b && t.includes(b.toLowerCase())) { failures.push({ gate: 'boundary_violated', detail: `Crosses a voice boundary: "${b}"` }); break; }
  }
  // Claim safety: voice may not introduce an outcome/superiority claim or a term the evidence layer forbids.
  if (predictsUnlicensedOutcome(text) || SUPERLATIVE.some((s) => t.includes(s))) {
    failures.push({ gate: 'unsupported_claim', detail: 'Introduces an unsupported outcome / superiority claim.' });
  }
  for (const c of ctx.claimBoundaryTerms) {
    if (c && t.includes(c.toLowerCase())) { failures.push({ gate: 'unsupported_claim', detail: `Uses a claim the evidence layer does not license: "${c}"` }); break; }
  }
  // Strategy action must survive voice adaptation: a required CTA cannot silently vanish.
  if (ctx.ctaRequired) {
    const hasCta = channel === 'caption' ? Boolean((content.caption ?? '').trim()) && Boolean((content.cta ?? '').trim() || /\b(contact|book|reply|dm|email|reach|get in touch|schedule|hire|apply|sign up|learn|see|start)\b/i.test(content.caption ?? '')) : Boolean((content.cta ?? '').trim());
    if (!hasCta) failures.push({ gate: 'cta_missing', detail: 'The strategy requires a clear next action, but the sample has no CTA.' });
  }
  if (parrotsExample(text, ctx.acceptedExamples)) failures.push({ gate: 'parroting', detail: 'Too close to a stored example — reuses its wording rather than its voice.' });
  // Every material factual assertion must resolve to a typed authority; unlicensed ones are repaired.
  const fab = detectUnsupportedClaims(text, ctx.factualFacts);
  if (fab.length) failures.push({ gate: 'fabricated_claim', detail: `Unauthorized factual assertion(s): ${fab.slice(0, 2).join(' | ')}` });

  return { pass: failures.length === 0, failures };
}

/** Detect an explicit, permanent "I will never say X" style statement (→ immediate boundary). */
const NEVER_MARKERS = [
  'never say', 'i never', 'we never', 'don\'t ever', 'do not ever', 'i will never', 'we will never',
  'never use', 'i refuse to', 'nu spun niciodată', 'nu spunem niciodată', 'niciodată', 'non dico mai', 'mai dire', 'non diremo mai',
];
export function isExplicitBoundary(text: string): boolean {
  const t = text.toLowerCase();
  return NEVER_MARKERS.some((m) => t.includes(m));
}
