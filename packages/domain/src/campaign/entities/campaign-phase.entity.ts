import { Entity } from '../../shared/entity';
import type { MarketingMode } from '@bb/shared';

export interface CampaignPhaseProps {
  id: string;
  campaignId: string;
  founderId: string;
  phaseIndex: number;
  mode: MarketingMode;
  beliefTarget: string;
  expectedAudienceChange: string;
  assignedCycleId: string | null;
  executedAt: Date | null;
}

/**
 * A single phase within a campaign.
 * Phases are immutable once the campaign is ACTIVE.
 * Source: Domain Architecture V1 Chapter 03.
 */
export class CampaignPhase extends Entity {
  readonly campaignId: string;
  readonly founderId: string;
  readonly phaseIndex: number;
  readonly mode: MarketingMode;
  readonly beliefTarget: string;
  readonly expectedAudienceChange: string;
  assignedCycleId: string | null;
  executedAt: Date | null;

  constructor(props: CampaignPhaseProps) {
    super(props.id);
    this.campaignId             = props.campaignId;
    this.founderId              = props.founderId;
    this.phaseIndex             = props.phaseIndex;
    this.mode                   = props.mode;
    this.beliefTarget           = props.beliefTarget;
    this.expectedAudienceChange = props.expectedAudienceChange;
    this.assignedCycleId        = props.assignedCycleId;
    this.executedAt             = props.executedAt;
  }

  isExecuted(): boolean {
    return this.executedAt !== null;
  }
}
