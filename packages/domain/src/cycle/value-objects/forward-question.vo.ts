import { ValueObject } from '../../shared/value-object';

export type ForwardQuestionPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ForwardQuestionProps {
  question: string;
  targetLayer: number;
  priority: ForwardQuestionPriority;
}

/**
 * A specific intelligence gap to resolve in the next cycle.
 * Produced by Stage 12 (Memory Updater). Consumed at Stage 4 (Memory Interrogation).
 * Source: Event Contracts V1 Section 10, Corrections Addendum V1 F011.
 */
export class ForwardQuestion extends ValueObject {
  readonly question: string;
  readonly targetLayer: number;
  readonly priority: ForwardQuestionPriority;

  constructor(props: ForwardQuestionProps) {
    super();
    if (props.targetLayer < 1 || props.targetLayer > 9) {
      throw new Error('ForwardQuestion.targetLayer must be between 1 and 9.');
    }
    if (props.question.trim().length === 0) {
      throw new Error('ForwardQuestion.question must not be empty.');
    }
    this.question    = props.question;
    this.targetLayer = props.targetLayer;
    this.priority    = props.priority;
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      question:    this.question,
      targetLayer: this.targetLayer,
      priority:    this.priority,
    };
  }
}
