import { ApplicationError } from '@bb/shared';
import { generateId } from '@bb/shared';
import type { Clock, SnapshotPresentedEvent } from '@bb/domain';
import type {
  PresentationAppendCommand,
  PresentationAppendResult,
  PresentationEventSink,
  PresentationRepos,
  PresentationUnitOfWork,
  PresentedEventAppendOutcome,
} from './presentation-ports';

export interface IPresentationAppendService {
  append(command: PresentationAppendCommand): Promise<PresentationAppendResult>;
}

/**
 * Appends a SnapshotPresentedEvent — a narrow, append-only marker that a snapshot was served to the
 * founder. Creating one NEVER mints a new SnapshotVersion and NEVER mutates recognition/review/status;
 * it is informational (Commit 5/6 SnapshotStatus derivation is preserved). Events are never mutated.
 *
 * Idempotency and conflict are BUSINESS-scoped by clientEventId (mirroring Commits 5–6):
 *   - equivalent retry (same snapshotId) → return the ORIGINAL event, replayed:true, no new append
 *     sequence, no "new append" side effect;
 *   - same (businessRef, clientEventId) with a differing snapshotId → governed
 *     PRESENTATION_CLIENT_EVENT_CONFLICT;
 *   - an assigned-id collision with divergent content → governed PRESENTATION_EVENT_ID_CONFLICT.
 * No raw persistence error is exposed. clientEventId replay is resolved BEFORE server identity/time are
 * minted. Referential validation (snapshot exists for this business — the presentation target) runs only
 * for genuinely-new events.
 */
export class PresentationAppendService implements IPresentationAppendService {
  constructor(
    private readonly deps: {
      readonly uow: PresentationUnitOfWork;
      readonly clock: Clock;
      readonly events: PresentationEventSink;
    },
  ) {}

  async append(command: PresentationAppendCommand): Promise<PresentationAppendResult> {
    const outcome = await this.deps.uow.run(command.businessRef, async (repos) => this.applyWithin(command, repos));

    switch (outcome.kind) {
      case 'client_event_conflict':
        throw new ApplicationError(
          'PRESENTATION_CLIENT_EVENT_CONFLICT',
          `clientEventId ${command.clientEventId} was already used for a different presentation.`,
          409,
        );
      case 'event_id_conflict':
        throw new ApplicationError('PRESENTATION_EVENT_ID_CONFLICT', 'A presented-event id collided with conflicting content.', 500);
      case 'replayed':
        return { presentation: outcome.stored, replayed: true };
      case 'created':
        this.deps.events.presentationAppended({
          businessRef: command.businessRef,
          snapshotId: command.snapshotId,
          presentedEventId: outcome.stored.id,
          replayed: false,
        });
        return { presentation: outcome.stored, replayed: false };
    }
  }

  private async applyWithin(command: PresentationAppendCommand, repos: PresentationRepos): Promise<PresentedEventAppendOutcome> {
    // 1. Business-scoped replay/conflict resolution BEFORE minting server identity/time.
    const prior = await repos.presentations.findByClientEventId(command.businessRef, command.clientEventId);
    if (prior) {
      return prior.snapshotId === command.snapshotId ? { kind: 'replayed', stored: prior } : { kind: 'client_event_conflict' };
    }

    // 2. Referential validation — the presentation target (snapshot) must exist for THIS business.
    const snapshot = await repos.snapshots.byId(command.businessRef, command.snapshotId);
    if (!snapshot) {
      throw new ApplicationError('PRESENTATION_SNAPSHOT_NOT_FOUND', `No snapshot ${command.snapshotId} for this business.`, 404);
    }

    // 3. Mint server-owned identity/time AFTER replay is resolved.
    const event: SnapshotPresentedEvent = {
      id: generateId(),
      businessRef: command.businessRef,
      snapshotId: command.snapshotId,
      at: this.deps.clock.now(),
    };

    // 4. Race-safe authoritative write under the per-business append-sequence lock.
    return repos.presentations.appendIdempotent(command.businessRef, event, command.clientEventId);
  }
}
