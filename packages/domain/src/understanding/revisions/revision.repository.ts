import type { SubjectRef } from '../shared/types';
import type { CorpusRevision } from '../ingestion/corpus-revision';
import type { CorpusRevisionId, DeclarationRevisionId } from './revision-ids';

/**
 * Named-revision store (port). Business-scoped — there is NO process-global current corpus or
 * understanding context. Corpus bumps on evidence change; understanding context bumps only on
 * understanding-eligible declaration change (never on relevance-only profile changes).
 */
export interface RevisionRepository {
  currentCorpus(businessRef: SubjectRef): Promise<CorpusRevisionId>;
  currentUnderstandingCtx(businessRef: SubjectRef): Promise<DeclarationRevisionId>;
  bumpCorpus(businessRef: SubjectRef, next: CorpusRevision): Promise<CorpusRevisionId>;
  bumpUnderstandingCtx(businessRef: SubjectRef): Promise<DeclarationRevisionId>;
}
