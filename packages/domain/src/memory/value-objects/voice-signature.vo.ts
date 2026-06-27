import { ValueObject } from '../../shared/value-object';
import {
  VOICE_SIGNATURE_CONFIDENCE_THRESHOLD,
  VOICE_SIGNATURE_OBSERVATION_THRESHOLD,
} from '@bb/shared';

export interface VoiceSignatureProps {
  founderId: string;
  sentenceStructurePreference: string;
  openingPreference: string;
  closingPreference: string;
  ctaPreference: string;
  vocabularyRegister: string;
  confidence: number;
  observationCount: number;
  lastUpdatedAt: Date;
}

/**
 * The behavioural fingerprint of the founder's communication style.
 * Derived from edit pattern accumulation (Layer 2).
 * Distinct from FounderVoice (stated preference) — this is observed behaviour.
 *
 * When hasReachedUpdateThreshold() returns true, the Memory Service
 * creates a new FounderVoice version with derivedFrom = 'EDIT_PATTERN' (F012).
 *
 * Source: Domain Architecture V1 Chapter 10, Corrections Addendum V1 F012.
 */
export class VoiceSignature extends ValueObject {
  readonly founderId: string;
  readonly sentenceStructurePreference: string;
  readonly openingPreference: string;
  readonly closingPreference: string;
  readonly ctaPreference: string;
  readonly vocabularyRegister: string;
  readonly confidence: number;
  readonly observationCount: number;
  readonly lastUpdatedAt: Date;

  constructor(props: VoiceSignatureProps) {
    super();
    this.founderId                   = props.founderId;
    this.sentenceStructurePreference = props.sentenceStructurePreference;
    this.openingPreference           = props.openingPreference;
    this.closingPreference           = props.closingPreference;
    this.ctaPreference               = props.ctaPreference;
    this.vocabularyRegister          = props.vocabularyRegister;
    this.confidence                  = props.confidence;
    this.observationCount            = props.observationCount;
    this.lastUpdatedAt               = props.lastUpdatedAt;
  }

  /**
   * Returns true when the VoiceSignature has accumulated enough observations
   * to trigger a FounderVoice update (F012).
   * Threshold: confidence >= 0.60 AND observationCount >= 12.
   */
  hasReachedUpdateThreshold(): boolean {
    return (
      this.confidence >= VOICE_SIGNATURE_CONFIDENCE_THRESHOLD &&
      this.observationCount >= VOICE_SIGNATURE_OBSERVATION_THRESHOLD
    );
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      founderId:        this.founderId,
      confidence:       this.confidence,
      observationCount: this.observationCount,
    };
  }
}
