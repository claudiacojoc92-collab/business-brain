import type { DeclarationId, Scalar, SubjectRef } from '../shared/types';

/**
 * A projection over FounderDeclaration for the snapshot's "You told us" lane. NOT a source of truth
 * and NOT a SnapshotStatement — it never enters the observed lane. Only the understanding-eligible
 * declaration kinds surface here.
 */
export interface DeclaredContextView {
  readonly declarationId: DeclarationId;
  readonly kind: 'self_report' | 'intent' | 'decision';
  readonly subject: SubjectRef;
  readonly canonicalValue: Scalar;
  readonly renderedText: string;
}
