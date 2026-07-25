import { createHash } from 'node:crypto';
import { canonicalStringify, sortedUnique } from './canonicalize';
import type { Scalar, ScopeDescription, SubjectRef } from './types';

/**
 * Deterministic identity helpers (sha256 over canonicalized inputs). Frozen formulas.
 *
 * Invariants (see identity tests):
 *  - object-key order never changes a hash (canonicalStringify);
 *  - set-like inputs are explicitly sorted (sortedUnique) before hashing;
 *  - rendered wording, renderVersion, locale, review, recognition, status and wall-clock
 *    timestamps NEVER enter any of these ids.
 */
function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function hashParts(parts: Record<string, unknown>): string {
  return sha256Hex(canonicalStringify(parts));
}

/** RawCapture id = hash(source, externalId, canonical captured payload). */
export function rawCaptureId(input: {
  source: string;
  externalId: string;
  capturedPayload: unknown;
}): string {
  return hashParts({
    source: input.source,
    externalId: input.externalId,
    capturedPayload: input.capturedPayload,
  });
}

/** NormalizedObservation id = hash(rawCaptureId, normalizationRuleVersion, canonical normalized payload). */
export function normalizedObservationId(input: {
  rawCaptureId: string;
  normalizationRuleVersion: string;
  payload: unknown;
}): string {
  return hashParts({
    rawCaptureId: input.rawCaptureId,
    normalizationRuleVersion: input.normalizationRuleVersion,
    payload: input.payload,
  });
}

/** Facet id = hash(observationId, kind, ruleKey, ruleVersion, extractionProfile, canonical value). */
export function facetId(input: {
  observationId: string;
  kind: string;
  ruleKey: string;
  ruleVersion: string;
  extractionProfile: string;
  value: string;
}): string {
  return hashParts({
    observationId: input.observationId,
    kind: input.kind,
    ruleKey: input.ruleKey,
    ruleVersion: input.ruleVersion,
    extractionProfile: input.extractionProfile,
    value: input.value,
  });
}

/** Deterministic fingerprint of a scope (sources are set-like → sorted). */
export function scopeFingerprint(scope: ScopeDescription): string {
  return hashParts({
    sources: sortedUnique(scope.sources),
    window: scope.window,
    corpusSize: scope.corpusSize,
  });
}

/** Snapshot semanticKey = hash(definitionKey, definitionVersion, subject, canonicalParams, canonicalizationVersion). */
export function snapshotSemanticKey(input: {
  definitionKey: string;
  definitionVersion: number;
  subject: SubjectRef;
  canonicalParams: Record<string, Scalar>;
  canonicalizationVersion: string;
}): string {
  return hashParts({
    definitionKey: input.definitionKey,
    definitionVersion: input.definitionVersion,
    subject: input.subject,
    canonicalParams: input.canonicalParams,
    canonicalizationVersion: input.canonicalizationVersion,
  });
}

/**
 * Statement versionId — FROZEN formula:
 * hash(semanticKey, corpusRevision, understandingContextRevision, generationProfileVersion,
 *      scopeFingerprint, confidence).
 * renderVersion / locale are deliberately absent.
 */
export function statementVersionId(input: {
  semanticKey: string;
  corpusRevision: string;
  understandingContextRevision: string;
  generationProfileVersion: string;
  scopeFingerprint: string;
  confidence: string;
}): string {
  return hashParts({
    semanticKey: input.semanticKey,
    corpusRevision: input.corpusRevision,
    understandingContextRevision: input.understandingContextRevision,
    generationProfileVersion: input.generationProfileVersion,
    scopeFingerprint: input.scopeFingerprint,
    confidence: input.confidence,
  });
}

/**
 * CorpusRevision id — FROZEN formula: sha256(orderedObservationIds, activeFacetCorrectionIds).
 * Observation order is SEMANTIC (source fixture order) and preserved; facet-correction ids are
 * set-like and sorted. Deliberately excludes createdAt/capturedAt/businessRef/filename/db ids.
 */
export function corpusRevisionId(input: {
  observationIds: readonly string[];
  activeFacetCorrectionIds: readonly string[];
}): string {
  return hashParts({
    observationIds: [...input.observationIds],
    activeFacetCorrectionIds: sortedUnique(input.activeFacetCorrectionIds),
  });
}

/** Fixture-ingestion idempotency key = sha256(canonical fixture input). Scoped by business at the store. */
export function fixtureIngestionKey(fixture: unknown): string {
  return sha256Hex(canonicalStringify(fixture));
}

/**
 * BusinessSnapshotVersion id — FROZEN formula. Statement version ids and declared-context
 * declaration ids are hashed in a canonical (sorted) order, so equivalent unordered inputs
 * produce the same snapshotId. Display order is a generation concern, not part of identity.
 */
export function businessSnapshotVersionId(input: {
  businessRef: SubjectRef;
  corpusRevision: string;
  understandingContextRevision: string;
  generationProfileVersion: string;
  observedStatementVersionIds: readonly string[];
  declaredContextDeclarationIds: readonly string[];
}): string {
  return hashParts({
    businessRef: input.businessRef,
    corpusRevision: input.corpusRevision,
    understandingContextRevision: input.understandingContextRevision,
    generationProfileVersion: input.generationProfileVersion,
    observedStatementVersionIds: sortedUnique(input.observedStatementVersionIds),
    declaredContextDeclarationIds: sortedUnique(input.declaredContextDeclarationIds),
  });
}
