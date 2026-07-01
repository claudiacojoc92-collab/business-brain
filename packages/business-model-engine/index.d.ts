/**
 * Hand-written type declarations for the frozen JS engine (@bb/business-model-engine).
 * These describe the engine's public surface for TypeScript consumers WITHOUT touching
 * the frozen .mjs logic. If the .mjs and these types ever disagree, the .mjs is truth —
 * fix the declaration, never the engine.
 */

export type ConfidenceKind = 'observed' | 'declared' | 'inferred';

export interface EvidenceRef {
  source: string;
  fragment: string;
}

export interface Field {
  value: string;
  evidenceRefs: EvidenceRef[];
  confidenceKind: 'observed' | 'declared';
}

export interface Insight {
  statement: string;
  contributingFields: string[];
  evidenceChain: EvidenceRef[];
  confidenceKind: 'inferred';
}

export interface ContextItem {
  statement: string;
  contextKind: 'market-pattern' | 'category-signal' | 'industry-benchmark';
  confidenceKind: 'i-know';
}

/** The validated Business Model artifact (kept items). */
export interface BusinessModel {
  claimedPositioning?: Field;
  claimedOffer?: Field;
  founderClaimedIdentity?: Field;
  coreBeliefs: Field[];
  observedPositioning?: Field;
  recurringThemes: Field[];
  audiencePerception?: Field;
  whatMarketRewards?: Field;
  audienceLanguage?: Field;
  contradictions: Insight[];
  blindSpots: Insight[];
  hiddenStrengths: Insight[];
  hiddenWeaknesses: Insight[];
  positioningOpportunities: Insight[];
  marketContext: ContextItem[];
  modelConfidence: string;
}

export interface Excluded {
  kind: string;
  label: string;
  reason: string;
}

export interface ValidateModelResult {
  model: BusinessModel;
  excluded: Excluded[];
  declaredSources: string[];
}

export function buildSystemPrompt(sourceNames: string[], declaredNames: string[]): string;
export function buildUserMessage(pieces: Array<{ source: string; content: string }>): string;
export function validateModel(raw: unknown, providedSources: string[]): ValidateModelResult;

export const DECLARED_PATTERN: RegExp;
export const SINGLE_FIELDS: string[];
export const ARRAY_FIELDS: string[];
export const INSIGHT_FIELDS: string[];
export const EvidenceRefSchema: unknown;
export const FieldSchema: unknown;
export const InsightSchema: unknown;
export const ContextItemSchema: unknown;
