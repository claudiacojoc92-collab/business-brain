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

// ── Immutable serialized manifest (Blocker 1 remediation) ────────────────────────────────────────────────
// Persisted transactionally with the terminal outcome (V071) so the EXACT allowed-reference set is reconstructable
// without the assembler or current effective context. No display labels, no source bodies — immutable ids + versions.
export type ManifestSpace = 'CONCLUSION' | 'RESPONDED_CONCLUSION' | 'ENTITY' | 'FINDING' | 'SOURCE_URL' | 'CONTEXT_ITEM';
export interface SerializedManifestEntry { space: ManifestSpace; id: string; logicalItemId?: string; version?: number; suppliedToModel: true }
export interface SerializedProvenanceManifest { manifestVersion: string; understandingVersion: number | null; entries: SerializedManifestEntry[] }
// Read side accepts a widened `space` (a persisted/round-tripped manifest carries a plain string): deserialize narrows
// deterministically and ignores any unknown space, so an older or foreign shape can never manufacture a reference.
export interface ReadableSerializedManifest { manifestVersion: string; understandingVersion: number | null; entries: Array<{ space: string; id: string; logicalItemId?: string; version?: number; suppliedToModel?: boolean }> }

/** Serialize a manifest to the immutable, persistable form (stable order; every entry was supplied to the model). */
export function serializeProvenanceManifest(m: ProvenanceManifest): SerializedProvenanceManifest {
  const entries: SerializedManifestEntry[] = [];
  for (const id of m.conclusionIds) entries.push({ space: 'CONCLUSION', id, suppliedToModel: true });
  for (const id of m.respondedConclusionIds) entries.push({ space: 'RESPONDED_CONCLUSION', id, suppliedToModel: true });
  for (const id of m.entityIds) entries.push({ space: 'ENTITY', id, suppliedToModel: true });
  for (const id of m.findingIds) entries.push({ space: 'FINDING', id, suppliedToModel: true });
  for (const value of m.sourceUrls) entries.push({ space: 'SOURCE_URL', id: value, suppliedToModel: true });
  for (const [logicalItemId, v] of m.contextItemVersionByLogical) entries.push({ space: 'CONTEXT_ITEM', id: v.id, logicalItemId, version: v.version, suppliedToModel: true });
  // context items with no logical-id mapping edge-case: include any bare context id not already covered
  for (const id of m.contextItemIds) if (![...m.contextItemVersionByLogical.values()].some((v) => v.id === id)) entries.push({ space: 'CONTEXT_ITEM', id, suppliedToModel: true });
  return { manifestVersion: m.manifestVersion, understandingVersion: m.understandingVersion, entries };
}

/** Rebuild the exact manifest (Sets/Maps) from a persisted serialized form — classifyRef validates against it unchanged. */
export function deserializeProvenanceManifest(s: ReadableSerializedManifest): ProvenanceManifest {
  const m: ProvenanceManifest = {
    manifestVersion: s.manifestVersion, understandingVersion: s.understandingVersion,
    conclusionIds: new Set(), respondedConclusionIds: new Set(), entityIds: new Set(), findingIds: new Set(),
    sourceUrls: new Set(), contextItemIds: new Set(), contextItemVersionByLogical: new Map(),
  };
  for (const e of s.entries) {
    if (e.space === 'CONCLUSION') m.conclusionIds.add(e.id);
    else if (e.space === 'RESPONDED_CONCLUSION') m.respondedConclusionIds.add(e.id);
    else if (e.space === 'ENTITY') m.entityIds.add(e.id);
    else if (e.space === 'FINDING') m.findingIds.add(e.id);
    else if (e.space === 'SOURCE_URL') m.sourceUrls.add(e.id);
    else if (e.space === 'CONTEXT_ITEM') { m.contextItemIds.add(e.id); if (e.logicalItemId != null && e.version != null) m.contextItemVersionByLogical.set(e.logicalItemId, { id: e.id, version: e.version }); }
  }
  return m;
}

/** Historical revalidation — deterministic, against the STORED manifest only (never the assembler / current effective). */
export function revalidateAgainstStoredManifest(outcome: StrategicOutcome, stored: ReadableSerializedManifest): { outcome: StrategicOutcome; validation: ProvenanceValidation } {
  return validateRecommendationProvenance(outcome, deserializeProvenanceManifest(stored));
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

// ── Whole-outcome grounding integrity (Blocker 2 remediation — Option B) ──────────────────────────────────
// The recommendation schema attaches references at the recommendation-GLOBAL level (a bag); the load-bearing surfaces
// (title/action prose, optionAssessment.supportedByEvidence, nextStep, alternatives) are not reliably bound to exact
// references. So a partially-grounded recommendation (any invalid grounding reference removed) cannot prove its primary
// claim is still grounded — an unrelated valid reference must not launder it. A DEGRADED recommendation therefore fails
// grounding integrity and, after a bounded retry, must degrade to INSUFFICIENT rather than persist as grounded READY.

/** True when a validated recommendation still lost a grounding reference (DEGRADED) — grounding integrity has failed. */
export function groundingIntegrityFailed(v: ProvenanceValidation): boolean { return v.groundingStatus === 'DEGRADED'; }

/** Founder-safe phrases that assert grounding. Used to prove the terminal degrade outcome carries none. */
const GROUNDING_PHRASES: readonly RegExp[] = [
  /your evidence shows/i, /the evidence (?:shows|proves)/i, /your data proves/i, /based on the supplied source/i,
  /according to your business context/i, /the founder context establishes/i, /your records show/i,
  /grounded in your/i, /as your .* (?:shows|proves|confirms)/i,
];
/** Deterministic guard: does this text assert grounding? (No LLM; the degrade outcome must return false here.) */
export function assertsGroundingClaim(text: string): boolean { return GROUNDING_PHRASES.some((re) => re.test(text)); }

/** Option B — turn a grounding-integrity-failed recommendation into the terminal INSUFFICIENT outcome. No grounding
 *  language survives; any bounded-option `supportedByEvidence` flag is cleared (it cannot be substantiated). Rejections
 *  are preserved (redacted); groundingStatus becomes UNGROUNDED (no grounded outcome is persisted). */
export function degradeForGroundingIntegrity(outcome: StrategicOutcome, validation: ProvenanceValidation): { outcome: InsufficientStrategicEvidence; validation: ProvenanceValidation } {
  const rawOa = (outcome as { optionAssessment?: InsufficientStrategicEvidence['optionAssessment'] }).optionAssessment;
  const oa = rawOa?.map((o) => ({ ...o, supportedByEvidence: false })); // cannot substantiate evidence-support after a grounding failure
  const ins: InsufficientStrategicEvidence = {
    kind: 'INSUFFICIENT_STRATEGIC_EVIDENCE',
    whatIsMissing: ['A recommendation I could fully ground in your specific records — some of the evidence it leaned on didn’t match anything you’ve given me.'],
    whyItMatters: 'A priority call has to point only at your actual records. I’d rather tell you I can’t ground it yet than hand you a confident answer built partly on evidence that isn’t there.',
    smallestEvidenceAction: 'Confirm your business understanding, or add and review a competitor’s public site, so there’s more specific, verifiable evidence to reason from.',
    provisionalPossible: false,
    whatNotToConcludeYet: ['That any specific channel, offer, or positioning is right yet — the supporting evidence didn’t fully check out.'],
    ...(oa && oa.length ? { optionAssessment: oa } : {}),
  };
  return { outcome: ins, validation: { ...validation, groundingStatus: 'UNGROUNDED' } };
}
