import type { FounderDeclaration, SubjectRef } from '@bb/domain';
import type { DeclarationLog } from './declaration-ports';

export interface IDeclarationReadService {
  history(businessRef: SubjectRef): Promise<readonly FounderDeclaration[]>;
  effectiveUnderstanding(businessRef: SubjectRef): Promise<readonly FounderDeclaration[]>;
}

/**
 * Read-only access to the append-only declaration log. `history` returns every declaration for the
 * business in append-sequence order (what the founder declared, and when — NOT "current truth").
 * `effectiveUnderstanding` delegates to the frozen DeclarationRepository semantics: understanding-eligible
 * KINDS only (self_report / intent / decision), append-ordered. No supersession is resolved, no snapshot is
 * read, no status is derived, nothing is written.
 */
export class DeclarationReadService implements IDeclarationReadService {
  constructor(private readonly deps: { readonly declarations: DeclarationLog }) {}

  async history(businessRef: SubjectRef): Promise<readonly FounderDeclaration[]> {
    return this.deps.declarations.history(businessRef);
  }

  async effectiveUnderstanding(businessRef: SubjectRef): Promise<readonly FounderDeclaration[]> {
    return this.deps.declarations.effectiveUnderstanding(businessRef);
  }
}
