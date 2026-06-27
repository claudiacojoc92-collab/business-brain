/**
 * FounderProfile lifecycle states.
 * Maps to bb_types.founder_status in PostgreSQL.
 */
export const FounderStatus = {
  CREATED:         'CREATED',
  INTAKE_PENDING:  'INTAKE_PENDING',
  INTAKE_COMPLETE: 'INTAKE_COMPLETE',
  ACTIVE:          'ACTIVE',
  RECALIBRATING:   'RECALIBRATING',
  PAUSED:          'PAUSED',
  ARCHIVED:        'ARCHIVED',
} as const;
export type FounderStatus = typeof FounderStatus[keyof typeof FounderStatus];
