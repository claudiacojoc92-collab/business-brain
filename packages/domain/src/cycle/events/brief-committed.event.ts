import type { BriefMetadata } from './cycle-event-types';

export type BriefCommittedPayload = BriefMetadata;

export function buildBriefCommittedEvent(p: BriefCommittedPayload): BriefCommittedPayload {
  return p;
}
