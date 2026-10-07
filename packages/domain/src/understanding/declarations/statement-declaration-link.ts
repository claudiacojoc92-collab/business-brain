import type { DeclarationId } from '../shared/types';

/**
 * Links a statement's stable semanticKey to a declaration created by an explicit "Save to my profile"
 * action. Recognition and declaration creation are INDEPENDENT: this link exists only when the
 * founder explicitly saved; it never turns an observed statement's recognition into a declared state.
 */
export interface StatementDeclarationLink {
  readonly statementSemanticKey: string;
  readonly declarationId: DeclarationId;
  readonly createdFromExplicitSave: true;
}
