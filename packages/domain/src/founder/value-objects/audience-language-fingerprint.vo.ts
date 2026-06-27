import { ValueObject } from '../../shared/value-object';

export type EmotionalRegister = 'FRUSTRATED' | 'ASPIRATIONAL' | 'ANALYTICAL' | 'OVERWHELMED';

export interface AudienceLanguageFingerprintProps {
  versionNumber: number;
  primaryPhrases: string[];
  avoidPhrases: string[];        // F014 correction
  emotionalRegister: EmotionalRegister;  // F014 correction
  failedAlternatives: string[];
}

/**
 * The vocabulary and emotional patterns of the founder's best client.
 * F014: avoidPhrases and emotionalRegister are required fields.
 * Source: Domain Architecture V1 Chapter 10, Corrections Addendum V1 F014.
 */
export class AudienceLanguageFingerprint extends ValueObject {
  readonly versionNumber: number;
  readonly primaryPhrases: readonly string[];
  readonly avoidPhrases: readonly string[];
  readonly emotionalRegister: EmotionalRegister;
  readonly failedAlternatives: readonly string[];

  constructor(props: AudienceLanguageFingerprintProps) {
    super();
    this.versionNumber      = props.versionNumber;
    this.primaryPhrases     = Object.freeze([...props.primaryPhrases]);
    this.avoidPhrases       = Object.freeze([...props.avoidPhrases]);
    this.emotionalRegister  = props.emotionalRegister;
    this.failedAlternatives = Object.freeze([...props.failedAlternatives]);
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      versionNumber:     this.versionNumber,
      primaryPhrases:    JSON.stringify(this.primaryPhrases),
      avoidPhrases:      JSON.stringify(this.avoidPhrases),
      emotionalRegister: this.emotionalRegister,
      failedAlternatives:JSON.stringify(this.failedAlternatives),
    };
  }
}
