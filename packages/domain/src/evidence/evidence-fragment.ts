import { createHash } from 'node:crypto';

/**
 * Evidence fragment — the atomic unit of the append-only evidence store (ADR-007 §2).
 *
 * Honesty is structural, not advisory:
 *   - observed  → must carry a real source (sourceUrl present).
 *   - inferred  → must carry non-empty derivedFrom (provenance to the fragments it came from).
 *   - declared  → conversation-sourced (a later slice); no sourceUrl, no derivedFrom required.
 * A fragment that violates its kind's rule is rejected at construction (fail closed).
 */
export type ConfidenceKind = 'observed' | 'declared' | 'inferred';
export type Visibility = 'public' | 'private' | 'founder_only';

export interface EvidenceFragment {
  readonly id: string;            // content-addressed (sha256 hex) — identical content dedupes
  readonly founderId: string;
  readonly source: string;        // e.g. 'website'
  readonly platform: string | null;
  readonly sourceUrl: string | null;
  readonly confidenceKind: ConfidenceKind;
  readonly occurredAt: Date | null;
  readonly capturedAt: Date;
  readonly visibility: Visibility;
  readonly payload: Record<string, unknown>;
  readonly derivedFrom: readonly string[] | null;
}

/** Thrown when a fragment would violate the structural honesty rules. */
export class EvidenceHonestyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceHonestyError';
  }
}

/**
 * Content-addressed id: sha256 over the identity-bearing content. Deterministic, so
 * re-reading the same page/source produces the same id and dedupes on insert.
 */
export function contentAddress(input: {
  founderId: string;
  source: string;
  sourceUrl: string | null;
  confidenceKind: ConfidenceKind;
  payload: Record<string, unknown>;
  derivedFrom?: readonly string[] | null;
}): string {
  const canonical = JSON.stringify({
    founderId: input.founderId,
    source: input.source,
    sourceUrl: input.sourceUrl ?? null,
    confidenceKind: input.confidenceKind,
    payload: input.payload,
    derivedFrom: input.derivedFrom && input.derivedFrom.length ? [...input.derivedFrom].sort() : null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Enforce the structural honesty rules. Throws EvidenceHonestyError on violation. */
export function assertFragmentHonest(f: {
  confidenceKind: ConfidenceKind;
  sourceUrl: string | null;
  derivedFrom: readonly string[] | null;
  source: string;
}): void {
  if (!f.source || f.source.trim() === '') {
    throw new EvidenceHonestyError('Fragment has no source.');
  }
  if (f.confidenceKind === 'observed' && !f.sourceUrl) {
    throw new EvidenceHonestyError('Observed fragment must carry a real source (sourceUrl).');
  }
  if (f.confidenceKind === 'inferred' && (!f.derivedFrom || f.derivedFrom.length === 0)) {
    throw new EvidenceHonestyError('Inferred fragment must carry non-empty derivedFrom (provenance).');
  }
}

/**
 * Smart constructor: builds a fully-formed, honest fragment (content-addressed id,
 * honesty rules enforced). This is the ONLY sanctioned way to mint a fragment; the
 * store persists what this produces. Fails closed.
 */
export function makeFragment(input: {
  founderId: string;
  source: string;
  platform?: string | null;
  sourceUrl?: string | null;
  confidenceKind: ConfidenceKind;
  occurredAt?: Date | null;
  capturedAt?: Date;
  visibility?: Visibility;
  payload: Record<string, unknown>;
  derivedFrom?: readonly string[] | null;
}): EvidenceFragment {
  const sourceUrl = input.sourceUrl ?? null;
  const derivedFrom = input.derivedFrom && input.derivedFrom.length ? input.derivedFrom : null;

  assertFragmentHonest({
    confidenceKind: input.confidenceKind,
    sourceUrl,
    derivedFrom,
    source: input.source,
  });

  return {
    id: contentAddress({
      founderId: input.founderId,
      source: input.source,
      sourceUrl,
      confidenceKind: input.confidenceKind,
      payload: input.payload,
      derivedFrom,
    }),
    founderId: input.founderId,
    source: input.source,
    platform: input.platform ?? null,
    sourceUrl,
    confidenceKind: input.confidenceKind,
    occurredAt: input.occurredAt ?? null,
    capturedAt: input.capturedAt ?? new Date(),
    visibility: input.visibility ?? 'public',
    payload: input.payload,
    derivedFrom,
  };
}
