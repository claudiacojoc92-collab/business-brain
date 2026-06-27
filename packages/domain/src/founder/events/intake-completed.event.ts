import type { FounderVoice } from '../value-objects/founder-voice.vo';
import type { BeliefChain } from '../value-objects/belief-chain.vo';
import type { ConvictionAngle } from '../value-objects/conviction-angle.vo';
import type { Audience } from '../value-objects/audience.vo';
import type { Offer } from '../value-objects/offer.vo';

export interface IntakeCompletedPayload {
  founderId: string;
  sessionId: string;
  completedAt: Date;
  voice: FounderVoice;
  beliefChain: BeliefChain;
  conviction: ConvictionAngle;
  audience: Audience;
  offer: Offer;
}

export function buildIntakeCompletedEvent(p: IntakeCompletedPayload): IntakeCompletedPayload {
  return p;
}
