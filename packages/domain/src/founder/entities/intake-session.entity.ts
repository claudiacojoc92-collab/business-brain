import { Entity } from '../../shared/entity';

/**
 * Represents an active intake session.
 * Expires 7 days after creation.
 * Source: Domain Behaviour Specification V1 Chapter 02.
 */
export class IntakeSession extends Entity {
  readonly founderId: string;
  readonly signals: Map<string, string>;
  readonly mandatorySignalTypes: readonly string[];
  readonly expiresAt: Date;
  readonly completedAt: Date | null;
  readonly abandonedAt: Date | null;

  constructor(props: {
    id: string;
    founderId: string;
    signals: Map<string, string>;
    mandatorySignalTypes: string[];
    expiresAt: Date;
    completedAt: Date | null;
    abandonedAt: Date | null;
  }) {
    super(props.id);
    this.founderId            = props.founderId;
    this.signals              = new Map(props.signals);
    this.mandatorySignalTypes = Object.freeze([...props.mandatorySignalTypes]);
    this.expiresAt            = props.expiresAt;
    this.completedAt          = props.completedAt;
    this.abandonedAt          = props.abandonedAt;
  }

  isExpired(now: Date): boolean {
    return now >= this.expiresAt;
  }

  isComplete(): boolean {
    return this.completedAt !== null;
  }

  hasAllMandatorySignals(): boolean {
    return this.mandatorySignalTypes.every((t) => this.signals.has(t));
  }

  withSignal(signalType: string, value: string): IntakeSession {
    const updated = new Map(this.signals);
    updated.set(signalType, value);
    return new IntakeSession({
      id:                   this.id,
      founderId:            this.founderId,
      signals:              updated,
      mandatorySignalTypes: [...this.mandatorySignalTypes],
      expiresAt:            this.expiresAt,
      completedAt:          this.completedAt,
      abandonedAt:          this.abandonedAt,
    });
  }
}
