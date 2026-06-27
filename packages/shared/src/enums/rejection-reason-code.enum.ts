/**
 * Content rejection reason codes. Maps to bb_types.rejection_reason_code.
 * F003 correction from Corrections Addendum V1.
 */
export const RejectionReasonCode = {
  VOICE_MISMATCH:       'VOICE_MISMATCH',
  TOPIC_INAPPROPRIATE:  'TOPIC_INAPPROPRIATE',
  CTA_AGGRESSIVE:       'CTA_AGGRESSIVE',
  FACTUALLY_INCORRECT:  'FACTUALLY_INCORRECT',
  TONE_WRONG:           'TONE_WRONG',
  OFF_BRAND:            'OFF_BRAND',
  TIMING_WRONG:         'TIMING_WRONG',
  PRIVACY_CONCERN:      'PRIVACY_CONCERN',
  COMPETITOR_MENTION:   'COMPETITOR_MENTION',
  UNCLASSIFIED:         'UNCLASSIFIED',
} as const;
export type RejectionReasonCode = typeof RejectionReasonCode[keyof typeof RejectionReasonCode];
