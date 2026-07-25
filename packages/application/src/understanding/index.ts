/** Understanding→Audit vertical slice — application surface (Commit 2: fixture ingestion). */
export type {
  FixtureFile,
  IngestionIdempotencyStore,
  IngestionRepos,
  IngestionUnitOfWork,
  IngestionEventSink,
  EntryRejectedReason,
  EntryRejectedEvent,
  RevisionCreatedEvent,
} from './ports';
export { FixtureIngestionService } from './fixture-ingestion.service';
export type { IFixtureIngestionService } from './fixture-ingestion.service';
