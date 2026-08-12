/**
 * Slice 4 Voice — layered proposition-preservation contract (deterministic Layer 1 + Layer 2).
 *
 * The stochastic judge (Layer 3) is not a stable SOLE authority for narrow CTA-only messages. This module
 * removes the DETERMINISTICALLY-classifiable classes from that surface. The target is ASSERTION and
 * UNLICENSED SUBSTANTIVE CONCEPT — never a verb keyword:
 *
 *   Layer 1 (reject unless authorized):
 *     • asserted / hedged / presupposed READER-STATE ("you're deciding…", "you may be comparing…",
 *       "still deciding…?") — attributes a state to the reader;
 *     • an UNLICENSED substantive CONCEPT — an offer / provider / positioning category, or an
 *       audience-segment / use-context, whose meaning is NOT authorized (polarity- and scope-aware:
 *       "we are NOT an agency" does not license "agency"; "SaaS for finance teams" does not license
 *       "operations team"). Authorization is read from the spec's licensed propositions ONLY — never the
 *       internal strategy audience/direction, and never blind substring presence;
 *     • sales-process / operational promises (stance-gated);
 *     • (population/market/customer generalizations stay in validation.ts, unchanged).
 *
 *   Layer 2 (permit) — genuinely NON-ASSERTIVE framing that introduces no unlicensed concept:
 *     greeting/connective, current-message brevity marker, pure CTA/invitation, non-assertive relevance
 *     conditional, and a hypothetical `if you…` reader-framing. A question mark is NOT a blanket permit:
 *     a state-attributing question without a clear presupposition falls to Layer-3 residual, not Layer 2.
 */
import type { AuthorizedMessageSpec, SampleContent } from './contracts';
import { sampleText } from './validation';

export type PropositionClass = 'audience_situation' | 'unlicensed_concept' | 'operational_sales_process';
export type DiscourseCategory = 'greeting_connective' | 'brevity_marker' | 'cta_invitation' | 'relevance_conditional' | 'conditional_framing';

export interface ClauseVerdict {
  readonly clause: string;
  readonly kind: 'layer1_proposition' | 'layer2_discourse' | 'residual';
  readonly propositionClass?: PropositionClass;
  readonly discourseCategory?: DiscourseCategory;
  readonly stanceGated?: boolean;
  readonly licensedByStance?: boolean;
}

// ── decision/evaluation state vocabulary (used for reader-state detection, NOT for the concept rule) ──
const DECISION_STATE = 'deciding|choosing|comparing|evaluating|weighing(?:\\s+up)?|vetting|selecting|sizing up|shopping(?:\\s+(?:for|around))?|looking for|in the market|torn between|shortlisting';
// A leading hypothetical antecedent — "if you…", "if this…" — does NOT assert its content.
const HYPOTHETICAL_IF = /\bif\s+(?:you(?:'re|’re| are| ?re)?|this|that|it|any of this|the timing|the above)\b/i;

// A. ASSERTED / hedged / presupposed reader-state (declarative or "still…?"), NOT under a hypothetical if.
const READER_STATE_DECLARATIVE = new RegExp(`\\byou(?:'re|’re| are)\\s+(?:currently |now |probably |likely |already |also |maybe |still )?(?:${DECISION_STATE})\\b`, 'i');
const READER_STATE_HEDGED = new RegExp(`\\byou\\s+(?:may|might|could|must)\\s+be\\s+(?:${DECISION_STATE})\\b`, 'i');
const READER_STATE_STILL = /\bstill\s+(?:deciding|choosing|comparing|evaluating|weighing|vetting|selecting|shopping|looking)\b/i;
function assertsReaderState(c: string): boolean {
  if (READER_STATE_STILL.test(c)) return true; // "Still deciding…?" presupposes an ongoing state
  if (HYPOTHETICAL_IF.test(c)) return false;    // "if you're deciding…" does not assert it
  return READER_STATE_DECLARATIVE.test(c) || READER_STATE_HEDGED.test(c);
}

// A state-attributing QUESTION without a clear presupposition — reader-decision about a person/provider.
// Not a hypothetical `if`, not already asserted. → Layer-3 residual (never an automatic Layer-2 permit).
const STATE_QUESTION = new RegExp(`\\b(?:thinking about|considering|mulling|wondering (?:about|who|whether)|${DECISION_STATE})\\b[^.?!]*\\bwho\\s+(?:to|you)\\b`, 'i');
function stateAttributingQuestion(c: string): boolean {
  return /\?\s*$/.test(c) && !HYPOTHETICAL_IF.test(c) && STATE_QUESTION.test(c);
}

// ── substantive CONCEPT tokens (bounded, semantic — not an open verb list) ──
const OFFER_PROVIDER = /\b(consulting partners?|partners?|consultants?|consultanc(?:y|ies)|advisors?|agenc(?:y|ies)|vendors?|providers?|suppliers?|firms?|studios?|contractors?|freelancers?|tools?|software|saas|platforms?|solutions?|systems?|apps?|services?|products?)\b/gi;
const SEGMENT = /\b((?:operations|finance|marketing|sales|product|engineering|ops|hr|human resources|legal|design|data|revenue|growth|support|customer success|it|security|procurement)\s+teams?)\b/gi;
const NEGATOR = /\b(not|never|no|isn'?t|aren'?t|do ?n'?t|does ?n'?t|wo ?n'?t|without|hardly)\b/i;
const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, ' ').replace(/\bagencies\b/, 'agency').replace(/\bconsultancies\b/, 'consultancy').replace(/s$/, '');

/** A concept token in `text` is AFFIRMED only if not negated within the ~24 chars before it (polarity). */
function affirmedTokens(text: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  const r = new RegExp(re.source, 'gi');
  for (let m = r.exec(text); m; m = r.exec(text)) {
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    if (!NEGATOR.test(before)) out.add(norm(m[0]));
  }
  return out;
}
/** Authorized concepts come ONLY from the licensed propositions (externally-assertable business material),
 * never from the internal strategy audience/direction, and each preserves polarity + exact scope. */
function authorizedConcepts(spec: AuthorizedMessageSpec): Set<string> {
  const out = new Set<string>();
  for (const p of spec.licensedPropositions) { for (const t of affirmedTokens(p.text, OFFER_PROVIDER)) out.add(t); for (const t of affirmedTokens(p.text, SEGMENT)) out.add(t); }
  return out;
}
/** True when the clause introduces an offer/provider/positioning or audience-segment/use-context concept
 * whose meaning is NOT in the authorized set. */
function introducesUnlicensedConcept(c: string, spec: AuthorizedMessageSpec): boolean {
  const ok = authorizedConcepts(spec);
  const present = new Set<string>([...affirmedTokens(c, OFFER_PROVIDER), ...affirmedTokens(c, SEGMENT)]);
  for (const t of present) if (!ok.has(t)) return true;
  return false;
}

// ── Layer 1: sales-process / operational promise (stance-gated) ──
const SALES_PROCESS =
  /\bno\s+(?:long\s+|hard\s+|sales\s+|big\s+|real\s+)?(?:pitch|pitches|sell|hard[- ]sell|pressure|obligation|strings(?:\s+attached)?|spiel|runaround|fluff|gimmicks?|catch|commitment)\b|\b(?:we|i)\s+(?:won'?t|will not|do ?n'?t|do not|never)\s+(?:pitch|hard[- ]?sell|pressure|oversell|chase|spam|waste your time)\b|\bno[- ]pressure\b/i;
const BEHAVIORAL_STANCE =
  /\b(?:no|not|never|do ?n'?t|do not|won'?t|will not|without|avoid|skip|refuse to)\b[^.?!]{0,40}\b(?:pitch|pitches|sales\s+pitch|hard[- ]sell|hard\s+selling|oversell|overselling|pressure|push|chase)\b|\b(?:sales|sales\s+conversations?|intro\s+calls?|calls?|conversations?)\b[^.?!]{0,30}\b(?:stay|are|kept|remain)\s+(?:brief|short|direct|low[- ]key)\b/i;
const stanceLicensesProcess = (stances: readonly string[]): boolean => stances.some((s) => BEHAVIORAL_STANCE.test(s));

// ── Layer 2: non-propositional discourse ──
const GREETING_CONNECTIVE = /^(?:hi|hey|hello|hi there|so|also|and|but|now|look|listen|okay|ok|right|well|plus|by the way|btw|p\.?s\.?)[\s,—:]/i;
const BREVITY_MARKER = /\b(?:i'?ll|i will|let me|let'?s|we'?ll)\s+keep\s+(?:this|it)\s+(?:short|brief|quick|snappy|tight|simple)\b|\bkeeping\s+(?:this|it)\s+(?:short|brief|quick)\b|\bin\s+short\b|\b(?:one\s+)?quick\s+(?:note|thing|thought|point)\b|\bone\s+(?:short|small)\s+(?:note|thing)\b|\bshort\s+version\b|\btl;?dr\b|\bbriefly\b|\bi'?ll\s+be\s+(?:quick|brief|short)\b/i;
const RELEVANCE_CONDITIONAL = /\bif\s+(?:this|that|it|any of this|the above|the timing)\s+(?:is|'?s|sounds|seems|feels|looks)\s+(?:relevant|useful|helpful|interesting|worth|of interest|right|good|a good time)\b|\bif\s+(?:it|this|that)\s+makes\s+sense\b|\bif\s+relevant\b|\bsee\s+(?:if|whether)\s+(?:it|this)\s+(?:makes\s+sense|is\s+(?:relevant|useful|a\s+fit)|fits|could\s+help|would\s+help)\b|\bif\s+(?:you\s+)?(?:think|feel)\s+(?:it'?s|this\s+is)\s+worth\b/i;
const CTA_INVITATION = /\b(?:book|schedule|grab|set up|reach out|get in touch|dm|message|reply|contact|call us|email us|apply|sign up|subscribe|join|let'?s\s+(?:talk|chat|connect|catch up)|drop\s+(?:me|us)\s+a\s+line|hit\s+reply)\b/i;

export type StanceType = 'tone_style' | 'behavioral_rule';
export type AuthorizationStrength = 'none' | 'operational';
export function classifyStance(text: string): { stanceType: StanceType; authorizationStrength: AuthorizationStrength } {
  return BEHAVIORAL_STANCE.test(text) ? { stanceType: 'behavioral_rule', authorizationStrength: 'operational' } : { stanceType: 'tone_style', authorizationStrength: 'none' };
}
/** Version tag hashed into the immutable authorization snapshot. Bump on any rule change. */
export const PROPOSITION_CONTRACT_VERSION = 'voice-proposition-classes/v2';

/** Split into clauses at sentence enders, line breaks, dashes, AND commas. */
export function splitClauses(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+|\s—\s|,\s+/).map((s) => s.trim()).filter(Boolean);
}

export function classifyClause(clause: string, spec: AuthorizedMessageSpec): ClauseVerdict {
  const c = clause.trim();
  // Layer 1 — asserted/presupposed reader-state (checked before hypothetical framing).
  if (assertsReaderState(c)) return { clause, kind: 'layer1_proposition', propositionClass: 'audience_situation' };
  // Layer 1 — unlicensed substantive concept (offer/provider/positioning/segment) in ANY framing.
  if (introducesUnlicensedConcept(c, spec)) return { clause, kind: 'layer1_proposition', propositionClass: 'unlicensed_concept' };
  // Layer 1 — sales-process / operational promise (stance-gated).
  if (SALES_PROCESS.test(c)) return { clause, kind: 'layer1_proposition', propositionClass: 'operational_sales_process', stanceGated: true, licensedByStance: stanceLicensesProcess(spec.stanceStatements) };
  // Layer 2 — non-propositional discourse.
  if (GREETING_CONNECTIVE.test(c)) return { clause, kind: 'layer2_discourse', discourseCategory: 'greeting_connective' };
  if (BREVITY_MARKER.test(c)) return { clause, kind: 'layer2_discourse', discourseCategory: 'brevity_marker' };
  if (RELEVANCE_CONDITIONAL.test(c)) return { clause, kind: 'layer2_discourse', discourseCategory: 'relevance_conditional' };
  if (HYPOTHETICAL_IF.test(c)) return { clause, kind: 'layer2_discourse', discourseCategory: 'conditional_framing' }; // hypothetical, no unlicensed concept, no assertion
  if (CTA_INVITATION.test(c)) return { clause, kind: 'layer2_discourse', discourseCategory: 'cta_invitation' };
  // A state-attributing question with no clear presupposition → the stochastic judge (residual), NOT Layer 2.
  if (stateAttributingQuestion(c)) return { clause, kind: 'residual' };
  return { clause, kind: 'residual' };
}

export interface LayeredClassification {
  readonly clauses: ClauseVerdict[];
  readonly layer1Violations: ClauseVerdict[];
  readonly permittedDiscourse: ClauseVerdict[];
  readonly residual: string[];
}
export function classifyLayers(content: SampleContent, spec: AuthorizedMessageSpec): LayeredClassification {
  const clauses = splitClauses(sampleText(content)).map((c) => classifyClause(c, spec));
  const layer1Violations = clauses.filter((v) => v.kind === 'layer1_proposition' && !(v.stanceGated && v.licensedByStance));
  const permittedDiscourse = clauses.filter((v) => v.kind === 'layer2_discourse');
  const residual = clauses.filter((v) => v.kind === 'residual').map((v) => v.clause);
  return { clauses, layer1Violations, permittedDiscourse, residual };
}
export function isPermittedDiscourse(clause: string, spec: AuthorizedMessageSpec): boolean {
  return classifyClause(clause, spec).kind === 'layer2_discourse';
}
