import { ValueObject } from '../../shared/value-object';
import type { AudienceLanguageFingerprint } from './audience-language-fingerprint.vo';

export type SophisticationLevel = 'EARLY_STAGE' | 'GROWTH' | 'SENIOR' | 'MIXED';

export interface AudienceProps {
  id: string;
  description: string;
  preEngagementState: string;
  sophisticationLevel: SophisticationLevel;
  primaryPlatform: string;
  languageFingerprint: AudienceLanguageFingerprint;
}

/**
 * The founder's target audience definition.
 * Contains the AudienceLanguageFingerprint as a nested value object.
 * Source: Domain Architecture V1 Chapter 10.
 */
export class Audience extends ValueObject {
  readonly id: string;
  readonly description: string;
  readonly preEngagementState: string;
  readonly sophisticationLevel: SophisticationLevel;
  readonly primaryPlatform: string;
  readonly languageFingerprint: AudienceLanguageFingerprint;

  constructor(props: AudienceProps) {
    super();
    this.id                  = props.id;
    this.description         = props.description;
    this.preEngagementState  = props.preEngagementState;
    this.sophisticationLevel = props.sophisticationLevel;
    this.primaryPlatform     = props.primaryPlatform;
    this.languageFingerprint = props.languageFingerprint;
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      id:                  this.id,
      description:         this.description,
      preEngagementState:  this.preEngagementState,
      sophisticationLevel: this.sophisticationLevel,
      primaryPlatform:     this.primaryPlatform,
      languageFingerprint: JSON.stringify(this.languageFingerprint),
    };
  }
}
