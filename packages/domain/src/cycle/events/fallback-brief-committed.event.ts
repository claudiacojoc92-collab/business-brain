import type { BriefMetadata } from './cycle-event-types';

export interface FallbackBriefCommittedPayload extends BriefMetadata {
  fallbackReason: string;
}

export function buildFallbackBriefCommittedEvent(
  p: FallbackBriefCommittedPayload,
): FallbackBriefCommittedPayload {
  return p;
}
