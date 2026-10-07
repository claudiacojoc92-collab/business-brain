import { ApplicationError } from '@bb/shared';
import { generateId } from '@bb/shared';
import type { Clock, RecognitionEvent, RecognitionResponse, SubjectRef } from '@bb/domain';
import type {
  RecognitionAppendCommand,
  RecognitionAppendOutcome,
  RecognitionAppendResult,
  RecognitionEventSink,
  RecognitionRepos,
  RecognitionUnitOfWork,
} from './recognition-ports';

const VALID_RESPONSES: ReadonlySet<RecognitionResponse> = new Set<RecognitionResponse>([
  'founder_recognized',
  'founder_qualified',
  'founder_rejected',
]);

export interface IRecognitionAppendService {
  append(command: RecognitionAppendCommand): Promise<RecognitionAppendResult>;
}

/**
 * Appends a founder RecognitionEvent to the append-only log.
 *
 * Idempotency and conflict are BUSINESS-scoped by clientEventId (never scoped to a semanticKey):
 *   - equivalent retry (same immutable intent) → return the ORIGINAL event, replayed:true, no new
 *     append sequence, no "new append" side effect;
 *   - same (businessRef, clientEventId) with ANY differing immutable field (snapshotId,
 *     statementSemanticKey, statementVersionId, response, note) — regardless of semanticKey →
 *     governed RECOGNITION_CLIENT_EVENT_CONFLICT;
 *   - an assigned-id collision with divergent content → governed RECOGNITION_EVENT_ID_CONFLICT.
 * No raw persistence error is exposed.
 *
 * clientEventId replay is resolved BEFORE server identity/time are minted, so a genuine retry is never
 * misclassified as a conflict just because a fresh id or a later clock reading was generated. Referential
 * validation (snapshot exists for this business, exact statement version, matching semanticKey) runs only
 * for genuinely-new events. No prior snapshot is loaded and no confidence/scope/corpus/context compared.
 */
export class RecognitionAppendService implements IRecognitionAppendService {
  constructor(
    private readonly deps: {
      readonly uow: RecognitionUnitOfWork;
      readonly clock: Clock;
      readonly events: RecognitionEventSink;
    },
  ) {}

  async append(command: RecognitionAppendCommand): Promise<RecognitionAppendResult> {
    if (!VALID_RESPONSES.has(command.response)) {
      throw new ApplicationError('RECOGNITION_INVALID_RESPONSE', `Unsupported recognition response: ${command.response}.`, 422);
    }

    const outcome = await this.deps.uow.run(command.businessRef, async (repos) => this.applyWithin(command, repos));

    switch (outcome.kind) {
      case 'client_event_conflict':
        throw new ApplicationError(
          'RECOGNITION_CLIENT_EVENT_CONFLICT',
          `clientEventId ${command.clientEventId} was already used for a different recognition.`,
          409,
        );
      case 'event_id_conflict':
        // Server-assigned id collided with divergent content — an internal integrity violation, surfaced
        // as a stable governed error rather than a raw SQL/constraint error.
        throw new ApplicationError(
          'RECOGNITION_EVENT_ID_CONFLICT',
          'A recognition event id collided with conflicting content.',
          500,
        );
      case 'replayed':
        // §B: idempotent replay — no new "append" side effect is emitted.
        return { event: outcome.stored, replayed: true };
      case 'created':
        this.deps.events.recognitionAppended({
          businessRef: command.businessRef,
          snapshotId: command.snapshotId,
          statementSemanticKey: command.statementSemanticKey,
          statementVersionId: command.statementVersionId,
          response: command.response,
          replayed: false,
        });
        return { event: outcome.stored, replayed: false };
    }
  }

  private async applyWithin(command: RecognitionAppendCommand, repos: RecognitionRepos): Promise<RecognitionAppendOutcome> {
    // 1. Business-scoped replay/conflict resolution BEFORE minting server identity/time.
    const prior = await repos.recognition.findByClientEventId(command.businessRef, command.clientEventId);
    if (prior) {
      return sameIntent(prior, command) ? { kind: 'replayed', stored: prior } : { kind: 'client_event_conflict' };
    }

    // 2. Referential validation — only for genuinely-new events.
    const snapshot = await repos.snapshots.byId(command.businessRef, command.snapshotId);
    if (!snapshot) {
      throw new ApplicationError('RECOGNITION_SNAPSHOT_NOT_FOUND', `No snapshot ${command.snapshotId} for this business.`, 404);
    }
    const statement = snapshot.observedStatements.find((s) => s.versionId === command.statementVersionId);
    if (!statement) {
      throw new ApplicationError(
        'RECOGNITION_STATEMENT_NOT_FOUND',
        `Snapshot ${command.snapshotId} has no observed statement at version ${command.statementVersionId}.`,
        422,
      );
    }
    if (statement.semanticKey !== command.statementSemanticKey) {
      throw new ApplicationError(
        'RECOGNITION_SEMANTIC_KEY_MISMATCH',
        `Statement version ${command.statementVersionId} does not carry semanticKey ${command.statementSemanticKey}.`,
        422,
      );
    }

    // 3. Mint server-owned identity/time AFTER replay is resolved.
    const event: RecognitionEvent = {
      id: generateId(),
      businessRef: command.businessRef,
      snapshotId: command.snapshotId,
      statementSemanticKey: command.statementSemanticKey,
      statementVersionId: command.statementVersionId,
      response: command.response,
      ...(command.note !== undefined ? { note: command.note } : {}),
      at: this.deps.clock.now(),
      clientEventId: command.clientEventId,
    };

    // 4. Race-safe authoritative write: under the per-business append-sequence lock the repo re-checks
    //    clientEventId + id, so a concurrent winner is mapped (replayed/conflict), never a raw error.
    return repos.recognition.appendIdempotent(command.businessRef, event);
  }
}

/**
 * Immutable replay-equivalence signature. Server-assigned fields — the RecognitionEventId, `at`, and the
 * append sequence — DO NOT participate: a genuine retry (fresh id / later clock) must classify as a replay,
 * not a conflict. The client-owned immutable fields that DO participate: businessRef, snapshotId,
 * statementSemanticKey, statementVersionId, response, note.
 */
function sameIntent(prior: RecognitionEvent, command: RecognitionAppendCommand): boolean {
  return (
    sameRef(prior.businessRef, command.businessRef) &&
    prior.snapshotId === command.snapshotId &&
    prior.statementSemanticKey === command.statementSemanticKey &&
    prior.statementVersionId === command.statementVersionId &&
    prior.response === command.response &&
    (prior.note ?? undefined) === (command.note ?? undefined)
  );
}

function sameRef(a: SubjectRef, b: SubjectRef): boolean {
  return a.type === b.type && a.id === b.id;
}
