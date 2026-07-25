import type { SubjectRef } from '@bb/domain';
import type { ISnapshotViewService } from './snapshot-view.service';
import type { PresentedEventLog, PresentedSnapshotView } from './presentation-ports';

export interface IPresentationViewService {
  viewById(businessRef: SubjectRef, snapshotId: string): Promise<PresentedSnapshotView>;
  viewCurrent(businessRef: SubjectRef): Promise<PresentedSnapshotView | null>;
}

/**
 * Read-only composition: pairs the frozen BusinessSnapshotView (via the unchanged SnapshotViewService)
 * with the latest SnapshotPresentedEvent for that snapshot. Purely by reading — no writes during
 * composition. The frozen BusinessSnapshotView type and its `status` are untouched; presented events are
 * informational and never alter the Commit 5/6 SnapshotStatus derivation.
 */
export class PresentationViewService implements IPresentationViewService {
  constructor(
    private readonly deps: {
      readonly view: ISnapshotViewService;
      readonly presentations: PresentedEventLog;
    },
  ) {}

  async viewById(businessRef: SubjectRef, snapshotId: string): Promise<PresentedSnapshotView> {
    const view = await this.deps.view.viewById(businessRef, snapshotId);
    const latestPresentation = await this.deps.presentations.latest(businessRef, view.snapshot.id);
    return { view, latestPresentation };
  }

  async viewCurrent(businessRef: SubjectRef): Promise<PresentedSnapshotView | null> {
    const view = await this.deps.view.viewCurrent(businessRef);
    if (!view) return null;
    const latestPresentation = await this.deps.presentations.latest(businessRef, view.snapshot.id);
    return { view, latestPresentation };
  }
}
