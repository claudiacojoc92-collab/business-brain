import type { FounderVoice } from '../value-objects/founder-voice.vo';
import type { VoiceDerivedFrom } from '../value-objects/founder-voice.vo';

export interface FounderVoiceVersionedPayload {
  founderId: string;
  voiceVersionId: string;
  versionNumber: number;
  derivedFrom: VoiceDerivedFrom;
  previousVersionId: string;
  voice: FounderVoice;
}

export function buildFounderVoiceVersionedEvent(
  p: FounderVoiceVersionedPayload,
): FounderVoiceVersionedPayload {
  return p;
}
