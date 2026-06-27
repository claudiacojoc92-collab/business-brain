import { ValueObject } from '../../shared/value-object';

export interface ConvictionAngleProps {
  versionNumber: number;
  statement: string;
  domain: string;
  confidence: number;
  derivedFrom: 'INTAKE' | 'RECALIBRATION';
}

/**
 * The founder's specific industry disagreement — the contrarian position
 * that is the backbone of their Authority content.
 * Source: Domain Architecture V1 Chapter 10.
 */
export class ConvictionAngle extends ValueObject {
  readonly versionNumber: number;
  readonly statement: string;
  readonly domain: string;
  readonly confidence: number;
  readonly derivedFrom: 'INTAKE' | 'RECALIBRATION';

  constructor(props: ConvictionAngleProps) {
    super();
    if (props.confidence < 0 || props.confidence > 1) {
      throw new Error('ConvictionAngle.confidence must be between 0 and 1.');
    }
    if (props.statement.trim().split(/\s+/).length < 10) {
      throw new Error('ConvictionAngle.statement must be at least 10 words.');
    }
    this.versionNumber = props.versionNumber;
    this.statement     = props.statement;
    this.domain        = props.domain;
    this.confidence    = props.confidence;
    this.derivedFrom   = props.derivedFrom;
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      versionNumber: this.versionNumber,
      statement:     this.statement,
      domain:        this.domain,
      confidence:    this.confidence,
      derivedFrom:   this.derivedFrom,
    };
  }
}
