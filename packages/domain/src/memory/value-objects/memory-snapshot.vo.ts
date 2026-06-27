import { ValueObject } from '../../shared/value-object';

export interface MemorySnapshotProps {
  founderId: string;
  snapshotJson: Record<string, unknown>;
  estimatedTokens: number | null;
  builtFromCycleId: string | null;
  builtAt: Date;
}

/**
 * Pre-assembled LLM context package for the next cycle.
 * Kept in Redis (primary) and memory_snapshots table (durable backup).
 * The Context Builder reads this at cycle start (F018: staleness check).
 * Source: Software Architecture V1 Chapter 09, Corrections Addendum V1 F018.
 */
export class MemorySnapshot extends ValueObject {
  readonly founderId: string;
  readonly snapshotJson: Record<string, unknown>;
  readonly estimatedTokens: number | null;
  readonly builtFromCycleId: string | null;
  readonly builtAt: Date;

  constructor(props: MemorySnapshotProps) {
    super();
    this.founderId        = props.founderId;
    this.snapshotJson     = props.snapshotJson;
    this.estimatedTokens  = props.estimatedTokens;
    this.builtFromCycleId = props.builtFromCycleId;
    this.builtAt          = props.builtAt;
  }

  /**
   * Returns true if the snapshot is older than the given threshold in minutes.
   * Used by the Context Builder (F018) to detect stale snapshots.
   */
  isStale(thresholdMinutes: number, now: Date): boolean {
    const ageMs = now.getTime() - this.builtAt.getTime();
    return ageMs > thresholdMinutes * 60 * 1000;
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      founderId: this.founderId,
      builtAt:   this.builtAt.toISOString(),
    };
  }
}
