import { Entity } from '../../shared/entity';
import type { RecalibrationType } from './recalibration-types';

export { RecalibrationType } from './recalibration-types';

/**
 * An active recalibration session.
 * Expires 7 days after creation.
 * Source: Domain Behaviour Specification V1 Chapter 02.
 */
export class RecalibrationSession extends Entity {
  readonly founderId: string;
  readonly recalibrationType: RecalibrationType;
  readonly questions: readonly { sequence: number; signalType: string; prompt: string }[];
  readonly responses: Map<string, string>;
  readonly expiresAt: Date;
  readonly completedAt: Date | null;
  readonly abandonedAt: Date | null;

  constructor(props: {
    id: string;
    founderId: string;
    recalibrationType: RecalibrationType;
    questions: { sequence: number; signalType: string; prompt: string }[];
    responses: Map<string, string>;
    expiresAt: Date;
    completedAt: Date | null;
    abandonedAt: Date | null;
  }) {
    super(props.id);
    this.founderId           = props.founderId;
    this.recalibrationType   = props.recalibrationType;
    this.questions           = Object.freeze([...props.questions]);
    this.responses           = new Map(props.responses);
    this.expiresAt           = props.expiresAt;
    this.completedAt         = props.completedAt;
    this.abandonedAt         = props.abandonedAt;
  }

  isExpired(now: Date): boolean {
    return now >= this.expiresAt;
  }

  isComplete(): boolean {
    return this.completedAt !== null;
  }

  hasAllResponses(): boolean {
    return this.questions.every((q) => this.responses.has(q.signalType));
  }

  withResponse(signalType: string, value: string): RecalibrationSession {
    const updated = new Map(this.responses);
    updated.set(signalType, value);
    return new RecalibrationSession({
      id:                  this.id,
      founderId:           this.founderId,
      recalibrationType:   this.recalibrationType,
      questions:           [...this.questions],
      responses:           updated,
      expiresAt:           this.expiresAt,
      completedAt:         this.completedAt,
      abandonedAt:         this.abandonedAt,
    });
  }
}
