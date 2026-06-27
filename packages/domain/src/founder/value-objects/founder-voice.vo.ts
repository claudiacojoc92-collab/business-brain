import { ValueObject } from '../../shared/value-object';

export type SentenceRhythm = 'SHORT_DECLARATIVE' | 'LONG_LAYERED' | 'MIXED' | 'UNKNOWN';
export type ConvictionPosture = 'OPINION_FIRST' | 'NUANCED' | 'EVIDENCE_FIRST' | 'UNKNOWN';
export type VulnerabilityLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type SpecificityLevel = 'ALWAYS_SPECIFIC' | 'SOMETIMES' | 'ALLOWS_ABSTRACT';
export type CtaStyle = 'INVITATION' | 'DIRECT' | 'NONE' | 'SOFT';
export type VoiceDerivedFrom = 'INTAKE' | 'RECALIBRATION' | 'EDIT_PATTERN';

export interface FounderVoiceProps {
  versionNumber: number;
  derivedFrom: VoiceDerivedFrom;
  sentenceRhythm: SentenceRhythm;
  openingPattern: string;
  closingPattern: string;
  convictionPosture: ConvictionPosture;
  vulnerabilityLevel: VulnerabilityLevel;
  specificityLevel: SpecificityLevel;
  ctaStyle: CtaStyle;
}

/**
 * Immutable snapshot of the founder's communication style.
 * A new version is created on every recalibration or behavioural threshold.
 * Source: Domain Architecture V1 Chapter 10.
 */
export class FounderVoice extends ValueObject {
  readonly versionNumber: number;
  readonly derivedFrom: VoiceDerivedFrom;
  readonly sentenceRhythm: SentenceRhythm;
  readonly openingPattern: string;
  readonly closingPattern: string;
  readonly convictionPosture: ConvictionPosture;
  readonly vulnerabilityLevel: VulnerabilityLevel;
  readonly specificityLevel: SpecificityLevel;
  readonly ctaStyle: CtaStyle;

  constructor(props: FounderVoiceProps) {
    super();
    this.versionNumber = props.versionNumber;
    this.derivedFrom = props.derivedFrom;
    this.sentenceRhythm = props.sentenceRhythm;
    this.openingPattern = props.openingPattern;
    this.closingPattern = props.closingPattern;
    this.convictionPosture = props.convictionPosture;
    this.vulnerabilityLevel = props.vulnerabilityLevel;
    this.specificityLevel = props.specificityLevel;
    this.ctaStyle = props.ctaStyle;
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      versionNumber:     this.versionNumber,
      derivedFrom:       this.derivedFrom,
      sentenceRhythm:    this.sentenceRhythm,
      openingPattern:    this.openingPattern,
      closingPattern:    this.closingPattern,
      convictionPosture: this.convictionPosture,
      vulnerabilityLevel:this.vulnerabilityLevel,
      specificityLevel:  this.specificityLevel,
      ctaStyle:          this.ctaStyle,
    };
  }
}
