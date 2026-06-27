/** Campaign lifecycle states. Maps to bb_types.campaign_status. */
export const CampaignStatus = {
  PLANNED:     'PLANNED',
  ACTIVE:      'ACTIVE',
  COMPLETED:   'COMPLETED',
  SUCCEEDED:   'SUCCEEDED',
  FAILED:      'FAILED',
  INTERRUPTED: 'INTERRUPTED',
} as const;
export type CampaignStatus = typeof CampaignStatus[keyof typeof CampaignStatus];
