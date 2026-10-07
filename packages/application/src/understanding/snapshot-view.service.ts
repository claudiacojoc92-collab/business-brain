import { ApplicationError } from '@bb/shared';
import {
  deriveSnapshotStatus,
  hasDirectEvent,
  projectRecognition,
  type BusinessSnapshotVersion,
  type BusinessSnapshotView,
  type RecognitionEventRepository,
  type RecognitionState,
  type ReviewRepository,
  type SnapshotRepository,
  type SubjectRef,
} from '@bb/domain';

export interface ISnapshotViewService {
  viewById(businessRef: SubjectRef, snapshotId: string): Promise<BusinessSnapshotView>;
  viewCurrent(businessRef: SubjectRef): Promise<BusinessSnapshotView | null>;
}

/**
 * Read-only composition of a BusinessSnapshotView over the EXACT requested version: for each observed
 * statement it projects the effective RecognitionState from that semanticKey's event history (in
 * persisted append-sequence order), attaches the latest review, and derives the SnapshotStatus. Pure
 * projection over immutable data — nothing is created, mutated, or superseded.
 *
 * One history read per statement (bounded, single-digit) — the frozen RecognitionEventRepository port
 * exposes no batch convention, so no N+1 optimization is attempted here.
 */
export class SnapshotViewService implements ISnapshotViewService {
  constructor(
    private readonly deps: {
      readonly snapshots: SnapshotRepository;
      readonly recognition: RecognitionEventRepository;
      readonly reviews: ReviewRepository;
    },
  ) {}

  async viewById(businessRef: SubjectRef, snapshotId: string): Promise<BusinessSnapshotView> {
    const snapshot = await this.deps.snapshots.byId(businessRef, snapshotId);
    if (!snapshot) {
      throw new ApplicationError('SNAPSHOT_VIEW_NOT_FOUND', `No snapshot ${snapshotId} for this business.`, 404);
    }
    return this.compose(businessRef, snapshot);
  }

  async viewCurrent(businessRef: SubjectRef): Promise<BusinessSnapshotView | null> {
    const snapshot = await this.deps.snapshots.current(businessRef);
    if (!snapshot) return null;
    return this.compose(businessRef, snapshot);
  }

  private async compose(businessRef: SubjectRef, snapshot: BusinessSnapshotVersion): Promise<BusinessSnapshotView> {
    const statementRecognitions = new Map<string, RecognitionState>();
    let anyDirectEvent = false;

    for (const statement of snapshot.observedStatements) {
      const events = await this.deps.recognition.history(businessRef, statement.semanticKey);
      statementRecognitions.set(statement.semanticKey, projectRecognition(statement.versionId, events));
      if (hasDirectEvent(statement.versionId, events)) anyDirectEvent = true;
    }

    const latestReview = await this.deps.reviews.latest(businessRef, snapshot.id);
    const status = deriveSnapshotStatus({ latestReview: latestReview ?? undefined, anyDirectEvent });

    return {
      snapshot,
      ...(latestReview ? { latestReview } : {}),
      statementRecognitions,
      status,
    };
  }
}
