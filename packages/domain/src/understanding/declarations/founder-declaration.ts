import type { DeclarationId, SubjectRef, Timestamp } from '../shared/types';

/**
 * Founder declaration. Authoritative for the founder's own intent/self-description — NEVER evidence
 * of external reality (that customers/market/channels agree). Renders as "You told us…".
 * `self_report` was added to the bounded vocabulary for self-description; the observed lane is never
 * rewritten by a declaration (only a FacetCorrection changes an observed facet).
 */
export type DeclarationKind =
  | 'self_report'
  | 'intent'
  | 'decision'
  | 'objective'
  | 'preference'
  | 'constraint';

export interface FounderDeclaration {
  readonly id: DeclarationId;
  readonly businessRef: SubjectRef;
  readonly kind: DeclarationKind;
  readonly subject: SubjectRef;
  readonly statement: string;
  readonly provenance: 'founder_declared';
  readonly declaredAt: Timestamp;
  readonly supersedes?: DeclarationId;
}
