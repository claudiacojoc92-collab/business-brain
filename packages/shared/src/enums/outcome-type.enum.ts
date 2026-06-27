/** Business outcome types reported by founders. Maps to bb_types.outcome_type. */
export const OutcomeType = {
  DM:              'DM',
  ENQUIRY:         'ENQUIRY',
  DISCOVERY_CALL:  'DISCOVERY_CALL',
  CLIENT:          'CLIENT',
  REVENUE:         'REVENUE',
} as const;
export type OutcomeType = typeof OutcomeType[keyof typeof OutcomeType];
