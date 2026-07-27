/**
 * Business Brain V1 — Phase ② ports (application boundary).
 *
 * The coordinator depends on THESE, never on Instagram or Anthropic directly. Production injects the
 * real Instagram import adapter and the real Anthropic diagnosis model; tests inject doubles that
 * replay recorded Graph responses / a canned narrative. There is exactly ONE model call per refresh.
 */
import type { GenerationContext, ImportedAccount } from './provenance/model';

/** Pulls the founder's real Instagram account (most-recent-N posts) for one refresh. */
export interface InstagramImportPort {
  importAccount(founderId: string, opts: { readonly maxPosts: number }): Promise<ImportedAccount>;
}

/**
 * The interpretive narrative the ONE LLM call returns. It contains NO numbers of its own — every
 * measure the founder sees is deterministic. Root causes cite evidence by `metricKey` (a key from
 * GenerationContext.evidence); recommendations/actions cite by index. The coordinator materialises
 * these into the domain's traceability (RootCause→EvidenceItem, Recommendation→RootCause, Action→Recommendation).
 */
export interface DiagnosisNarrative {
  readonly businessReality: string;
  readonly businessConsequences: readonly string[];
  readonly cannotYetKnow: string;
  readonly rootCauses: ReadonlyArray<{ readonly statement: string; readonly evidenceKeys: readonly string[] }>;
  readonly recommendations: ReadonlyArray<{ readonly statement: string; readonly rootCauseIndexes: readonly number[] }>;
  readonly executionPlan: ReadonlyArray<{
    readonly label: string;
    readonly actions: ReadonlyArray<{ readonly statement: string; readonly recommendationIndexes: readonly number[] }>;
  }>;
}

/** The narrative plus the provenance of how it was produced. */
export interface DiagnosisResult {
  readonly narrative: DiagnosisNarrative;
  readonly modelId: string;
  readonly promptTemplateHash: string;
}

/** Interprets the whole account in a SINGLE call over the frozen GenerationContext. */
export interface DiagnosisModelPort {
  generate(ctx: GenerationContext): Promise<DiagnosisResult>;
}
