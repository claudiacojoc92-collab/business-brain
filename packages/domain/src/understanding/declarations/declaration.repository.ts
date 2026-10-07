import type { SubjectRef } from '../shared/types';
import type { FounderDeclaration } from './founder-declaration';
import type { StatementDeclarationLink } from './statement-declaration-link';

/**
 * Append-only declaration store (port). `effectiveUnderstanding` returns only understanding-eligible
 * declarations (self_report / relevant intent / relevant decision). Business-scoped.
 */
export interface DeclarationRepository {
  append(businessRef: SubjectRef, declaration: FounderDeclaration): Promise<void>;
  link(businessRef: SubjectRef, link: StatementDeclarationLink): Promise<void>;
  effectiveUnderstanding(businessRef: SubjectRef): Promise<readonly FounderDeclaration[]>;
}
