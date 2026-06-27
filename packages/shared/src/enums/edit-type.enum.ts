/** Content edit classification types. Maps to bb_types.edit_type. */
export const EditType = {
  VOICE_CORRECTION:      'VOICE_CORRECTION',
  CTA_SOFTENING:         'CTA_SOFTENING',
  SPECIFICITY_ADDITION:  'SPECIFICITY_ADDITION',
  STRUCTURE_CHANGE:      'STRUCTURE_CHANGE',
  TONE_ADJUSTMENT:       'TONE_ADJUSTMENT',
  FACTUAL_CORRECTION:    'FACTUAL_CORRECTION',
  LENGTH_REDUCTION:      'LENGTH_REDUCTION',
  LENGTH_EXPANSION:      'LENGTH_EXPANSION',
  OPENING_CHANGE:        'OPENING_CHANGE',
  CLOSING_CHANGE:        'CLOSING_CHANGE',
  UNCLASSIFIED:          'UNCLASSIFIED',
} as const;
export type EditType = typeof EditType[keyof typeof EditType];
