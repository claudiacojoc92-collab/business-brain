/**
 * Wave 4 — Recommendation Provenance Integrity (resolves ADR-011 KA-1). Deterministic, LLM-free validation of every
 * grounded reference a recommendation carries, against a per-session PROVENANCE MANIFEST built from the exact assembled
 * context. A model-echoed id is grounded provenance ONLY if it resolves to the manifest (input-bounded, founder-isolated,
 * version-exact). Invalid references are REMOVED (never substituted); if grounding collapses the outcome degrades to
 * INSUFFICIENT. Governed by docs/governance/recommendation-provenance-integrity-contract.md.
 */
import type { StrategicContext } from './strategic-context.assembler';
import type { EvidenceReference, EpistemicKind, StrategicOutcome, StrategicRecommendation, InsufficientStrategicEvidence } from './strategy';

export const PROVENANCE_MANIFEST_VERSION = 'pm-1';

// ── Reference-kind → target-category (deterministic) ─────────────────────────────────────────────────────
type TargetCategory = 'BUSINESS_UNDERSTANDING' | 'PUBLIC_POSITIONING_CONTEXT' | 'FOUNDER_STRATEGIC_CONTEXT' | 'FOUNDER_ANY' | 'NON_GROUNDING';
const KIND_TARGET: Record<EpistemicKind, TargetCategory> = {
  OBSERVED_BUSINESS_EVIDENCE: 'BUSINESS_UNDERSTANDING', BUSINESS_UNDERSTANDING_INFERENCE: 'BUSINESS_UNDERSTANDING',
  PUBLIC_POSITIONING_OBSERVATION: 'PUBLIC_POSITIONING_CONTEXT', MARKET_INFERENCE: 'PUBLIC_POSITIONING_CONTEXT',
  FOUNDER_STRATEGIC_CONTEXT: 'FOUNDER_STRATEGIC_CONTEXT',
  FOUNDER_DECLARATION: 'FOUNDER_ANY', FOUNDER_CORRECTION: 'FOUNDER_ANY', FOUNDER_RELEVANCE_DECISION: 'FOUNDER_ANY',
  UNKNOWN: 'NON_GROUNDING', CONVERSATION_HYPOTHESIS: 'NON_GROUNDING', STRATEGIC_RECOMMENDATION: 'NON_GROUNDING',
};

// ── Manifest ─────────────────────────────────────────────────────────────────────────────────────────────
export interface ProvenanceManifest {
  manifestVersion: string;
  understandingVersion: number | null;
  conclusionIds: Set<string>;
  respondedConclusionIds: Set<string>;
  entityIds: Set<string>;
  findingIds: Set<string>;
  sourceUrls: Set<string>;
  contextItemIds: Set<string>;
  contextItemVersionByLogical: Map<string, { id: string; version: number }>;
}

/** Build the allowed-reference manifest from the EXACT assembled context (founder-scoped by construction). */
export function buildProvenanceManifest(context: StrategicContext): ProvenanceManifest {
  const bu = context.businessUnderstanding;
  const pos = context.publicPositioningContext;
  const fc = context.founderContext;
  const items = [...fc.goals, ...fc.constraints, ...fc.resources, ...fc.strategicPreferences, ...fc.decisionHorizons];
  return {
    manifestVersion: PROVENANCE_MANIFEST_VERSION,
    understandingVersion: bu.version,
    conclusionIds: new Set(bu.conclusions.map((c) => c.id)),
    respondedConclusionIds: new Set(bu.founderResponses.map((r) => r.conclusionId)),
    entityIds: new Set(pos.entities.map((e) => e.id)),
    findingIds: new Set([...pos.observations.map((o) => o.findingId), ...pos.inferences.map((i) => i.findingId)]),
    sourceUrls: new Set([...pos.observations.map((o) => o.sourceUrl)].filter((u): u is string => !!u)),
    contextItemIds: new Set(items.map((i) => i.id)),
    contextItemVersionByLogical: new Map(items.map((i) => [i.logicalItemId, { id: i.id, version: i.version }])),
  };
}

// ── Validation ───────────────────────────────────────────────────────────────────────────────────────────
export type RejectionReason = 'MALFORMED' | 'UNSUPPORTED_KIND' | 'NOT_IN_MANIFEST' | 'VERSION_MISMATCH' | 'DUPLICATE';
export interface ReferenceRejection { kind: string; reason: RejectionReason } // redacted — never the raw invalid id
export type GroundingStatus = 'GROUNDED' | 'DEGRADED' | 'UNGROUNDED' | 'NOT_APPLICABLE';
export interface ProvenanceValidation { manifestVersion: string; groundingStatus: GroundingStatus; validatedCount: number; rejectedCount: number; rejected: ReferenceRejection[] }

const hasLocator = (r: EvidenceReference): boolean => r.refId != null || r.entityId != null || r.logicalItemId != null || r.sourceUrl != null;

/** Validate one reference against the manifest. Returns the cleaned reference (grounded → validated:true), a downgraded
 *  reasoning reference (grounding-kind without a resolvable locator), or a rejection (invalid grounded → removed). */
function classifyRef(r: EvidenceReference, m: ProvenanceManifest): { ref: EvidenceReference; grounded: boolean } | { rejected: RejectionReason } {
  const cat = KIND_TARGET[r.kind] ?? 'NON_GROUNDING';
  const stripToReasoning = (kind: EpistemicKind): { ref: EvidenceReference; grounded: boolean } =>
    ({ ref: { kind, statement: r.statement, refId: null, entityId: null, sourceUrl: null, logicalItemId: null, version: null, validated: false }, grounded: false });

  if (cat === 'NON_GROUNDING') return stripToReasoning(r.kind);
  if (!hasLocator(r)) return stripToReasoning('CONVERSATION_HYPOTHESIS'); // grounding kind but no target → unsupported reasoning

  const grounded = (): { ref: EvidenceReference; grounded: boolean } => ({ ref: { ...r, validated: true }, grounded: true });

  if (cat === 'BUSINESS_UNDERSTANDING') return r.refId != null && m.conclusionIds.has(r.refId) ? grounded() : { rejected: 'NOT_IN_MANIFEST' };
  if (cat === 'PUBLIC_POSITIONING_CONTEXT') {
    const ok = (r.refId != null && m.findingIds.has(r.refId)) || (r.entityId != null && m.entityIds.has(r.entityId)) || (r.sourceUrl != null && m.sourceUrls.has(r.sourceUrl));
    return ok ? grounded() : { rejected: 'NOT_IN_MANIFEST' };
  }
  if (cat === 'FOUNDER_STRATEGIC_CONTEXT') {
    if (r.logicalItemId != null) { const exact = m.contextItemVersionByLogical.get(r.logicalItemId); if (!exact) return { rejected: 'NOT_IN_MANIFEST' }; if ((r.refId != null && r.refId !== exact.id) || (r.version != null && r.version !== exact.version)) return { rejected: 'VERSION_MISMATCH' }; return grounded(); }
    return r.refId != null && m.contextItemIds.has(r.refId) ? grounded() : { rejected: 'NOT_IN_MANIFEST' };
  }
  // FOUNDER_ANY — a founder declaration/correction may reference a conclusion the founder responded to, or a context item.
  if (r.logicalItemId != null) { const exact = m.contextItemVersionByLogical.get(r.logicalItemId); return exact && (r.refId == null || r.refId === exact.id) && (r.version == null || r.version === exact.version) ? grounded() : { rejected: exact ? 'VERSION_MISMATCH' : 'NOT_IN_MANIFEST' }; }
  const okFounder = r.refId != null && (m.conclusionIds.has(r.refId) || m.respondedConclusionIds.has(r.refId) || m.contextItemIds.has(r.refId));
  return okFounder ? grounded() : { rejected: 'NOT_IN_MANIFEST' };
}

/** Deterministically validate a reference array: dedup, classify, collect kept refs + rejections + validated-grounded count. */
function validateArray(arr: EvidenceReference[], m: ProvenanceManifest, rejected: ReferenceRejection[]): { kept: EvidenceReference[]; validatedGrounded: number } {
  const seen = new Set<string>(); const kept: EvidenceReference[] = []; let validatedGrounded = 0;
  for (const r of arr) {
    const key = `${r.kind}|${r.refId ?? ''}|${r.entityId ?? ''}|${r.logicalItemId ?? ''}|${r.version ?? ''}|${r.sourceUrl ?? ''}`;
    if ((r.refId != null || r.entityId != null || r.logicalItemId != null || r.sourceUrl != null) && seen.has(key)) { rejected.push({ kind: r.kind, reason: 'DUPLICATE' }); continue; }
    seen.add(key);
    const c = classifyRef(r, m);
    if ('rejected' in c) { rejected.push({ kind: r.kind, reason: c.rejected }); continue; }
    kept.push(c.ref); if (c.grounded) validatedGrounded += 1;
  }
  return { kept, validatedGrounded };
}

/**
 * Validate a normalized outcome against the manifest and apply the governed degradation policy. Returns the CLEANED
 * outcome (invalid grounded refs removed; validated refs marked) + a validation summary. If a recommendation retains no
 * validated grounded reference in supportingEvidence ∪ founderDeclarations, it is downgraded to INSUFFICIENT.
 */
export function validateRecommendationProvenance(outcome: StrategicOutcome, m: ProvenanceManifest): { outcome: StrategicOutcome; validation: ProvenanceValidation } {
  const rejected: ReferenceRejection[] = [];
  const cleanOptions = (oa: InsufficientStrategicEvidence['optionAssessment']) =>
    oa?.map((o) => (o.excludedByContextRefId && !m.contextItemIds.has(o.excludedByContextRefId) ? { ...o, excludedByContextRefId: null } : o));

  if (outcome.kind === 'INSUFFICIENT_STRATEGIC_EVIDENCE') {
    const oa = cleanOptions(outcome.optionAssessment);
    return { outcome: { ...outcome, ...(oa ? { optionAssessment: oa } : {}) }, validation: { manifestVersion: m.manifestVersion, groundingStatus: 'NOT_APPLICABLE', validatedCount: 0, rejectedCount: rejected.length, rejected } };
  }

  const support = validateArray(outcome.reasoning.supportingEvidence, m, rejected);
  const decl = validateArray(outcome.reasoning.founderDeclarations, m, rejected);
  const counter = validateArray(outcome.reasoning.counterEvidence, m, rejected);
  const conflicts = outcome.reasoning.conflicts.map((c) => (c.refId != null && !m.conclusionIds.has(c.refId) ? (rejected.push({ kind: 'CONFLICT', reason: 'NOT_IN_MANIFEST' }), { ...c, refId: null }) : c));
  const oa = cleanOptions(outcome.optionAssessment);
  const validatedGrounded = support.validatedGrounded + decl.validatedGrounded;
  const validatedCount = validatedGrounded + counter.validatedGrounded;

  // Law 8 — no validated grounded basis remains → downgrade to INSUFFICIENT (grounding failure), never a baseless claim.
  if (validatedGrounded === 0) {
    const ins: InsufficientStrategicEvidence = {
      kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE',
      whatIsMissing: ['Grounded references — I couldn’t tie this recommendation to the specific business, positioning, or strategic-context records you gave me.'],
      whyItMatters: 'A priority call has to point at your actual records. Without that, it would be a confident guess.',
      smallestEvidenceAction: 'Confirm your business understanding, or add and review a competitor’s public site, so there’s something specific to reason from.',
      provisionalPossible: false,
      whatNotToConcludeYet: ['That any specific channel/offer/positioning is right yet.'],
      ...(oa ? { optionAssessment: oa } : {}),
    };
    return { outcome: ins, validation: { manifestVersion: m.manifestVersion, groundingStatus: 'UNGROUNDED', validatedCount: 0, rejectedCount: rejected.length, rejected } };
  }

  const cleaned: StrategicRecommendation = {
    ...outcome,
    reasoning: { ...outcome.reasoning, supportingEvidence: support.kept, founderDeclarations: decl.kept, counterEvidence: counter.kept, conflicts },
    ...(oa ? { optionAssessment: oa } : {}),
  };
  return { outcome: cleaned, validation: { manifestVersion: m.manifestVersion, groundingStatus: rejected.length > 0 ? 'DEGRADED' : 'GROUNDED', validatedCount, rejectedCount: rejected.length, rejected } };
}
