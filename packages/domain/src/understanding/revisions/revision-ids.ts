/**
 * Named revision ids. These separate the two axes that can change an Understanding projection:
 *  - CorpusRevision:            evidence changes (RawCapture/Observation/facet-correction/deletion);
 *  - UnderstandingContextRevision: understanding-eligible declaration changes (self_report / relevant
 *                               intent / relevant decision) — EXCLUDES relevance-only profile changes.
 *
 * There is deliberately NO profile-revision id in this codebase: goal/priority/preference changes
 * are relevance-only and never mint a snapshot version.
 */
export type CorpusRevisionId = string;
export type DeclarationRevisionId = string;
