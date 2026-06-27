/** The four marketing decision modes. Maps to bb_types.marketing_mode. */
export const MarketingMode = {
  AUTHORITY:  'AUTHORITY',
  TRUST:      'TRUST',
  EDUCATION:  'EDUCATION',
  CONVERSION: 'CONVERSION',
} as const;
export type MarketingMode = typeof MarketingMode[keyof typeof MarketingMode];
