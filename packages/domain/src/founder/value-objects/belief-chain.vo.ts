import { ValueObject } from '../../shared/value-object';

export type BeliefType = 'SELF' | 'PROBLEM' | 'SOLUTION' | 'PROVIDER';

export interface Belief {
  step: number;
  content: string;
  beliefType: BeliefType;
  isPrerequisiteFor?: number;
}

export interface BeliefChainProps {
  versionNumber: number;
  beliefs: Belief[];
}

/**
 * Ordered sequence of beliefs the audience must hold before conversion is possible.
 * Source: Marketing Intelligence Model V1, Domain Architecture V1 Chapter 10.
 */
export class BeliefChain extends ValueObject {
  readonly versionNumber: number;
  readonly beliefs: readonly Belief[];

  constructor(props: BeliefChainProps) {
    super();
    if (props.beliefs.length < 2) {
      throw new Error('BeliefChain requires at least 2 beliefs.');
    }
    this.versionNumber = props.versionNumber;
    this.beliefs = Object.freeze([...props.beliefs]);
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      versionNumber: this.versionNumber,
      beliefs:       JSON.stringify(this.beliefs),
    };
  }
}
