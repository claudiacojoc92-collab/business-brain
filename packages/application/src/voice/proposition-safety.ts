/**
 * Slice 4 Voice — SHARED proposition-safety validation KERNEL.
 *
 * Extracted VERBATIM from VoiceService.generateWithWorkingSet so that BOTH Voice AND downstream asset
 * generators (Slice 6 Carousel) enforce the SAME frozen authority — never a forked, weaker checker.
 * The kernel is the frozen contract's validation core:
 *   • Layer 1 (deterministic) — reject proposition-bearing/forbidden clauses not authorized by the spec;
 *   • Layer 2 (deterministic) — exempt genuinely non-propositional discourse (greeting/brevity/CTA/…);
 *   • Layer 3 (semantic) — N independent judge passes with UNION-FAIL: ANY pass finding a NEW proposition
 *     (beyond the spec's licensed set) rejects the candidate; a Layer-2 clause the judge flags is dropped.
 *
 * This module holds NO service state and changes NO Slice-4 semantics: the classification functions, the
 * N-pass union, the constant, and the reason strings all move UNCHANGED. The only generalization is that
 * the stochastic judge is passed in as a callback instead of read off one specific model port, so a second
 * consumer can supply its own model. Callers keep their own generate/repair loop, fail-closed policy, and
 * domain-specific backstops around this kernel.
 */
import type { AuthorizedMessageSpec, SampleContent, SampleChannel, PropositionCheckInput, PropositionCheckOutput } from './contracts';
import { classifyLayers, isPermittedDiscourse, type LayeredClassification } from './proposition-classes';

export type NewProposition = { clause: string; proposition: string; reason: string };
export type PropositionJudge = (input: PropositionCheckInput) => Promise<PropositionCheckOutput>;

/** The proposition-preservation judge is stochastic: a single call can miss a leak it would catch on a
 * re-run. Every candidate is validated with N independent passes and UNION-FAIL — ANY pass detecting a
 * new proposition rejects (never majority-pass). */
export const PROPOSITION_CHECK_PASSES = 3;

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface AuthorizationValidation {
  readonly layered: LayeredClassification;
  readonly passes: NewProposition[][];   // per-pass RAW judge findings (length N)
  readonly union: NewProposition[];       // union across passes, AFTER dropping permitted Layer-2 discourse
  readonly reasons: string[];             // Layer-1 + surviving-union repair reasons (empty ⇒ kernel-clean)
}

/**
 * Run the judge N times over the EXACT same (content, channel, spec) and return the UNION of every new
 * proposition any pass detected (obvious duplicates normalized). UNION-FAIL — a non-empty union means the
 * candidate is invalid even if some passes returned clean. A thrown judge call is pushed as [] and can
 * NEVER be read as "clean" (the other passes still gate). Absent judge ⇒ empty (deterministic-only).
 */
async function propositionUnion(content: SampleContent, channel: SampleChannel, spec: AuthorizedMessageSpec, judge: PropositionJudge | undefined, passes: number): Promise<{ passes: NewProposition[][]; union: NewProposition[] }> {
  if (!judge) return { passes: [], union: [] };
  const seen = new Set<string>();
  const union: NewProposition[] = [];
  const out: NewProposition[][] = [];
  for (let pass = 0; pass < passes; pass++) {
    let found: NewProposition[] = [];
    try { found = (await judge({ content, channel, spec })).newPropositions; }
    catch { out.push([]); continue; /* a failed judge call cannot be read as "clean" — other passes still gate */ }
    out.push(found);
    for (const p of found) {
      const key = `${norm(p.clause)}::${norm(p.proposition)}`;
      if (seen.has(key)) continue;
      seen.add(key); union.push(p);
    }
  }
  return { passes: out, union };
}

/**
 * The frozen validation kernel for ONE communication against ONE authorization spec. DETERMINISTIC Layer
 * 1/2 first, then the PRIMARY N-pass UNION-FAIL semantic judge over the residual (permitted Layer-2
 * discourse the judge flags is dropped, so the stochastic judge can never reject non-propositional
 * framing). Returns the full trace + the repair reasons; `reasons.length === 0` means kernel-clean. The
 * caller decides what to do next (append its own backstops, repair, persist, or fail closed).
 */
export async function validateAgainstAuthorization(content: SampleContent, channel: SampleChannel, spec: AuthorizedMessageSpec, judge: PropositionJudge | undefined, passes: number = PROPOSITION_CHECK_PASSES): Promise<AuthorizationValidation> {
  const reasons: string[] = [];
  // DETERMINISTIC Layer 1/2 FIRST: known proposition classes are rejected here regardless of Layer 3.
  const layered = classifyLayers(content, spec);
  for (const v of layered.layer1Violations) {
    reasons.push(`LAYER1 ${v.propositionClass} "${v.clause}" — proposition-bearing and not authorized${v.stanceGated ? ' by an explicit behavioral stance' : ''}. Remove it; realize only the authorized message.`);
  }
  // PRIMARY: N-pass UNION-FAIL proposition preservation (Layer 3) over the residual — any finding that is
  // in fact permitted Layer-2 discourse is dropped, so non-propositional framing is never rejected.
  const judged = await propositionUnion(content, channel, spec, judge, passes);
  const union = judged.union.filter((p) => !isPermittedDiscourse(p.clause, spec));
  for (const p of union) reasons.push(`NEW PROPOSITION "${p.clause}" — ${p.reason}. Remove it; express only authorized propositions.`);
  return { layered, passes: judged.passes, union, reasons };
}
