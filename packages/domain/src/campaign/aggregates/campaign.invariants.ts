export const CAMPAIGN_INVARIANTS = [
  'At most one ACTIVE campaign per founder. Enforced by unique partial index on DB and hasActiveCampaign parameter on LaunchCampaign.',
  'Campaign phases are immutable once campaign is ACTIVE.',
  'CampaignPhase ordering is by phase_index (0-based).',
  'Campaign.interrupt() is valid from ACTIVE status only.',
  'Campaign.complete() triggers success/failure evaluation via CampaignCompleted event.',
] as const;
