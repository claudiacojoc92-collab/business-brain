/**
 * Slice 4 Voice — immutable authorization provenance for a persisted VoiceSample.
 *
 * Two frozen records are captured at generation time and stored WITH the sample, so a later audit can
 * reconstruct the ORIGINAL safety decision from stored data alone — never by recomputing from the current
 * (mutable) strategy / founder state:
 *   • AuthorizationSnapshot — the source-typed authorization CONTEXT (what the copy was allowed to say):
 *     licensed propositions + their source, stance statements + their provenance/strength, the CTA
 *     function, the resolved judge model id, and hashes of the deterministic contract + judge prompt.
 *   • SafetyDecision — the original decision TRACE: deterministic Layer-1/2 findings, the per-pass Layer-3
 *     judge results + union + repair attempt, and the final disposition. No secrets, tokens, prompts, or
 *     chain-of-thought — hashes/ids suffice for the static contract/prompt.
 */
import { createHash } from 'node:crypto';
import type { AuthorizedMessageSpec, PropositionSource } from './contracts';
import { classifyStance, PROPOSITION_CONTRACT_VERSION, type AuthorizationStrength, type StanceType } from './proposition-classes';

export interface SnapshotProposition { readonly text: string; readonly sourceType: PropositionSource }
export interface SnapshotStance {
  readonly text: string;
  readonly stanceType: StanceType;             // tone_style | behavioral_rule
  readonly sourceType: PropositionSource;      // founder_owned / brand_stance
  readonly authorizationStrength: AuthorizationStrength; // none | operational — WHY it does/doesn't authorize
}
export interface AuthorizationSnapshot {
  readonly licensedPropositions: SnapshotProposition[];
  readonly stanceStatements: SnapshotStance[];
  readonly ctaFunction: string;
  readonly resolvedJudgeModelId: string;
  readonly propositionContractHash: string;
  readonly judgePromptHash: string;
}

export type FinalDisposition = 'persisted' | 'repaired_persisted' | 'fail_closed';
export interface SafetyDecision {
  readonly deterministic: {
    readonly layer1Violations: { clause: string; propositionClass: string }[];
    readonly layer2Permitted: { clause: string; discourseCategory: string }[];
    readonly residualToJudge: string[];
  };
  readonly semanticJudge: {
    readonly passes: { clause: string; proposition: string }[][]; // per-pass Layer-3 findings (N=3)
    readonly union: { clause: string; proposition: string }[];
    readonly repairAttempt: number;
  };
  readonly finalDisposition: FinalDisposition;
}

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
export const PROPOSITION_CONTRACT_HASH = sha(PROPOSITION_CONTRACT_VERSION);

/** Build the immutable authorization snapshot from the spec + the resolved judge contract. Stance
 * provenance is derived deterministically (classifyStance) so an audit can answer WHY a stance did or did
 * not authorize an operational statement. */
export function buildAuthorizationSnapshot(spec: AuthorizedMessageSpec, judge: { modelId: string; promptHash: string }): AuthorizationSnapshot {
  return {
    licensedPropositions: spec.licensedPropositions.map((p) => ({ text: p.text, sourceType: p.source })),
    stanceStatements: spec.stanceStatements.map((s) => ({ text: s, sourceType: 'founder_owned' as PropositionSource, ...classifyStance(s) })),
    ctaFunction: spec.ctaFunction,
    resolvedJudgeModelId: judge.modelId,
    propositionContractHash: PROPOSITION_CONTRACT_HASH,
    judgePromptHash: judge.promptHash,
  };
}
