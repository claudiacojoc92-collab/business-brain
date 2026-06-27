/** Campaign types. Maps to bb_types.campaign_type. */
export const CampaignType = {
  LAUNCH:       'LAUNCH',
  REENGAGEMENT: 'REENGAGEMENT',
  POSITIONING:  'POSITIONING',
  SEASONAL:     'SEASONAL',
  MILESTONE:    'MILESTONE',
} as const;
export type CampaignType = typeof CampaignType[keyof typeof CampaignType];
